import { useState } from 'react';
import { useLocation } from 'wouter';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export default function OwnerLoginPage() {
 const [,navigate] = useLocation();
 const [email,setEmail]=useState(''), [code,setCode]=useState(''), [ownerId,setOwnerId]=useState<number|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
 async function submit(e: React.FormEvent) {
  e.preventDefault(); setBusy(true); setError('');
  try {
   const r=await apiFetch(`/api/owner-auth/${ownerId?'verify':'send-code'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ownerId?{ownerId,code}:{email})});
   const data=await r.json(); if(!r.ok) throw new Error(data.message || data.error);
   if(!ownerId) setOwnerId(data.ownerId);
   else {sessionStorage.setItem('ownerPortalToken',data.token);sessionStorage.setItem('ownerPortalId',String(data.owner.id));sessionStorage.setItem('ownerPortalName',data.owner.name);navigate('/owner-portal');}
  } catch(e:any) {setError(e.message);} finally {setBusy(false);}
 }
 return <div className="min-h-screen bg-gradient-to-br from-[#0f2a3f] to-[#0a5c5c] flex items-center justify-center p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>YallaStay Owner Portal</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><p className="text-sm text-muted-foreground">{ownerId?'Enter the six-digit code sent to your email.':'Use the email address registered with your operator.'}</p><label className="block text-sm">{ownerId?'Access code':'Email'}<Input className="mt-2" required type={ownerId?'text':'email'} inputMode={ownerId?'numeric':'email'} maxLength={ownerId?6:254} value={ownerId?code:email} onChange={e=>ownerId?setCode(e.target.value):setEmail(e.target.value)}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={busy}>{busy?'Please wait…':ownerId?'Sign in':'Send access code'}</Button>{ownerId&&<Button type="button" variant="ghost" onClick={()=>{setOwnerId(null);setCode('');}}>Use another email / request new code</Button>}</form></CardContent></Card></div>;
}
