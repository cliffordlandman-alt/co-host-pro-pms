import type { Request, Response, NextFunction } from 'express';
import { db, usersTable, ownersTable, propertiesTable, reservationsTable, ownerStatementsTable, staffTable, cleaningTasksTable, maintenanceTicketsTable } from '@workspace/db';
import { eq, and, inArray, ne, sql } from 'drizzle-orm';
import { getTokenPayload } from './auth-middleware';

const publicPaths = new Set(['/healthz', '/auth/login', '/auth/register', '/owner-auth/send-code', '/owner-auth/verify']);
const attempts = new Map<string, {count:number; until:number}>();
export async function apiAccess(req: Request, res: Response, next: NextFunction) {
  if (publicPaths.has(req.path)) {
    if (req.method !== 'GET') {
      const key = `${req.ip}:${req.path}`;
      const now = Date.now();
      for (const [k,v] of attempts) if (v.until < now) attempts.delete(k);
      const a = attempts.get(key) ?? {count:0, until:now + 15*60*1000};
      attempts.set(key,a);
      if (++a.count > 30) return res.status(429).json({error:'Too many attempts. Please try again in 15 minutes.'});
    }
    return next();
  }
  const token = getTokenPayload(req);
  if (!token) return res.status(401).json({error:'Please sign in'});
  if (token.role === 'owner_portal') {
    const [owner] = await db.select({id:ownersTable.id}).from(ownersTable).where(eq(ownersTable.id,token.id));
    if (!owner || req.method !== 'GET') return res.status(403).json({error:'Owner access is read only'});
    const properties = await db.select({id:propertiesTable.id,name:propertiesTable.name,unitNumber:propertiesTable.unitNumber,bedroomType:propertiesTable.bedroomType,building:propertiesTable.building,status:propertiesTable.status}).from(propertiesTable).where(eq(propertiesTable.ownerId,owner.id));
    const ids = properties.map(p=>p.id);
    if (req.path === '/properties') return res.json(properties);
    if (req.path === '/reservations') {
      const propertyId = Number(req.query.propertyId);
      if (!ids.includes(propertyId)) return res.status(403).json({error:'Property access denied'});
      const rows = await db.select({id:reservationsTable.id,propertyId:reservationsTable.propertyId,checkIn:reservationsTable.checkIn,checkOut:reservationsTable.checkOut,nights:reservationsTable.nights,status:reservationsTable.status,platform:reservationsTable.platform,revenue:reservationsTable.revenue}).from(reservationsTable).where(eq(reservationsTable.propertyId,propertyId));
      return res.json(rows.map(r=>({...r,guestName:'Reserved',revenue:Number(r.revenue)})));
    }
    if (req.path === '/accounting/statements') {
      const rows = await db.select().from(ownerStatementsTable).where(and(eq(ownerStatementsTable.ownerId,owner.id), ne(ownerStatementsTable.status,'draft'), req.query.month ? eq(ownerStatementsTable.month,String(req.query.month)) : undefined));
      const money = ['grossRevenue','platformFees','managementFee','cleaningCosts','maintenanceCosts','otherExpenses','vatAmount','ownerPayout','tourismFee','paidByAirbnb'];
      return res.json(rows.map(r=>({...r,propertyName:properties.find(p=>p.id===r.propertyId)?.name,...Object.fromEntries(money.map(k=>[k,Number((r as any)[k] || 0)]))})));
    }
    return res.status(403).json({error:'Owner access denied'});
  }
  const [user] = await db.select({id:usersTable.id,email:usersTable.email,role:usersTable.role,status:usersTable.status}).from(usersTable).where(eq(usersTable.id,token.id));
  if (!user || user.status !== 'active') return res.status(401).json({error:'Account is inactive'});
  res.locals.user = user;
  req.headers['x-user-id'] = String(user.id);
  if (['admin','super_admin'].includes(user.role)) return next();
  const root = req.path.split('/')[1];
  if (['auth','session'].includes(root)) return next();
  if (["cleaner","maintenance"].includes(user.role)) {
    // Login emails are stored lower-case; staff profiles may have been typed with capitals.
    const [staff]=await db.select().from(staffTable).where(and(sql`lower(${staffTable.email}) = ${user.email.toLowerCase()}`,eq(staffTable.active,true)));
    if(!staff) return res.status(403).json({error:"Your staff profile must be linked by email before tasks are available"});
    const table=user.role==="cleaner" ? cleaningTasksTable : maintenanceTicketsTable;
    const tasks=await db.select().from(table).where(eq(table.assignedToId,staff.id));
    const taskRoot=user.role==="cleaner"?"cleaning":"maintenance";
    if(root==="staff" && req.method==="GET") return res.json([staff]);
    if(root===taskRoot) {
      const id=Number(req.path.split('/')[2]);
      if(req.method==="GET" && !id) {
        const ids=tasks.map(t=>t.propertyId);
        const properties=ids.length ? await db.select({id:propertiesTable.id,name:propertiesTable.name,unitNumber:propertiesTable.unitNumber}).from(propertiesTable).where(inArray(propertiesTable.id,ids)) : [];
        return res.json(tasks.map(t=>({...t,propertyName:properties.find(p=>p.id===t.propertyId)?.name,unitNumber:properties.find(p=>p.id===t.propertyId)?.unitNumber,assignedToName:staff.name})));
      }
      if(!tasks.some(t=>t.id===id)) return res.status(403).json({error:"This task is not assigned to you"});
      if(req.method==="GET") return next();
      if(req.method==="PATCH") {
        const task=tasks.find(t=>t.id===id);
        if(task && ["approved","cancelled"].includes(task.status)) return res.status(409).json({error:task.status==="approved"?"This clean has already been approved; ask a manager to reopen it":"This task was cancelled"});
        if(Object.keys(req.body).some(k=>!["status","notes","checklist","photos","completedAt"].includes(k)) || req.body.status==="approved") return res.status(403).json({error:"Only a manager can approve, reassign or change costs"});
        return next();
      }
    }
    return res.status(403).json({error:"Only your assigned tasks are available"});
  }
  const allowed: Record<string,string[]> = {
    manager:['dashboard','properties','owners','staff','reservations','cleaning','maintenance','payments','reports','accounting','notifications','messages','reviews','documents','pricing','platforms','channels','task-centre','guests'],
    reservations:['dashboard','properties','reservations','messages','notifications','task-centre','guests'],
    operations:['dashboard','properties','reservations','cleaning','maintenance','staff','notifications','task-centre','guests'],
    accountant:['properties','owners','reservations','payments','accounting','reports','dashboard','notifications'],
  };
  if (!(allowed[user.role] || []).includes(root)) return res.status(403).json({error:'Your role does not have access to this area'});
  if (['reservations','operations','accountant'].includes(user.role) && ['properties','owners','staff','dashboard'].includes(root) && req.method !== 'GET') return res.status(403).json({error:'Administrator access required'});
  return next();
}
