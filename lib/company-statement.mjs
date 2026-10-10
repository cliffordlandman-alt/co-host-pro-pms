import { reservationFinancials } from "./reservation-financials.mjs";
export function earningsDate(e) {
 const raw=String(e.sourceDate||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
 const match=raw.match(/^(\d{1,2})\s+([A-Za-z]+)(?:,?\s+(\d{4}))?$/);
 if(!match)return null;
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const m=months.findIndex(m=>m.startsWith(match[2].toLowerCase()));if(m<0)return null;
 let year=Number(match[3]||String(e.checkIn||'').slice(0,4));if(!year)return null;
 if(!match[3]&&m+1<Number(String(e.checkIn).slice(5,7)))year++;
 const date=`${year}-${String(m+1).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
 return Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;
}
export function companyStatement({earnings=[],bookings=[],transactions=[],properties=[],maintenance=[],settings=[]},start,end){
 earnings=earnings.map(e=>({...e,sourceDate:earningsDate(e),dateYearInferred:!/^\d{4}-\d{2}-\d{2}$/.test(e.sourceDate||'')}));
 const within=d=>!!d&&d>=start&&d<=end;
 const property=id=>properties.find(p=>p.id===id);
 const cents=v=>Math.round(Number(v||0)*100);
 const lines=[];
 const cohostCodes=new Set(earnings.filter(e=>e.kind==='cohost').map(e=>`airbnb:${e.confirmationCode}`));
 for(const e of earnings) if(e.kind==='cohost'&&Number(e.amount)>0&&e.status==='paid'&&within(e.sourceDate)) lines.push({id:`airbnb-${e.id}`,propertyId:e.propertyId??null,date:e.sourceDate,description:`Airbnb co-host income · ${e.guestName}`,propertyName:property(e.propertyId)?.name,category:'Airbnb co-host',currency:e.currency,type:'income',amount:cents(e.amount)/100,source:e.dateYearInferred?'Airbnb · year from stay':'Airbnb'});
 // A 0% fee (e.g. an owner Airbnb pays directly, fee 0) is no company income: no zero lines.
 for(const b of bookings) if(b.financeMode==='inclusive-v1'&&!['cancelled','blocked'].includes(b.status)&&within(b.checkOut)&&!cohostCodes.has(b.externalId)&&Math.round(Number(b.managementAmount||0)*100)!==0) lines.push({id:`booking-${b.id}`,propertyId:b.propertyId,date:b.checkOut,description:`Management fee · ${b.guestName}`,propertyName:property(b.propertyId)?.name,category:'Management commission',currency:b.currency||property(b.propertyId)?.currency||'AED',type:'income',amount:reservationFinancials(b,earnings,property(b.propertyId)).managementAmount,source:'Booking'});
 // Cleaning fee on a booking is company income: it is what the owner is charged for cleaning (same rule
 // as the owner statement, which skips it when the property's 'include cleaning' setting is off).
 for(const b of bookings) if(b.financeMode==='inclusive-v1'&&!['cancelled','blocked'].includes(b.status)&&within(b.checkOut)&&!cohostCodes.has(b.externalId)&&cents(b.cleaningFee)>0&&settings.find(x=>x.propertyId===b.propertyId)?.includeCleaning!==false) lines.push({id:`cleaning-fee-${b.id}`,propertyId:b.propertyId,date:b.checkOut,description:`Cleaning fee · ${b.guestName}`,propertyName:property(b.propertyId)?.name,category:'Cleaning income',currency:b.currency||property(b.propertyId)?.currency||'AED',type:'income',amount:cents(b.cleaningFee)/100,source:'Booking'});
 // Pass-through costs (e.g. DEWA, treatment set since migration 0025) net to zero: never company P&L.
 for(const t of transactions) if(t.paymentStatus!=='void'&&t.allocation==='company'&&t.treatment!=='pass_through'&&within(t.date)&&['income','expense'].includes(t.type)) lines.push({...t,id:`manual-${t.id}`,amount:cents(t.amount)/100,propertyName:property(t.propertyId)?.name,source:t.cleaningTaskId?'Cleaning (automatic)':'Manual'});
 for(const m of maintenance)if(m.chargeType==='company'&&m.status==='completed'&&within(String(m.completedAt||'').slice(0,10))&&!transactions.some(t=>t.reference===`maintenance:${m.id}`&&t.allocation==='company'))lines.push({id:`maintenance-${m.id}`,propertyId:m.propertyId??null,date:String(m.completedAt).slice(0,10),description:m.issue,propertyName:property(m.propertyId)?.name,category:'Maintenance',currency:property(m.propertyId)?.currency||'AED',type:'expense',amount:cents(m.cost)/100,source:'Maintenance'});
 lines.sort((a,b)=>b.date.localeCompare(a.date)||String(a.id).localeCompare(String(b.id)));
 const totals={};for(const l of lines){const t=totals[l.currency]??={income:0,expenses:0};t[l.type==='income'?'income':'expenses']+=cents(l.amount);}
 const cleaning={};for(const l of lines){const inc=l.category==='Cleaning income'&&l.type==='income',exp=/^cleaning$/i.test(String(l.category||''))&&l.type==='expense';if(!inc&&!exp)continue;const c=cleaning[l.currency]??={income:0,expenses:0,cleans:0};if(inc)c.income+=cents(l.amount);else{c.expenses+=cents(l.amount);c.cleans++;}}
 return {start,end,lines,cleaning:Object.entries(cleaning).map(([currency,c])=>({currency,income:c.income/100,expenses:c.expenses/100,net:(c.income-c.expenses)/100,cleans:c.cleans})),totals:Object.entries(totals).map(([currency,t])=>({currency,income:t.income/100,expenses:t.expenses/100,net:(t.income-t.expenses)/100})),unallocatedAdjustments:earnings.filter(e=>e.kind==='cohost'&&Number(e.amount)<0&&within(e.sourceDate)).length,unallocatedHomeEarnings:earnings.filter(e=>e.kind==='home'&&within(e.sourceDate)).length,missingBookingFees:bookings.filter(b=>b.financeMode!=='inclusive-v1'&&!cohostCodes.has(b.externalId)&&!['cancelled','blocked'].includes(b.status)&&within(b.checkOut)).length};
}
