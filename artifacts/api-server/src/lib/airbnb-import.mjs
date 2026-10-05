import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function money(value) {
 const clean=String(value).replace(/ﺩ\.ﺇ/g,'').replace(/[^0-9.\-]/g,'');
 if(!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new Error('Invalid amount');
 return (Math.round(Number(clean)*100)/100).toFixed(2);
}
function iso(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value).toISOString().slice(0,10)!==value)throw new Error('Invalid date: '+value);
 return value;
}
function csvDate(value) {
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return iso(value);
 const m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(!m)throw new Error('Use the original English Airbnb CSV with MM/DD/YYYY dates.');
 return iso(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`);
}
// Airbnb reservation statuses: cancelled stays are kept as cancelled bookings; requests/inquiries are not bookings.
export function reservationState(status) {
 const s=String(status||'').trim().toLowerCase();
 if(/^cancel+ed\b/.test(s))return 'cancelled';
 if(/^(pending|request|inquiry|enquiry|declined|expired|withdrawn|not possible)/.test(s))return 'ignore';
 if(/^(confirmed|past guest|awaiting guest review|review guest|currently hosting|arriving soon|checking out|upcoming|checked out)/.test(s))return 'booked';
 throw new Error(`Unknown Airbnb reservation status "${status}". Review this file before importing.`);
}
// "Earnings" carries a currency symbol; only unambiguous symbols are accepted unless a Currency column exists.
export function earningsAmount(value,currencyColumn) {
 const v=String(value||'').replace(/\u00a0/g,' ').trim();
 let currency=currencyColumn&&/^[A-Z]{3}$/.test(currencyColumn.trim())?currencyColumn.trim():null;
 if(!currency){
  if(/ﺩ\.ﺇ|د\.إ|\bAED\b/.test(v))currency='AED';
  else if(/^-?R\s?[\d-]/.test(v)||/\bZAR\b/.test(v))currency='ZAR';
  else if(/€|\bEUR\b/.test(v))currency='EUR';
  else if(/£|\bGBP\b/.test(v))currency='GBP';
  else if(/₹|\bINR\b/.test(v))currency='INR';
  else throw new Error(`Cannot tell the currency of "${v}". Export in a currency with a clear symbol or add a Currency column.`);
 }
 return {currency,amount:money(v.replace(/ﺩ\.ﺇ|د\.إ|[A-Z]{3}/g,'').replace(/^(-?)R\s?/,'$1'))};
}
export function parseCsv(text) {
 const rows=[]; let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++) { const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('Incomplete CSV quoted field');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const headers=rows.shift()?.map(v=>v.replace(/^\uFEFF/,'').trim())||[];
 if(new Set(headers).size!==headers.length)throw new Error('Duplicate CSV columns');
 return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw new Error('CSV column count mismatch');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function normalizeImport(input,properties) {
 const records=[],payouts=[],issues=[],ignored=[]; const mapping=input.mapping||{};
 const add=(r)=>{
  if(!/^[A-Z0-9]{6,20}$/.test(r.code||''))throw new Error('Missing confirmation code');
  iso(r.checkIn);iso(r.checkOut); if(r.checkOut<=r.checkIn)throw new Error('Checkout must follow check-in');
  if(!/^[A-Z]{3}$/.test(r.currency))throw new Error('Missing currency');
  const matches=properties.filter(p=>mapping[r.listing]?p.id===Number(mapping[r.listing]):p.name===r.listing);
  if(matches.length!==1){issues.push(r.listing);return;}
  const amount=money(r.amount);
  const {idKey,...rest}=r;
  records.push({...rest,amount,propertyId:matches[0].id,id:hash(idKey||[r.payoutId||r.sourceDate,r.code,r.kind,r.currency,amount,r.status])});
 };
 if(input.payouts) {
  if(!Array.isArray(input.payouts)||input.payouts.length>10000)throw new Error('Invalid source records');
  for(const p of input.payouts){
   if(p.id)payouts.push({id:p.id,currency:'USD',amount:money(p.payout),sourceDate:p.paidDate});
   for(const item of p.items){
    const m=item.stay.match(/^(Home|Co-Host payout)・([A-Za-z]{3}) (\d+) – (?:([A-Za-z]{3}) )?(\d+), (\d{4})$/);
    if(!m)throw new Error('Unrecognized stay dates: '+item.stay);
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const date=(mo,day)=>`${m[6]}-${String(months.indexOf(mo)+1).padStart(2,'0')}-${day.padStart(2,'0')}`;
    add({code:item.code,guest:item.guest,listing:item.listing,checkIn:date(m[2],m[3]),checkOut:date(m[4]||m[2],m[5]),kind:m[1]==='Home'?'home':'cohost',currency:item.currency,amount:item.amount,status:p.status||'paid',payoutId:p.id||null,sourceDate:p.paidDate});
   }
  }
 } else if(typeof input.csv==='string') {
  const rows=parseCsv(input.csv);
  if(rows.length>10000)throw new Error('Please split files larger than 10,000 rows');
  if(rows.length&&!('Type' in rows[0])&&'Earnings' in rows[0]&&'Status' in rows[0]){
   // Airbnb Reservations export (Hosting > Reservations > Export). "Earnings" is Airbnb's expected
   // host payout, not the guest total: bookings stay unverified and earnings are stored as "expected".
   for(const r of rows){
    const state=reservationState(r.Status);
    if(state==='ignore'){ignored.push({code:r['Confirmation code'],status:r.Status});continue;}
    const {currency,amount}=earningsAmount(r.Earnings,r.Currency);
    add({code:r['Confirmation code'],guest:r['Guest name']||'Airbnb guest',listing:r.Listing,checkIn:csvDate(r['Start date']),checkOut:csvDate(r['End date']),kind:'home',currency,amount,status:'expected',payoutId:null,sourceDate:csvDate(r.Booked||r['Start date']),source:'reservations',bookingStatus:state,idKey:['reservations-export',r['Confirmation code']]});
   }
  } else for(const r of rows){
   const type=r.Type?.toLowerCase();
   if(type==='payout'){continue;} // Settlement totals are not additional booking income.
   if(!['reservation','co-host payout','co-hosting payout'].includes(type))throw new Error(`Unsupported transaction type: ${r.Type}. Review this file before importing.`);
   add({code:r['Confirmation code']||r['Confirmation Code'],guest:r.Guest,listing:r.Listing,checkIn:csvDate(r['Start date']),checkOut:csvDate(r['End date']),kind:type==='reservation'?'home':'cohost',currency:r.Currency,amount:r.Amount,status:input.status==='scheduled'?'scheduled':'paid',payoutId:null,sourceDate:r.Date});
  }
 } else throw new Error('Choose an Airbnb CSV file');
 if(!records.length&&!issues.length)throw new Error('No booking records found');
 if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Duplicate transactions in this file; review before importing');
 return {records,payouts,issues:[...new Set(issues)],ignored};
}
