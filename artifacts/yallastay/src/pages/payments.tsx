import { Link } from "wouter";
import { money } from "@/components/ReservationMoney";
import { useState, useEffect } from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";
import { useQueryClient } from "@tanstack/react-query";
import { useGetReservations } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";

export default function Payments() {
  const [type,setType]=useState("all"),[status,setStatus]=useState("all"),[search,setSearch]=useState(""),[q,setQ]=useState("");
  useEffect(()=>{const t=setTimeout(()=>setQ(search.trim()),300);return()=>clearTimeout(t);},[search]);
  // Paged on the server; the totals strip is the server's sum over ALL matching payments, per currency and status.
  const list=usePagedList<any,any>("payments","payments",{type,status,q});
  const payments=list.data?.items, isLoading=list.isLoading, summary=list.data?.summary;
  const {data:bookings}=useGetReservations();
  const [open,setOpen]=useState(false),[reservationId,setReservationId]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false);
  const qc=useQueryClient(); const {toast}=useToast();
  async function save(e:React.FormEvent) {
    e.preventDefault();setBusy(true);
    try {const r=await apiFetch('/api/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'guest_payment',reservationId:Number(reservationId),amount,status:'paid',dueDate:new Date().toISOString().slice(0,10)})});const data=await r.json();if(!r.ok) throw new Error(data.error);await qc.invalidateQueries();setOpen(false);setAmount('');toast({title:'Payment recorded and booking balance updated'});}catch(e:any){toast({title:'Could not record payment',description:e.message,variant:'destructive'});}finally{setBusy(false);}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <Button onClick={()=>setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Payment
        </Button>
      </div>

      <section className="border rounded-xl p-4 bg-card space-y-3"><h2 className="font-semibold">Guest balances from reservations</h2><p className="text-sm text-muted-foreground">These are booking balances, not additional revenue. Airbnb settlement earnings do not prove the guest payment status.</p><div className="max-h-72 overflow-auto">{(bookings as any[]||[]).filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financials?.amountPending!=null).map(b=><Link href={`/reservations/${b.id}`} key={b.id} className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm"><span>{b.guestName} · {b.propertyName}</span><span>Paid: {money(b.financials.amountPaid,b.financials.currency)} · Pending: {money(b.financials.amountPending,b.financials.currency)}{!b.financials.verified?' · Verify breakdown before posting payments':''}</span></Link>)}</div></section>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Record guest payment received</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-4"><label className="block text-sm">Reservation<select required className="w-full border rounded p-2 bg-background mt-1" value={reservationId} onChange={e=>setReservationId(e.target.value)}><option value="">Choose reservation</option>{(bookings || []).filter((r:any)=>r.status!=='cancelled' && r.financials?.verified && Number(r.balanceDue)>0).map((r:any)=><option key={r.id} value={r.id}>{r.guestName} · {r.propertyName} · Due {r.balanceDue}</option>)}</select></label><label className="block text-sm">Amount received<Input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><p className="text-xs text-muted-foreground">Records money already received. This does not charge a card or transfer money.</p><Button disabled={busy || !reservationId}>Record payment</Button></form></DialogContent></Dialog>
      <section className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[180px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/><Input aria-label="Search payments" placeholder="Search payments (description, property, owner)…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-9 h-9"/></div>
        <Select value={type} onValueChange={setType}><SelectTrigger className="w-40 h-9" aria-label="Payment type"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="guest_payment">Guest payments</SelectItem><SelectItem value="owner_payout">Owner payouts</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36 h-9" aria-label="Payment status"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent></Select>
      </div>
      {summary && summary.total>0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{summary.currencies.map((c:any)=><div key={c.currency} className="border rounded-xl p-3 bg-card text-sm"><div className="text-xs text-muted-foreground mb-1">{c.count} matching payment{c.count!==1?'s':''} · {c.currency}</div><div className="flex flex-wrap gap-x-4 gap-y-1">{Object.entries(c.byStatus).map(([st,amt])=><span key={st}><span className="capitalize text-muted-foreground">{st}:</span> <strong>{money(amt as number,c.currency)}</strong></span>)}</div></div>)}</div>}
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Due Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : list.isError ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Could not load payments. Please refresh.</TableCell></TableRow>
            ) : payments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {type!=="all"||status!=="all"||q ? "No payments match your filters." : "No payments found."}
                </TableCell>
              </TableRow>
            ) : (
              payments?.map((payment:any) => (
                <TableRow key={payment.id}>
                  <TableCell className="capitalize">{payment.type.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{payment.propertyName}{payment.description && <div className="text-xs text-muted-foreground">{payment.description}</div>}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{money(payment.amount,payment.currency)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{payment.dueDate ? format(new Date(payment.dueDate), 'MMM d, yyyy') : '-'}</TableCell>
                  <TableCell>
                    <Badge variant={payment.status === 'paid' ? 'default' : payment.status === 'overdue' ? 'destructive' : 'secondary'}>
                      {payment.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {list.data && <Pager page={list.page} pages={list.data.pages} total={list.data.total} pageSize={list.data.pageSize} onPage={list.setPage} noun="payments" busy={list.isFetching}/>}
      </section>
    </div>
  );
}
