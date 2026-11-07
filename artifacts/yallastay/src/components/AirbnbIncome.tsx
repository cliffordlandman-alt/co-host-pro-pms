import { apiFetch } from "@/lib/api-fetch";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { aedNumber, formatAed } from '@/lib/aed-book';
const fmt=(n:number,c:string,date?:string)=>formatAed(n,c,date);
export async function airbnbRequest(path:string,token:string|null,body?:any){
 const r=await apiFetch(`/api/airbnb-data${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to load Airbnb data');return data;
}
export function AirbnbIncome(){
 const {token}=useAuth();const [expanded,setExpanded]=useState(false);
 const {data,error}=useQuery({queryKey:['airbnb-income'],queryFn:()=>airbnbRequest('',token),enabled:!!token});
 const totals:Record<string,number>={};
 for(const r of data?.rows||[]){totals[r.status]=(totals[r.status]||0)+Math.round((aedNumber(r.amount,r.currency,r.checkOut)||0)*100);}
 const paidCents=(data?.payouts||[]).reduce((n:number,p:any)=>n+Math.round((aedNumber(p.amount,p.currency,p.sourceDate)||0)*100),0);
 return <section className="rounded-xl border bg-white p-5 space-y-3">
  <div className="flex justify-between gap-4"><div><h2 className="font-semibold">Airbnb income</h2><p className="text-sm text-muted-foreground">Actual earnings and co-host shares from imported records, shown in dirhams.</p></div><Link href="/airbnb-import"><Button variant="outline">Import Airbnb data</Button></Link></div>
  {error?<p role="alert">{error.message}</p>:!data?.rows.length?<p className="text-sm">No earnings imported yet. Import your Airbnb earnings CSV to add bookings and income.</p>:<>
  <div className="flex flex-wrap gap-6">{Object.entries(totals).map(([status,cents])=><div key={status}><div className="text-xs text-muted-foreground capitalize">{status} income</div><strong className="text-xl">{fmt(cents/100,'AED')}</strong></div>)}</div>
  {paidCents?<p className="text-sm">Airbnb payout transfers: <strong>{fmt(paidCents/100,'AED')}</strong>. This is the same money as the earnings above, not additional income.</p>:null}
  <p className="text-xs text-muted-foreground">{new Set(data.rows.map((r:any)=>r.confirmationCode)).size} bookings · {data.rows.length} earnings entries. Covers imported records only. Full property revenue is unavailable for co-host-only records.</p>
  <Button variant="outline" onClick={()=>setExpanded(!expanded)}>{expanded?'Hide':'View'} earnings entries</Button>
  {expanded&&<div className="overflow-auto max-h-96"><table className="w-full text-sm"><thead><tr className="text-left"><th>Guest / booking</th><th>Stay</th><th>Type</th><th>Status</th><th className="text-right">Amount</th></tr></thead><tbody>{data.rows.map((r:any)=><tr key={r.id} className="border-t"><td className="p-2">{r.guestName}<div className="text-xs text-muted-foreground">{r.confirmationCode}</div></td><td>{r.checkIn} → {r.checkOut}</td><td>{r.kind==='home'?'Home earnings':r.amount<0?'Co-host deduction':'Co-host income'}</td><td>{r.status}</td><td className="text-right">{fmt(r.amount,r.currency,r.checkOut)}</td></tr>)}</tbody></table></div>}
  </>}
 </section>;
}
export default function AirbnbImport(){
 const {token}=useAuth();const qc=useQueryClient();const [input,setInput]=useState<any>(null);const [preview,setPreview]=useState<any>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [done,setDone]=useState<any>(null);const [raw,setRaw]=useState('');const [status,setStatus]=useState('paid');const [mapping,setMapping]=useState<Record<string,string>>({});
 const {data:properties=[]}=useQuery({queryKey:['import-properties'],queryFn:async()=>{const r=await apiFetch('/api/properties');if(!r.ok)throw new Error('Could not load properties');return r.json();}});
 async function review(value=input){setBusy(true);setError('');setDone(null);setPreview(null);try{if(!value)throw new Error('Choose a file first');setPreview(await airbnbRequest('/preview',token,{...value,status,mapping}));setInput(value);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(){setBusy(true);setError('');try{setDone(await airbnbRequest('/import',token,{...input,status,mapping}));setPreview(null);await qc.invalidateQueries();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="max-w-4xl mx-auto p-6 space-y-6"><h1 className="text-2xl font-bold">Import Airbnb bookings & income</h1><p>1. Download your earnings CSV (or the Reservations export) from Airbnb. 2. Review the matched listings. 3. Import bookings and income together.</p>
 <div className="border rounded-xl bg-white p-5 space-y-4"><a className="underline" href="https://www.airbnb.co.in/earnings" target="_blank" rel="noreferrer">Open Airbnb earnings</a><p className="text-sm">Choose Paid or Upcoming → View all → Export CSV. Keep the original English column names, confirmation codes, dates, listing names, currency, and amounts. This is a file import; it does not enable automatic syncing.</p>
 <label className="block">Records in this file <select className="border rounded p-2 ml-2" value={status} onChange={e=>{setStatus(e.target.value);setPreview(null);}}><option value="paid">Paid earnings</option><option value="scheduled">Upcoming earnings</option></select></label>
 <label className="block">Airbnb CSV file <input className="block mt-2" type="file" accept=".csv,text/csv" onChange={async e=>{setPreview(null);setDone(null);const file=e.target.files?.[0];if(file){if(file.size>5000000){setError('Choose a CSV smaller than 5 MB');return;}setInput({csv:await file.text()});setError('');}}}/></label>
 <Button disabled={busy||!input} onClick={()=>review()}>Review import</Button>
 <details><summary className="text-sm cursor-pointer">Import captured source records</summary><label className="block mt-2">Source records<textarea aria-label="Source records" className="border rounded w-full h-28 p-2" value={raw} onChange={e=>{setRaw(e.target.value);setPreview(null);}}/></label><Button variant="outline" disabled={busy} onClick={()=>{try{review(JSON.parse(raw));}catch{setError('Invalid source records');}}}>Review source records</Button></details>
 </div>
 {error&&<p role="alert" className="text-red-700">{error}</p>}
 {preview&&<section className="border rounded-xl p-5 space-y-3"><h2 className="font-semibold">Review your import</h2><p>{preview.bookings} bookings · {preview.records.length} earnings entries · {preview.existing} already imported</p>{preview.issues.map((name:string)=><label className="block" key={name}>Match “{name}” <select value={mapping[name]||''} className="border p-2" onChange={e=>{setMapping({...mapping,[name]:e.target.value});setPreview(null);}}><option value="">Choose property</option>{properties.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}<p className="text-sm">Bookings will appear on the calendar. Earnings appear under Airbnb income. Gross booking revenue is kept separate because payouts may represent only a co-host share.</p><div className="max-h-52 overflow-auto text-sm">{preview.records.map((r:any)=><div key={r.id} className="border-t py-2">{r.guest} · {r.listing} · {r.checkIn}–{r.checkOut} · {r.currency} {r.amount}</div>)}</div><Button disabled={busy||preview.issues.length>0} onClick={save}>{busy?'Importing…':'Import bookings & income'}</Button></section>}
 {done&&<section role="status" className="rounded-xl bg-emerald-50 p-5"><h2 className="font-semibold">Import saved</h2><p>{done.bookings} bookings in the file{done.bookingsCreated!=null?` · ${done.bookingsCreated} new bookings · ${done.linked} linked to existing stays · ${done.cancelled} cancelled${done.ignored?` · ${done.ignored} requests/inquiries ignored`:''}`:''}. {done.added} earnings entries added or updated; {done.skipped} unchanged or not stored.</p><div className="flex gap-5 mt-3"><Link className="underline" href="/multi-calendar">View calendar</Link><Link className="underline" href="/reports">View revenue</Link></div></section>}
 <AirbnbIncome/></div>;
}
