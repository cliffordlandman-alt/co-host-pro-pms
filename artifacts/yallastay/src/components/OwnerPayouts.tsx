import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Banknote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api-json";
import { aedNumber, formatAed } from "@/lib/aed-book";

// Payouts to the owner against one statement: date, method and bank reference. The statement can only be marked
// paid once these add up to its balance (the server enforces it).
export type OwnerPayout = { id: number; amount: number; currency: string; paidOn: string; method: string; reference: string | null; notes?: string | null };
export const METHOD_LABEL: Record<string, string> = { bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", other: "Other", not_recorded: "Not recorded" };
const money = (n: number, c: string, date?: string) => formatAed(n, c, date);
const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const cents = (n: number) => Math.round(n * 100);

/** One line per payout, e.g. "2 Oct 2026 · Bank transfer · ref FT-002 · AED 1,805.71". */
export function PayoutLine({ p, onDelete }: { p: OwnerPayout; onDelete?: () => void }) {
  const d = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(p.paidOn + "T00:00:00Z"));
  return (
    <li data-testid="payout-line" className="flex items-start justify-between gap-2 text-xs">
      <span className="min-w-0">{d} · {METHOD_LABEL[p.method] ?? p.method}{p.reference ? <> · ref <span className="font-mono">{p.reference}</span></> : p.method === "not_recorded" ? " (marked paid before payout records)" : ""}{p.notes && p.method !== "not_recorded" ? <span className="text-muted-foreground"> · {p.notes}</span> : null}</span>
      <span className="flex items-center gap-1 shrink-0"><span className="tabular-nums font-medium">{money(p.amount, p.currency, p.paidOn)}</span>
        {onDelete && <button type="button" aria-label="Remove payout record" className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></button>}</span>
    </li>
  );
}

export function OwnerPayouts({ stmt, balance, canRecord }: { stmt: any; balance: number; canRecord: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cur = stmt.currency || "AED";
  const payouts: OwnerPayout[] = stmt.payouts ?? [];
  const paid = payouts.reduce((n, p) => n + cents(p.amount), 0);
  const remaining = (cents(balance) - paid) / 100;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", paidOn: dubaiToday(), method: "bank_transfer", reference: "", notes: "" });
  const [error, setError] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["statements"] });
  const save = useMutation({
    mutationFn: () => {
      const rate = aedNumber(1, cur, form.paidOn) || 1;
      const typed = Number(form.amount);
      const full = aedNumber(remaining, cur, form.paidOn);
      const stored = full != null && Math.abs(typed - full) < 0.02 ? remaining : Math.round((typed / rate) * 100) / 100;
      return apiJson(`/api/accounting/statements/${stmt.id}/payouts`, "POST", { ...form, amount: stored });
    },
    onSuccess: (r: any) => { done(); setOpen(false); toast({ title: "Payout recorded", description: r.remaining > 0 ? `${money(r.remaining, cur, form.paidOn)} still to pay` : "The payouts now match the balance. You can mark the statement paid." }); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiJson(`/api/accounting/statements/${stmt.id}/payouts/${id}`, "DELETE"),
    onSuccess: () => { done(); toast({ title: "Payout record removed" }); },
    onError: (e: Error) => toast({ title: "Not removed", description: e.message, variant: "destructive" }),
  });
  const refLabel = form.method === "cheque" ? "Cheque number" : form.method === "cash" ? "Receipt number (optional)" : form.method === "other" ? "Reference" : "Bank reference";
  if (!payouts.length && !canRecord) return null;
  return (
    <div className="space-y-1.5" data-testid="owner-payouts">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payouts to owner</p>
      {payouts.length > 0 ? <ul className="space-y-1">{payouts.map(p => <PayoutLine key={p.id} p={p} onDelete={canRecord ? () => { if (confirm(`Remove the ${money(p.amount, p.currency, p.paidOn)} payout record of ${p.paidOn}?`)) remove.mutate(p.id); } : undefined} />)}</ul>
        : <p className="text-xs text-muted-foreground">No payout recorded yet.</p>}
      {canRecord && <p data-testid="payout-progress" className={`text-xs ${remaining === 0 ? "text-emerald-700" : "text-amber-800"}`}>{remaining === 0 ? `Paid in full: ${money(paid / 100, cur)}` : `Recorded ${money(paid / 100, cur)} of ${money(balance, cur)} · ${money(remaining, cur)} to record`}</p>}
      {canRecord && remaining > 0 && <Button size="sm" variant="outline" data-testid="record-payout" onClick={() => { setForm({ amount: (aedNumber(remaining, cur, dubaiToday()) ?? remaining).toFixed(2), paidOn: dubaiToday(), method: "bank_transfer", reference: "", notes: "" }); setError(""); setOpen(true); }}>
        <Banknote className="h-3.5 w-3.5 mr-1" />Record payout</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Record payout · {stmt.propertyName} · {stmt.month}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); setError(""); save.mutate(); }}>
            <p className="text-xs text-muted-foreground">Balance {money(balance, cur)}{paid ? `, ${money(paid / 100, cur)} already recorded` : ""}. Enter the amount in dirhams. It is saved in the statement's own currency.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="po-amount">Amount (AED)</Label><Input id="po-amount" data-testid="payout-amount" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="po-date">Paid on</Label><Input id="po-date" data-testid="payout-date" type="date" max={dubaiToday()} value={form.paidOn} onChange={e => setForm(f => ({ ...f, paidOn: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Method</Label>
              <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                <SelectTrigger data-testid="payout-method" aria-label="Payout method"><SelectValue /></SelectTrigger>
                <SelectContent>{["bank_transfer", "cheque", "cash", "other"].map(m => <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1"><Label htmlFor="po-ref">{refLabel}</Label><Input id="po-ref" data-testid="payout-reference" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder={form.method === "bank_transfer" ? "e.g. FT26277XK1" : ""} /></div>
            <div className="space-y-1"><Label htmlFor="po-notes">Note (optional)</Label><Input id="po-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" data-testid="payout-save" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save payout"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
