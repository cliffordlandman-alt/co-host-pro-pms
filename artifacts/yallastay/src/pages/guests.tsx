import { guestIdLabel } from "../../../../lib/guest-id.mjs";
import { useState } from 'react';
import { useGetReservations } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Link } from 'wouter';
export default function Guests(){
 const {data,isLoading,error}=useGetReservations(); const [search,setSearch]=useState('');
 const bookings=(data as any[] || []).filter(r=>r.status!=='blocked' && `${r.guestName} ${r.guestEmail || ''} ${r.guestPhone || ''}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="space-y-5"><h1 className="text-2xl font-bold">Guests</h1><p className="text-sm text-muted-foreground">Guest contacts and ID verification are saved with each booking. Open a booking to update details and notes.</p><Input aria-label="Search guests" placeholder="Search name, email or phone" value={search} onChange={e=>setSearch(e.target.value)}/>{isLoading?<p>Loading…</p>:error?<p role="alert">Could not load guests.</p>:<div className="grid gap-3 md:grid-cols-2">{bookings.map(r=><Link key={r.id} href={`/reservations/${r.id}`}><div className="border bg-card rounded-lg p-4"><p className="font-medium">{r.guestName}</p><p className="text-sm text-muted-foreground">{r.guestEmail || 'Email not recorded'} · {r.guestPhone || 'Phone not recorded'}</p><p className="text-xs mt-2">{r.propertyName} · {r.checkIn} → {r.checkOut}</p><p className="text-xs mt-2">{guestIdLabel(r)==='ID pending'?'ID verification needed':guestIdLabel(r)}</p></div></Link>)}</div>}</div>;
}
