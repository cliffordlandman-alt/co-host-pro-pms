import { Router } from 'express';
import { db,templatesTable,insertTemplateSchema,propertiesTable,reservationsTable,cleaningTasksTable,maintenanceTicketsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler';
import { DEFAULT_MESSAGE_TEMPLATES,TRIGGERS,VARIABLES,scheduledMessage } from '../../../../lib/guest-automations.mjs';
import { guestIdComplete } from '../../../../lib/guest-id.mjs';
const router=Router();
router.get('/templates',asyncHandler(async(_req,res)=>{
 let rows=await db.select().from(templatesTable).orderBy(templatesTable.createdAt);
 res.json(rows);
}));
router.get('/templates/queue',asyncHandler(async(_req,res)=>{
 const [templates,bookings,properties,cleaning,maintenance]=await Promise.all([db.select().from(templatesTable),db.select().from(reservationsTable),db.select().from(propertiesTable),db.select().from(cleaningTasksTable),db.select().from(maintenanceTicketsTable)]);
 const cutoff=new Date(Date.now()-7*86400000).toISOString().slice(0,10);const jobs=[];
 for(const b of bookings.filter(b=>b.checkOut>=cutoff))for(const t of templates){if(t.propertyId&&t.propertyId!==b.propertyId)continue;if(!t.propertyId&&templates.some(o=>o.propertyId===b.propertyId&&o.name===t.name))continue;
 const job=scheduledMessage(t,b,properties.find(p=>p.id===b.propertyId),new Date(),{idComplete:guestIdComplete(b),cleaningIncomplete:cleaning.some(c=>c.reservationId===b.id&&!['completed','approved','cancelled'].includes(c.status)),maintenanceOpen:maintenance.some(m=>m.propertyId===b.propertyId&&!['completed','resolved','cancelled'].includes(m.status))});if(job)jobs.push(job);}
 res.json(jobs.sort((a,b)=>(a.scheduledAt||'9999').localeCompare(b.scheduledAt||'9999')));
}));
router.get('/templates/property-variables/:id',asyncHandler(async(req,res)=>{const [p]=await db.select().from(propertiesTable).where(eq(propertiesTable.id,Number(req.params.id)));if(!p)return res.status(404).json({error:'Property not found'});res.json(p.messageVariables||{});}));
router.put('/templates/property-variables/:id',asyncHandler(async(req,res)=>{
 const allowed=[...VARIABLES,'utc_offset'];const values=req.body;
 if(!values||Array.isArray(values)||Object.entries(values).some(([k,v])=>!allowed.includes(k)||typeof v!=='string'||v.length>4000))return res.status(400).json({error:'Invalid property message fields'});
 for(const key of ['check_in_time','check_out_time'])if(values[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(values[key]))return res.status(400).json({error:'Use HH:MM times'});
 if(values.utc_offset&&!/^[+-](0\d|1[0-4]):[0-5]\d$/.test(values.utc_offset))return res.status(400).json({error:'Use a UTC offset such as +04:00'});
 if(values.payment_link&&!/^https:\/\//.test(values.payment_link))return res.status(400).json({error:'Payment link must use HTTPS'});
 const [p]=await db.update(propertiesTable).set({messageVariables:values}).where(eq(propertiesTable.id,Number(req.params.id))).returning({id:propertiesTable.id});if(!p)return res.status(404).json({error:'Property not found'});res.json(values);
}));
async function validated(body:any,partial=false){const schema=partial?insertTemplateSchema.partial():insertTemplateSchema;const p=schema.safeParse(body);if(!p.success)throw new Error('Enter a valid template');const d=p.data;if(d.trigger&&!TRIGGERS.includes(d.trigger))throw new Error('Choose a supported trigger');if(d.offsetHours!=null&&(d.offsetHours<0||d.offsetHours>8760))throw new Error('Offset must be 0–8760 hours');if(d.body!=null&&(!d.body.trim()||d.body.length>20000))throw new Error('Enter a message up to 20,000 characters');if(d.propertyId){const [prop]=await db.select({id:propertiesTable.id}).from(propertiesTable).where(eq(propertiesTable.id,d.propertyId));if(!prop)throw new Error('Property not found');}return d;}
router.post('/templates',asyncHandler(async(req,res)=>{try{const [row]=await db.insert(templatesTable).values(await validated(req.body) as any).returning();res.status(201).json(row);}catch(e){res.status(400).json({error:(e as Error).message});}}));
router.patch('/templates/:id',asyncHandler(async(req,res)=>{try{const [row]=await db.update(templatesTable).set(await validated(req.body,true)).where(eq(templatesTable.id,Number(req.params.id))).returning();if(!row)return res.status(404).json({error:'Not found'});res.json(row);}catch(e){res.status(400).json({error:(e as Error).message});}}));
router.delete('/templates/:id',asyncHandler(async(req,res)=>{await db.delete(templatesTable).where(eq(templatesTable.id,Number(req.params.id)));res.status(204).end();}));
export default router;
