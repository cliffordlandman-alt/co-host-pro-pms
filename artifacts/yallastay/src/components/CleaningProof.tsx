import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
export function CleaningProof({task}:{task:any}) {
 const [busy,setBusy]=useState(false); const qc=useQueryClient(); const {toast}=useToast();
 async function upload(file?:File) {
  if(!file) return; setBusy(true);
  try {
   if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>1000000) throw new Error('Choose a JPEG, PNG or WebP photo under 1 MB');
   const photo=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});
   const r=await apiFetch(`/api/cleaning/${task.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({photos:[...(task.photos || []),photo]})});
   if(!r.ok) throw new Error((await r.json()).error); await qc.invalidateQueries();toast({title:'Photo proof saved'});
  } catch(e:any) {toast({title:'Could not add photo',description:e.message,variant:'destructive'});} finally {setBusy(false);}
 }
 return <div className="space-y-2"><label className="text-xs font-medium cursor-pointer border rounded-md px-3 py-2 inline-block">{busy?'Uploading…':'Add cleaning photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={e=>upload(e.target.files?.[0])}/></label><div className="flex flex-wrap gap-2">{(task.photos || []).map((src:string,i:number)=><a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Cleaning proof ${i+1}`} className="h-20 w-20 object-cover rounded"/></a>)}</div></div>;
}
