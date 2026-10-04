import { guestIdComplete } from "../../../../lib/guest-id.mjs";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { dubaiToday, addDays } from '../lib/dubai-date';
import { renewalReminders, reminderText, filingReminder, registrationStatus, isDubai } from "../../../../lib/compliance.mjs";
import { Router } from 'express';
import { db, reservationsTable, propertiesTable, cleaningTasksTable, maintenanceTicketsTable, ownerStatementsTable, propertyPermitsTable, complianceFilingsTable } from '@workspace/db';
const router=Router();
router.get('/task-centre',async (_req,res)=>{
 const today=dubaiToday();
 const [bookings,properties,cleaning,maintenance,statements,permits,filings]=await Promise.all([db.select().from(reservationsTable),db.select().from(propertiesTable),db.select().from(cleaningTasksTable),db.select().from(maintenanceTicketsTable),db.select().from(ownerStatementsTable),db.select().from(propertyPermitsTable),db.select().from(complianceFilingsTable)]);
 const tasks:any[]=[];const name=(id:number)=>properties.find(p=>p.id===id)?.name || 'Property';
 for(const b of bookings.filter(b=>!['cancelled','blocked'].includes(b.status))) {
  const label=`${b.guestName} · ${name(b.propertyId)}`;
  if(Number(b.balanceDue)>0) tasks.push({id:`pay-${b.id}`,type:'Payment due',title:label,detail:`${bookingCurrency(b,properties.find(p=>p.id===b.propertyId))} ${b.balanceDue} outstanding`,href:`/reservations/${b.id}`});
  if(b.checkOut===today) tasks.push({id:`out-${b.id}`,type:'Checkout today',title:label,detail:'Confirm checkout and cleaning',href:`/reservations/${b.id}`});
  if(!guestIdComplete(b) && b.checkOut>=today) tasks.push({id:`id-${b.id}`,type:'Guest ID missing',title:label,detail:`Arrival ${b.checkIn}`,href:`/reservations/${b.id}`});
  // DTCM guest registration still pending for a Dubai stay arriving within 2 days or in the house now (never Airbnb).
  const property=properties.find(p=>p.id===b.propertyId);
  if(b.checkIn<=addDays(today,2) && b.checkOut>=today && registrationStatus(b,property)==='pending') tasks.push({id:`dtcm-${b.id}`,type:'DTCM registration pending',title:label,detail:`Arrival ${b.checkIn}: register the guest with DTCM, then mark Registered`,href:`/reservations/${b.id}`,urgency:b.checkIn<=today?'high':'medium'});
 }
 // Dubai compliance: renewals from 60 days ahead (more urgent at 30 and 7), and last month's Tourism Dirham return (due on the 15th).
 const compliance:any[]=[];
 if(["admin","super_admin","manager","accountant"].includes(res.locals.user.role)) {
  const active=properties.filter(p=>p.status!=='archived');
  for(const r of renewalReminders(permits,active,today)) compliance.push({id:`renew-${r.propertyId}-${r.field}`,type:r.stage==='expired'?'Permit expired':'Renewal due',title:r.propertyName,detail:reminderText(r),href:'/compliance',urgency:['expired','7'].includes(r.stage)?'high':r.stage==='30'?'medium':'low'});
  const f=filingReminder({today,filings,hasDubai:active.some(isDubai)});
  if(f) compliance.push({id:`filing-${f.kind}-${f.period}`,type:'Tourism Dirham return',title:`Return for ${f.period}`,detail:f.overdue?`Was due on ${f.due} (${-f.days} days ago). File it on the DTCM portal, then mark it filed.`:`Due by ${f.due} (${f.days} day${f.days===1?'':'s'} left). File it on the DTCM portal, then mark it filed.`,href:`/compliance?tab=tax&month=${f.period}`,urgency:f.overdue||f.days<=3?'high':'medium'});
 }
 for(const t of cleaning.filter(t=>!['completed','approved','cancelled'].includes(t.status))) if(!t.assignedToId || t.scheduledDate<=today) tasks.push({id:`clean-${t.id}`,type:!t.assignedToId?'Cleaning unassigned':'Cleaning due',title:name(t.propertyId),detail:t.scheduledDate,href:'/cleaning'});
 for(const t of maintenance.filter(t=>!['resolved','completed','cancelled'].includes(t.status))) tasks.push({id:`maint-${t.id}`,type:'Maintenance open',title:name(t.propertyId),detail:t.issue,href:'/maintenance'});
 if(["admin","super_admin","manager","accountant"].includes(res.locals.user.role)) for(const s of statements.filter(s=>s.status==='sent' && Number(s.ownerPayout)>0)) tasks.push({id:`owner-${s.id}`,type:'Owner payout due',title:name(s.propertyId),detail:`${s.currency} ${s.ownerPayout} · ${s.month}`,href:'/accounting'});
 // Most urgent first: high, then medium, then the usual items, then early (60-day) renewals.
 const by=(list:any[],u:string)=>list.filter(t=>t.urgency===u);
 res.json([...by(compliance,'high'),...by(tasks,'high'),...by(compliance,'medium'),...by(tasks,'medium'),...tasks.filter(t=>!t.urgency),...by(compliance,'low')]);
});
export default router;
