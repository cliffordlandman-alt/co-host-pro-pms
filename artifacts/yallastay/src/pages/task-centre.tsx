import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
export default function TaskCentre(){
 const {data,isLoading,error}=useQuery({queryKey:['task-centre'],queryFn:async()=>{const r=await apiFetch('/api/task-centre');if(!r.ok) throw new Error('Could not load tasks');return r.json();}});
 return <div className="space-y-5"><h1 className="text-2xl font-bold">Task Centre</h1><p className="text-sm text-muted-foreground">Live actions from your bookings, cleaning, maintenance and owner statements.</p>{isLoading?<p>Loading…</p>:error?<p role="alert">Could not load tasks. Please refresh.</p>:!data?.length?<p>No outstanding actions.</p>:<div className="grid gap-3 md:grid-cols-2">{data.map((t:any)=><Link key={t.id} href={t.href}><div className="border bg-card rounded-lg p-4 hover:bg-muted/30"><Badge variant="secondary" className={t.urgency==='high'?'bg-rose-100 text-rose-800':t.urgency==='medium'?'bg-amber-100 text-amber-900':''}>{t.type}</Badge><p className="font-medium mt-2">{t.title}</p><p className="text-sm text-muted-foreground mt-1">{t.detail}</p></div></Link>)}</div>}</div>;
}
