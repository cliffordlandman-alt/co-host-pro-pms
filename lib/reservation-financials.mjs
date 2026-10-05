// Read-only financial projection. Payouts never substitute for a guest's gross total.
const amount=v=>v==null||v===''?null:Number(v);
export function reservationFinancials(booking,earnings=[],property={}) {
 const linked=earnings.filter(e=>booking.externalId===`airbnb:${e.confirmationCode}`&&Number(e.propertyId)===Number(booking.propertyId));
 // The booking's own currency when stamped (its property's currency changed later), else the property's.
 const currency=booking.currency||property.currency||'AED';
 const verified=booking.financeMode==='inclusive-v1';
 const recorded=amount(booking.revenue);
 const gross=verified?amount(booking.grossAmount):null;
 const balance=booking.paymentStatus==='unknown'?null:amount(booking.balanceDue);
 const groups={};
 for(const e of linked){const key=`${e.currency}:${e.kind}:${e.status}`;const g=groups[key]??={currency:e.currency,kind:e.kind,status:e.status,amount:0};g.amount+=Math.round(Number(e.amount)*100);}
 return {currency,verified,state:verified?'verified':linked.length?'channel_earnings_only':recorded>0?'legacy_amount':'missing',grossAmount:gross,accommodationRevenue:verified?recorded:null,recordedAmount:!verified&&recorded>0?recorded:null,cleaningFee:verified?amount(booking.cleaningFee):null,tourismFee:verified?amount(booking.tourismFee):null,vatAmount:verified?amount(booking.vatAmount):null,channelAmount:verified?amount(booking.channelAmount):null,managementAmount:verified?amount(booking.managementAmount):null,ownerAmount:verified?amount(booking.ownerAmount):null,amountPending:balance,amountPaid:gross!=null&&balance!=null?Math.round((gross-balance)*100)/100:null,channelEarnings:Object.values(groups).map(g=>({...g,amount:g.amount/100})),hasChannelEarnings:linked.length>0};
}
export function financialTotals(bookings,earnings=[],properties=[],start='0001-01-01',end='9999-12-31') {
 const totals={};let missing=0;
 for(const b of bookings){if(['cancelled','blocked'].includes(b.status)||b.checkOut<start||b.checkOut>end)continue;const f=b.financials||reservationFinancials(b,earnings,properties.find(p=>p.id===b.propertyId));if(!f.verified){missing++;continue;}const t=totals[f.currency]??={currency:f.currency,bookings:0,grossAmount:0,accommodationRevenue:0,cleaningFee:0,tourismFee:0,vatAmount:0,channelAmount:0,managementAmount:0,ownerAmount:0,amountPaid:0,amountPending:0};t.bookings++;for(const key of Object.keys(t))if(!['currency','bookings'].includes(key))t[key]+=Math.round(Number(f[key]||0)*100);}
 return {missing,totals:Object.values(totals).map(t=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,['currency','bookings'].includes(k)?v:v/100])))};
}
