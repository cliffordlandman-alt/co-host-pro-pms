import { Link } from "wouter";
import { money } from "@/components/ReservationMoney";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useQueryClient } from "@tanstack/react-query";
import { useGetReservations, useGetProperties } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useGetPayments } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { format } from "date-fns";

export default function Payments() {
  const { data: payments, isLoading } = useGetPayments();
  const {data:bookings}=useGetReservations(); const {data:properties}=useGetProperties();
  const [open,setOpen]=useState(false),[reservationId,setReservationId]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false);
  const qc=useQueryClient(); const {toast}=useToast();
  async function save(e:React.FormEvent) {
    e.preventDefault();setBusy(true);
    try {const r=await apiFetch('/api/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'guest_payment',reservationId:Number(reservationId),amount,status:'paid',dueDate:new Date().toISOString().slice(0,10)})});const data=await r.json();if(!r.ok) throw new Error(data.error);await qc.invalidateQueries();setOpen(false);setAmount('');toast({title:'Payment recorded and booking balance updated'});}catch(e:any){toast({title:'Could not record payment',description:e.message,variant:'destructive'});}finally{setBusy(false);}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <Button onClick={()=>setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Payment
        </Button>
      </div>

      <section className="border rounded-xl p-4 bg-card space-y-3"><h2 className="font-semibold">Guest balances from reservations</h2><p className="text-sm text-muted-foreground">These are booking balances, not additional revenue. Airbnb settlement earnings do not prove the guest payment status.</p><div className="max-h-72 overflow-auto">{(bookings as any[]||[]).filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financials?.amountPending!=null).map(b=><Link href={`/reservations/${b.id}`} key={b.id} className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm"><span>{b.guestName} · {b.propertyName}</span><span>Paid: {money(b.financials.amountPaid,b.financials.currency)} · Pending: {money(b.financials.amountPending,b.financials.currency)}{!b.financials.verified?' · Verify breakdown before posting payments':''}</span></Link>)}</div></section>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Record guest payment received</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-4"><label className="block text-sm">Reservation<select required className="w-full border rounded p-2 bg-background mt-1" value={reservationId} onChange={e=>setReservationId(e.target.value)}><option value="">Choose reservation</option>{(bookings || []).filter((r:any)=>r.status!=='cancelled' && r.financials?.verified && Number(r.balanceDue)>0).map((r:any)=><option key={r.id} value={r.id}>{r.guestName} · {r.propertyName} · Due {r.balanceDue}</option>)}</select></label><label className="block text-sm">Amount received<Input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><p className="text-xs text-muted-foreground">Records money already received. This does not charge a card or transfer money.</p><Button disabled={busy || !reservationId}>Record payment</Button></form></DialogContent></Dialog>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Due Date</TableHead>
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
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : payments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No payments found.
                </TableCell>
              </TableRow>
            ) : (
              payments?.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="capitalize">{payment.type.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{payment.propertyName}</TableCell>
                  <TableCell className="font-medium">{(properties as any[])?.find(p=>p.id===payment.propertyId)?.currency || "AED"} {payment.amount.toLocaleString(undefined,{minimumFractionDigits:2})}</TableCell>
                  <TableCell>{payment.dueDate ? format(new Date(payment.dueDate), 'MMM d, yyyy') : '-'}</TableCell>
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
    </div>
  );
}
