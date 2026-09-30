import { useState } from 'react';
import { useGetProperties } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
export function BlockDatesDialog(){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[form,setForm]=useState({propertyId:'',checkIn:'',checkOut:'',reason:''});
 const {data:properties}=useGetProperties();const qc=useQueryClient();const {toast}=useToast();
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);try{const r=await apiFetch('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId:Number(form.propertyId),guestName:`Blocked: ${form.reason || 'Unavailable'}`,checkIn:form.checkIn,checkOut:form.checkOut,status:'blocked',platform:'direct',revenue:0,balanceDue:0,paymentStatus:'paid'})});const result=await r.json();if(!r.ok)throw new Error(result.error);await qc.invalidateQueries();setOpen(false);toast({title:'Dates blocked'});}catch(e:any){toast({title:'Could not block dates',description:e.message,variant:'destructive'});}finally{setBusy(false);}}
 return <><Button variant="outline" onClick={()=>setOpen(true)}>Block dates</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Block unavailable nights</DialogTitle></DialogHeader><form className="space-y-3" onSubmit={save}><label className="block text-sm">Property<select required className="w-full p-2 border rounded bg-background" value={form.propertyId} onChange={e=>setForm(f=>({...f,propertyId:e.target.value}))}><option value="">Choose property</option>{properties?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{[['checkIn','First blocked night'],['checkOut','Available again'],['reason','Reason']].map(([k,label])=><label key={k} className="block text-sm">{label}<Input required={k!=='reason'} type={k==='reason'?'text':'date'} value={form[k as keyof typeof form]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}<p className="text-xs text-muted-foreground">The end date is available for arrivals. Open the block in Reservations and cancel it to release the dates.</p><Button disabled={busy}>Block dates</Button></form></DialogContent></Dialog></>;
}
