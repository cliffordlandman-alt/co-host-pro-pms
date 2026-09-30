import { Router } from 'express';
import { db, propertiesTable, reservationsTable, airbnbEarningsTable, airbnbPayoutsTable, cleaningTasksTable } from '@workspace/db';
import { eq, and, ne, or, isNull, like } from 'drizzle-orm';
import { requireAdmin } from '../lib/auth-middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { normalizeImport } from '../lib/airbnb-import.mjs';
const router=Router();
router.use('/airbnb-data',requireAdmin);
router.get('/airbnb-data',asyncHandler(async(_req,res)=>{
 const rows=await db.select().from(airbnbEarningsTable);
 const payouts=await db.select().from(airbnbPayoutsTable);
 res.json({rows:rows.map(r=>({...r,amount:Number(r.amount)})),payouts:payouts.map(p=>({...p,amount:Number(p.amount)}))});
}));
router.post('/airbnb-data/preview',asyncHandler(async(req,res)=>{
 try{
 const normalized=normalizeImport(req.body,await db.select().from(propertiesTable));
 const existing=new Set((await db.select({id:airbnbEarningsTable.id}).from(airbnbEarningsTable)).map(r=>r.id));
 res.json({...normalized,existing:normalized.records.filter((r:any)=>existing.has(r.id)).length,bookings:new Set(normalized.records.map((r:any)=>r.code)).size});
 }catch(e){res.status(400).json({error:(e as Error).message});}
}));
router.post('/airbnb-data/import',asyncHandler(async(req,res)=>{
 let data;
 try{data=normalizeImport(req.body,await db.select().from(propertiesTable));if(data.issues.length)throw new Error('Match every listing before importing');}
 catch(e){return res.status(400).json({error:(e as Error).message});}
 let added=0;
 await db.transaction(async tx=>{
  for(const r of data.records){
   const values={id:r.id,confirmationCode:r.code,propertyId:r.propertyId,guestName:r.guest,checkIn:r.checkIn,checkOut:r.checkOut,kind:r.kind,currency:r.currency,amount:r.amount,status:r.status,payoutId:r.payoutId,sourceDate:r.sourceDate};
   const inserted=await tx.insert(airbnbEarningsTable).values(values).onConflictDoNothing().returning({id:airbnbEarningsTable.id});
   added+=inserted.length;
   const today=new Date().toISOString().slice(0,10);
   const booking={externalId:'airbnb:'+r.code,guestName:r.guest,propertyId:r.propertyId,platform:'airbnb',checkIn:r.checkIn,checkOut:r.checkOut,nights:Math.round((Date.parse(r.checkOut)-Date.parse(r.checkIn))/86400000),status:r.checkOut<=today?'checked_out':r.checkIn<=today?'checked_in':'confirmed',paymentStatus:'unknown',notes:`Airbnb ${r.code}. Earnings are recorded separately under Airbnb income; gross booking revenue is not supplied by this payout record.`};
   // The same stay may already exist from the Airbnb calendar feed or manual entry: link it instead of creating a duplicate booking and cleaning task.
   const [known]=await tx.select({id:reservationsTable.id}).from(reservationsTable).where(eq(reservationsTable.externalId,booking.externalId));
   if(!known){
    const [twin]=await tx.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId,r.propertyId),eq(reservationsTable.platform,'airbnb'),eq(reservationsTable.checkIn,r.checkIn),eq(reservationsTable.checkOut,r.checkOut),ne(reservationsTable.status,'cancelled'),or(isNull(reservationsTable.externalId),like(reservationsTable.externalId,'ical:airbnb:%'))));
    if(twin){await tx.update(reservationsTable).set({externalId:booking.externalId,notes:`${twin.notes ? twin.notes+' ' : ''}Linked to Airbnb ${r.code}.`}).where(eq(reservationsTable.id,twin.id));continue;}
   }
   const [created] = await tx.insert(reservationsTable).values(booking).onConflictDoNothing({target:reservationsTable.externalId}).returning();
   if(created && created.checkOut>=today) await tx.insert(cleaningTasksTable).values({propertyId:created.propertyId,reservationId:created.id,status:"dirty",scheduledDate:created.checkOut,scheduledTime:"11:00"});
  }
  for(const p of data.payouts)await tx.insert(airbnbPayoutsTable).values(p).onConflictDoNothing();
 });
 res.json({added,skipped:data.records.length-added,bookings:new Set(data.records.map((r:any)=>r.code)).size});
}));
export default router;
