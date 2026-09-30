export type PMSRecord = Record<string, any>;
export const dubaiToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function mainPhoto(p:PMSRecord) {try {const photos=JSON.parse(p.photos || '[]');return typeof photos[0]==='string'?photos[0]:null;}catch{return null;}}
export function makeToday(properties:PMSRecord[],bookings:PMSRecord[],cleaning:PMSRecord[],maintenance:PMSRecord[],today:string) {
 const active=bookings.filter(b=>!['cancelled','blocked'].includes(b.status));
 const arrivals=active.filter(b=>b.checkIn===today),departures=active.filter(b=>b.checkOut===today);
 const jobs=cleaning.filter(t=>t.status!=='cancelled');
 const openIssues=maintenance.filter(t=>!['completed','resolved','cancelled'].includes(t.status));
 const readiness=properties.filter(p=>p.status==='active').map(p=>{
  const stays=active.filter(b=>b.propertyId===p.id);
  const current=stays.find(b=>b.checkIn<=today && b.checkOut>today && b.status!=='checked_out');
  const upcoming=stays.filter(b=>b.checkIn>=today && b.status==='confirmed').sort((a,b)=>a.checkIn.localeCompare(b.checkIn));
  const next=upcoming[0];
  const lastDeparture=stays.filter(b=>b.checkOut<=today).sort((a,b)=>b.checkOut.localeCompare(a.checkOut))[0];
  const task=jobs.filter(t=>t.propertyId===p.id && t.scheduledDate<=today && (!lastDeparture || t.scheduledDate>=lastDeparture.checkOut)).sort((a,b)=>b.scheduledDate.localeCompare(a.scheduledDate)||b.id-a.id)[0];
  const issues=openIssues.filter(t=>t.propertyId===p.id);
  let status='NOT READY',reason='Readiness has not been verified';
  if(issues.length){status='MAINTENANCE';reason=`${issues.length} unresolved issue${issues.length===1?'':'s'}`;}
  else if((current && current.checkIn<today) || current?.status==='checked_in'){status='OCCUPIED';reason=`${current.guestName} · until ${current.checkOut}`;}
  else if(task?.status==='approved'){status='READY';reason='Cleaning and inspection approved';}
  else if(task?.status==='completed'){status='INSPECTION';reason='Cleaning complete · approval needed';}
  else if(task?.status==='in_progress'){status='CLEANING';reason='Cleaning in progress';}
  else if(task){reason=task.assignedToId?'Cleaning is still pending':'Cleaning needs an assignment';}
  return {...p,id:Number(p.id),name:String(p.name),unitNumber:p.unitNumber as string,city:p.city as string,currency:p.currency as string,current,next,upcoming,task,issues,status,reason,photo:mainPhoto(p)};
 });
 const timeline=[
  ...departures.map(b=>({id:`departure-${b.id}`,title:'Guest checkout',detail:b.guestName,propertyId:b.propertyId,time:null as string|null,done:b.status==='checked_out',href:`/reservations/${b.id}`,type:'departure'})),
  ...jobs.filter(t=>t.scheduledDate===today).map(t=>({id:`cleaning-${t.id}`,title:t.status==='completed'?'Inspection required':'Cleaning',detail:t.assignedToName || 'Cleaner not assigned',propertyId:t.propertyId,time:t.scheduledTime || null,done:['completed','approved'].includes(t.status),href:`/cleaning?task=${t.id}`,type:'cleaning'})),
  ...arrivals.map(b=>({id:`arrival-${b.id}`,title:'Guest check-in',detail:b.guestName,propertyId:b.propertyId,time:null as string|null,done:['checked_in','checked_out'].includes(b.status),href:`/reservations/${b.id}`,type:'arrival'})),
 ].map(e=>({...e,propertyName:properties.find(p=>p.id===e.propertyId)?.name || 'Property'})).sort((a,b)=>(a.time || '99').localeCompare(b.time || '99'));
 return {active,arrivals,departures,jobs,openIssues,readiness,timeline,completed:timeline.filter(e=>e.done).length};
}
