import { guestIdComplete } from "../../../../lib/guest-id.mjs";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { dubaiToday } from '../lib/dubai-date';
import { Router } from 'express';
import { db, reservationsTable, propertiesTable, cleaningTasksTable, maintenanceTicketsTable, ownerStatementsTable } from '@workspace/db';
const router=Router();
router.get('/task-centre',async (_req,res)=>{
 const today=dubaiToday();
 const [bookings,properties,cleaning,maintenance,statements]=await Promise.all([db.select().from(reservationsTable),db.select().from(propertiesTable),db.select().from(cleaningTasksTable),db.select().from(maintenanceTicketsTable),db.select().from(ownerStatementsTable)]);
 const tasks:any[]=[];const name=(id:number)=>properties.find(p=>p.id===id)?.name || 'Property';
 for(const b of bookings.filter(b=>!['cancelled','blocked'].includes(b.status))) {
  const label=`${b.guestName} · ${name(b.propertyId)}`;
  if(Number(b.balanceDue)>0) tasks.push({id:`pay-${b.id}`,type:'Payment due',title:label,detail:`${bookingCurrency(b,properties.find(p=>p.id===b.propertyId))} ${b.balanceDue} outstanding`,href:`/reservations/${b.id}`});
  if(b.checkOut===today) tasks.push({id:`out-${b.id}`,type:'Checkout today',title:label,detail:'Confirm checkout and cleaning',href:`/reservations/${b.id}`});
  if(!guestIdComplete(b) && b.checkOut>=today) tasks.push({id:`id-${b.id}`,type:'Guest ID missing',title:label,detail:`Arrival ${b.checkIn}`,href:`/reservations/${b.id}`});
 }
 for(const t of cleaning.filter(t=>!['completed','approved','cancelled'].includes(t.status))) if(!t.assignedToId || t.scheduledDate<=today) tasks.push({id:`clean-${t.id}`,type:!t.assignedToId?'Cleaning unassigned':'Cleaning due',title:name(t.propertyId),detail:t.scheduledDate,href:'/cleaning'});
 for(const t of maintenance.filter(t=>!['resolved','completed','cancelled'].includes(t.status))) tasks.push({id:`maint-${t.id}`,type:'Maintenance open',title:name(t.propertyId),detail:t.issue,href:'/maintenance'});
 if(["admin","super_admin","manager","accountant"].includes(res.locals.user.role)) for(const s of statements.filter(s=>s.status==='sent' && Number(s.ownerPayout)>0)) tasks.push({id:`owner-${s.id}`,type:'Owner payout due',title:name(s.propertyId),detail:`${s.currency} ${s.ownerPayout} · ${s.month}`,href:'/accounting'});
 res.json(tasks);
});
export default router;
