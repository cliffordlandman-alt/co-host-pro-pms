import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/components/ui/dialog';

// Booking amounts are entered here; the rates (management, channel, VAT, Tourism Dirham) are decided by
// the server: a verified booking keeps the rates snapshotted on it, a first verification (or
// "re-apply") uses the property's current fee settings.
export function BookingFinanceEditor({booking}:{booking:any}){
 const qc=useQueryClient();
 const verified=booking.financeMode==='inclusive-v1'&&booking.managementPercent!=null;
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [form,setForm]=useState({grossAmount:booking.grossAmount??booking.financials?.recordedAmount??'',cleaningFee:booking.cleaningFee??0,channelFees:booking.channelFees??'',tourismRooms:booking.tourismRooms??'',refreshRates:false,paymentStatus:booking.paymentStatus||'unknown',balanceDue:booking.balanceDue??''});
 const useCurrent=!verified||form.refreshRates;
 const {data:current,error:ratesError}=useQuery<any>({queryKey:['booking-rates',booking.propertyId,booking.platform],enabled:open,queryFn:async()=>{const r=await apiFetch(`/api/reservations/rates?propertyId=${booking.propertyId}&platform=${encodeURIComponent(booking.platform||'direct')}`);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Could not load fee settings');return r.json();}});
 const rates=useCurrent?current:{managementPercent:booking.managementPercent,channelPercent:booking.channelPercent??0,vatRate:booking.vatRate??0,tourismEnabled:Number(booking.tourismRooms)>0,tourismRate:booking.tourismRate??10,feeBasis:booking.feeBasis??'gross'};
 // Net-payout basis (the property's current one decides; a booking on another basis is recalculated on save).
 const netBasis=(current?.feeBasis??booking.feeBasis)==='net-payout';
 async function save(e:React.FormEvent){e.preventDefault();setSaving(true);setError('');try{
  const body:any={grossAmount:form.grossAmount,cleaningFee:form.cleaningFee,financeMode:'inclusive-v1',paymentStatus:form.paymentStatus,balanceDue:form.paymentStatus==='partial'?form.balanceDue:undefined,refreshRates:verified&&form.refreshRates?true:undefined,tourismRooms:form.tourismRooms===''?undefined:Number(form.tourismRooms),...(netBasis?{channelFees:String(form.channelFees)}:{})};
  const r=await apiFetch(`/api/reservations/${booking.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){const d=await r.json();throw new Error(d.error||'Could not save');}
  await qc.invalidateQueries();setOpen(false);
 }catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <><Button variant="outline" className="mt-4" onClick={()=>setOpen(true)}>Verify / edit booking finances</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Verify booking finances</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-3">
  <p className="text-sm text-muted-foreground">Use the full guest booking amount, including VAT and tourism fees. Do not use an Airbnb co-host payout as the booking total. Saved calculations update connected reports.</p>
  <label className="block text-sm">Full guest booking amount<Input required type="number" min="0" step="0.01" value={form.grossAmount} onChange={e=>setForm(f=>({...f,grossAmount:e.target.value}))}/></label>
  <label className="block text-sm">Cleaning deduction<Input required type="number" min="0" step="0.01" value={form.cleaningFee} onChange={e=>setForm(f=>({...f,cleaningFee:e.target.value}))}/></label>
  {netBasis&&<label className="block text-sm">Channel fees (actual: guest service fee + host service fee)<Input required type="number" min="0" step="0.01" aria-label="Channel fees (actual)" value={form.channelFees} onChange={e=>setForm(f=>({...f,channelFees:e.target.value}))}/><span className="text-xs text-muted-foreground">This property's management fee is a % of the net payout (guest total minus these fees).</span></label>}
  <div className="rounded-lg border p-3 text-sm space-y-1">
   <p className="font-medium">{useCurrent?'Rates from the property’s current fee settings':'Rates saved on this booking'}</p>
   {rates?<p className="text-muted-foreground">{netBasis?`Management ${rates.managementPercent}% of net payout · Channel fees: actual amount above`:`Management ${rates.managementPercent}% · Channel ${rates.channelPercent}%`} · VAT {rates.vatRate}% · Tourism Dirham {rates.tourismEnabled?`${rates.tourismRate} per room per night`:'off'}</p>:<p className="text-muted-foreground">{ratesError?(ratesError as Error).message:'Loading…'}</p>}
   {verified&&<label className="flex gap-2 items-start pt-1"><input type="checkbox" className="mt-1" checked={form.refreshRates} onChange={e=>setForm(f=>({...f,refreshRates:e.target.checked}))}/><span>Re-apply the property’s current fee settings to this booking</span></label>}
   <p className="text-xs text-muted-foreground">Rates are changed under Accounting → Fee settings, not per booking.</p>
  </div>
  {rates?.tourismEnabled&&!booking.tourismRooms&&<label className="block text-sm">Bedrooms for Tourism Dirham (only needed if the property has no bedroom count; studio = 1)<Input type="number" min="1" step="1" value={form.tourismRooms} onChange={e=>setForm(f=>({...f,tourismRooms:e.target.value}))}/></label>}
  <label className="block text-sm">Guest payment status<select className="border rounded p-2 w-full bg-background" value={form.paymentStatus} onChange={e=>setForm(f=>({...f,paymentStatus:e.target.value}))}>{['unknown','pending','partial','paid'].map(v=><option key={v}>{v}</option>)}</select></label>
  {form.paymentStatus==='partial'&&<label>Outstanding guest balance<Input required type="number" min="0.01" step="0.01" value={form.balanceDue} onChange={e=>setForm(f=>({...f,balanceDue:e.target.value}))}/></label>}
  {error&&<p role="alert" className="text-red-600">{error}</p>}
  <Button disabled={saving} type="submit">{saving?'Saving…':'Save verified breakdown'}</Button>
 </form></DialogContent></Dialog></>;
}
