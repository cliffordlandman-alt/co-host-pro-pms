import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api-json";
import { apiFetch } from "@/lib/api-fetch";
import { dubaiToday } from "@/lib/today-model";

// YALLA monthly workbook inputs: deposits register, lease schedules, monthly bank balance, workbook property names,
// and the Income/Expense Input download. Rules: deposits never touch the P&L; USD is fixed at 3.6725; ZAR stays separate.
const sel = "block w-full border rounded p-2 bg-background text-sm";
const fmt = (n: number | null | undefined, c = "AED") => n == null ? "–" : `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const prevMonth = () => { const d = new Date(dubaiToday() + "T00:00:00Z"); d.setUTCDate(0); return d.toISOString().slice(0, 7); };

function useSave() {
  const qc = useQueryClient(); const { toast } = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await qc.invalidateQueries(); toast({ title: ok }); return true; }
    catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); return false; }
  };
}
function useProperties() { return useQuery<any[]>({ queryKey: ["report-names"], queryFn: () => apiJson("/api/accounting/report-names") }).data ?? []; }

function Deposits() {
  const props = useProperties(); const save = useSave();
  const { data } = useQuery<any>({ queryKey: ["deposits"], queryFn: () => apiJson("/api/accounting/deposits") });
  const blank = { kind: "liability", propertyId: "", counterparty: "", amount: "", currency: "AED", date: dubaiToday(), method: "", notes: "" };
  const [f, setF] = useState<any>(blank);
  const [settle, setSettle] = useState<any>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Deposits are balance-sheet items, never income or expenses. A refund moves the cash and clears the balance; an amount kept against damage becomes a damage recovery (income).</p>
      <div className="flex flex-wrap gap-3 text-sm">{(data?.held ?? []).map((h: any) => <span key={h.currency} className="rounded border px-2 py-1">Held for guests/tenants (liability): <b>{fmt(h.liability, h.currency)}</b> · Paid out, refundable to us (asset): <b>{fmt(h.asset, h.currency)}</b></span>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Date</th><th>Kind</th><th>Property</th><th>From / held by</th><th className="text-right">Amount</th><th>Status</th><th>Notes</th><th></th></tr></thead>
        <tbody>{(data?.items ?? []).map((d: any) => <tr key={d.id} className="border-b align-top"><td className="p-2 whitespace-nowrap">{d.date}</td><td>{d.kind === "asset" ? "Asset (we paid)" : "Liability (we hold)"}</td><td>{d.propertyName ?? "–"}</td><td>{d.counterparty}</td><td className="text-right whitespace-nowrap">{fmt(d.amount, d.currency)}</td>
          <td>{d.status}{d.settledOn ? ` ${d.settledOn}` : ""}{d.status === "kept" ? ` · kept ${fmt(d.keptAmount, d.currency)} (${d.keptReason})` : ""}</td><td>{d.notes}</td>
          <td className="whitespace-nowrap">{d.status === "held" && <Button size="sm" variant="outline" onClick={() => setSettle({ id: d.id, status: "refunded", settledOn: dubaiToday(), keptAmount: "", keptReason: "" })}>Refund / keep</Button>}
            <Button size="sm" variant="ghost" onClick={() => confirm("Delete this deposit record?") && save(() => apiJson(`/api/accounting/deposits/${d.id}`, "DELETE"), "Deposit deleted")}>Delete</Button></td></tr>)}</tbody></table></div>
      {settle && <div className="rounded border p-3 grid gap-2 sm:grid-cols-5 items-end">
        <label className="text-sm">Outcome<select className={sel} value={settle.status} onChange={e => setSettle({ ...settle, status: e.target.value })}><option value="refunded">Refunded in full</option><option value="kept">Kept (all or part) against damage</option></select></label>
        <label className="text-sm">Date<Input type="date" value={settle.settledOn} onChange={e => setSettle({ ...settle, settledOn: e.target.value })} /></label>
        {settle.status === "kept" && <><label className="text-sm">Amount kept<Input type="number" step="0.01" value={settle.keptAmount} onChange={e => setSettle({ ...settle, keptAmount: e.target.value })} /></label>
          <label className="text-sm">Reason<Input value={settle.keptReason} onChange={e => setSettle({ ...settle, keptReason: e.target.value })} /></label></>}
        <div className="flex gap-2"><Button onClick={async () => { if (await save(() => apiJson(`/api/accounting/deposits/${settle.id}`, "PATCH", { status: settle.status, settledOn: settle.settledOn, ...(settle.status === "kept" ? { keptAmount: settle.keptAmount, keptReason: settle.keptReason } : {}) }), "Deposit updated")) setSettle(null); }}>Save</Button><Button variant="ghost" onClick={() => setSettle(null)}>Cancel</Button></div></div>}
      <form className="rounded border p-3 grid gap-2 sm:grid-cols-4 items-end" onSubmit={async e => { e.preventDefault(); if (await save(() => apiJson("/api/accounting/deposits", "POST", { ...f, propertyId: f.propertyId ? Number(f.propertyId) : null }), "Deposit recorded")) setF(blank); }}>
        <label className="text-sm">Kind<select aria-label="Deposit kind" className={sel} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="liability">Liability: we hold it (guest / tenant)</option><option value="asset">Asset: we paid it (e.g. landlord)</option></select></label>
        <label className="text-sm">Property<select className={sel} value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}><option value="">None</option>{props.map(p => <option key={p.id} value={p.id}>{p.reportName || p.name}</option>)}</select></label>
        <label className="text-sm">{f.kind === "asset" ? "Held by" : "Received from"}<Input required value={f.counterparty} onChange={e => setF({ ...f, counterparty: e.target.value })} /></label>
        <label className="text-sm">Date<Input required type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-sm">Amount<Input required type="number" step="0.01" min="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
        <label className="text-sm">Currency<select className={sel} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}>{["AED", "ZAR", "USD"].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm">Method<Input value={f.method} placeholder="e.g. Ziina, bank" onChange={e => setF({ ...f, method: e.target.value })} /></label>
        <label className="text-sm">Notes<Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
        <Button type="submit" className="sm:col-span-4 sm:w-auto">Add deposit</Button>
      </form>
    </div>
  );
}

function Leases() {
  const props = useProperties(); const save = useSave();
  const { data: leases = [] } = useQuery<any[]>({ queryKey: ["leases"], queryFn: () => apiJson("/api/accounting/leases") });
  const blank = { name: "", propertyId: "", landlord: "", startDate: "", endDate: "", annualRent: "", chequeCount: "4", firstDue: "", agencyFee: "", agencyFeeDate: "", agencyFeeNote: "" };
  const [f, setF] = useState<any>(blank);
  function cheques() { // equal cheques: first on the given date, then every 12/count months from the start
    const n = Number(f.chequeCount), months = 12 / n, total = Math.round(Number(f.annualRent) * 100), each = Math.floor(total / n);
    return Array.from({ length: n }, (_, i) => { const d = new Date(f.startDate + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + i * months); return { seq: i + 1, months, amount: (i === n - 1 ? total - each * (n - 1) : each) / 100, dueDate: i === 0 && f.firstDue ? f.firstDue : d.toISOString().slice(0, 10) }; });
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Rent is spread evenly over the months each cheque covers (the last month takes the cents), dated on the lease's start day. Cheques are the cash schedule.</p>
      {leases.map(l => <div key={l.id} className="rounded border p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><b>{l.name}</b><span className="text-sm">{l.startDate} – {l.endDate} · {fmt(l.annualRent, l.currency)} a year{l.agencyFee ? ` · agency fee ${fmt(l.agencyFee, l.currency)} on ${l.agencyFeeDate}` : ""}</span></div>
        {!l.chequesMatchRent && <p className="text-amber-700 text-sm">Cheques add up to {fmt(l.chequesTotal, l.currency)}, not the annual rent.</p>}
        <table className="w-full text-sm"><thead><tr className="text-left border-b"><th>Cheque</th><th>Due</th><th className="text-right">Amount</th><th>Months</th><th>Paid on</th><th></th></tr></thead><tbody>
          {l.cheques.map((c: any) => <tr key={c.id} className="border-b"><td>Q{c.seq}</td><td>{c.dueDate}</td><td className="text-right">{fmt(c.amount, l.currency)}</td><td>{c.months}</td><td>{c.paidOn ?? "not paid"}</td>
            <td>{!c.paidOn && <Button size="sm" variant="outline" onClick={() => { const d = prompt("Date the cheque cleared (YYYY-MM-DD)", c.dueDate); if (d) save(() => apiJson(`/api/accounting/leases/${l.id}`, "PATCH", { cheques: l.cheques.map((x: any) => ({ seq: x.seq, dueDate: x.dueDate, amount: x.amount, months: x.months, paidOn: x.seq === c.seq ? d : x.paidOn, reference: x.reference })) }), "Cheque marked paid"); }}>Mark paid</Button>}</td></tr>)}
        </tbody></table>
        <details><summary className="text-sm cursor-pointer">Monthly P&amp;L rent ({l.accruals.length} months)</summary><ul className="text-sm mt-1">{l.accruals.map((a: any) => <li key={a.date}>{a.date}: {fmt(a.amount, l.currency)} · {a.description}</li>)}</ul></details>
        <Button size="sm" variant="ghost" onClick={() => confirm("Delete this lease and its cheques?") && save(() => apiJson(`/api/accounting/leases/${l.id}`, "DELETE"), "Lease deleted")}>Delete lease</Button>
      </div>)}
      <form className="rounded border p-3 grid gap-2 sm:grid-cols-4 items-end" onSubmit={async e => { e.preventDefault(); if (await save(() => apiJson("/api/accounting/leases", "POST", { name: f.name, propertyId: f.propertyId ? Number(f.propertyId) : null, landlord: f.landlord || null, startDate: f.startDate, endDate: f.endDate, annualRent: f.annualRent, agencyFee: f.agencyFee || null, agencyFeeDate: f.agencyFeeDate || null, agencyFeeNote: f.agencyFeeNote || null, cheques: cheques() }), "Lease saved")) setF(blank); }}>
        <label className="text-sm">Name<Input required value={f.name} placeholder="Sunrise Bay 2106 lease" onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="text-sm">Property<select className={sel} value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}><option value="">None</option>{props.map(p => <option key={p.id} value={p.id}>{p.reportName || p.name}</option>)}</select></label>
        <label className="text-sm">Start<Input required type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></label>
        <label className="text-sm">End<Input required type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} /></label>
        <label className="text-sm">Annual rent (AED)<Input required type="number" step="0.01" value={f.annualRent} onChange={e => setF({ ...f, annualRent: e.target.value })} /></label>
        <label className="text-sm">Cheques a year<select className={sel} value={f.chequeCount} onChange={e => setF({ ...f, chequeCount: e.target.value })}>{["1", "2", "3", "4", "6", "12"].map(n => <option key={n}>{n}</option>)}</select></label>
        <label className="text-sm">First cheque date<Input type="date" value={f.firstDue} onChange={e => setF({ ...f, firstDue: e.target.value })} /></label>
        <label className="text-sm">Landlord<Input value={f.landlord} onChange={e => setF({ ...f, landlord: e.target.value })} /></label>
        <label className="text-sm">Agency fee<Input type="number" step="0.01" value={f.agencyFee} onChange={e => setF({ ...f, agencyFee: e.target.value })} /></label>
        <label className="text-sm">Agency fee paid on<Input type="date" value={f.agencyFeeDate} onChange={e => setF({ ...f, agencyFeeDate: e.target.value })} /></label>
        <label className="text-sm sm:col-span-2">Agency fee note<Input value={f.agencyFeeNote} onChange={e => setF({ ...f, agencyFeeNote: e.target.value })} /></label>
        <Button type="submit" className="sm:col-span-4 sm:w-auto">Add lease</Button>
      </form>
    </div>
  );
}

function BankBalances() {
  const save = useSave();
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["bank-balances"], queryFn: () => apiJson("/api/accounting/bank-balances") });
  const [f, setF] = useState({ month: prevMonth(), balance: "", notes: "" });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">ADIB 19589605 closing balance on the last day of each month, from the bank statement.</p>
      <table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Month</th><th>Balance date</th><th>Account</th><th className="text-right">Balance</th><th>Source</th><th>Notes</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id} className="border-b"><td className="p-2">{r.month}</td><td>{r.balanceDate}</td><td>{r.account}</td><td className="text-right">{fmt(r.balance, r.currency)}</td><td>{r.source}</td><td>{r.notes}</td><td><Button size="sm" variant="ghost" onClick={() => confirm("Delete this balance?") && save(() => apiJson(`/api/accounting/bank-balances/${r.id}`, "DELETE"), "Deleted")}>Delete</Button></td></tr>)}
      </tbody></table>
      <form className="rounded border p-3 grid gap-2 sm:grid-cols-4 items-end" onSubmit={async e => { e.preventDefault(); if (await save(() => apiJson(`/api/accounting/bank-balances/${f.month}`, "PUT", { balance: f.balance, notes: f.notes || null }), "Balance saved")) setF({ ...f, balance: "", notes: "" }); }}>
        <label className="text-sm">Month<Input required type="month" value={f.month} onChange={e => setF({ ...f, month: e.target.value })} /></label>
        <label className="text-sm">Closing balance (AED)<Input required type="number" step="0.01" value={f.balance} onChange={e => setF({ ...f, balance: e.target.value })} /></label>
        <label className="text-sm">Notes<Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
        <Button type="submit">Save balance</Button>
      </form>
    </div>
  );
}

function ReportNames() {
  const props = useProperties(); const save = useSave();
  const [edits, setEdits] = useState<Record<number, string>>({});
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">The property name used in the finance workbook (Lists &amp; Sources). Empty = the listing name.</p>
      {props.map(p => <label key={p.id} className="grid sm:grid-cols-2 gap-2 items-center text-sm"><span>{p.name}{p.status !== "active" ? ` (${p.status})` : ""}</span><Input value={edits[p.id] ?? p.reportName ?? ""} onChange={e => setEdits({ ...edits, [p.id]: e.target.value })} /></label>)}
      <Button onClick={() => save(() => apiJson("/api/accounting/report-names", "PUT", Object.entries(edits).map(([id, reportName]) => ({ id: Number(id), reportName }))), "Names saved").then(ok => ok && setEdits({}))} disabled={!Object.keys(edits).length}>Save names</Button>
    </div>
  );
}

function Export() {
  const [month, setMonth] = useState(prevMonth());
  const [from, setFrom] = useState("");
  const qs = from ? `?from=${from}` : "";
  const { data, isFetching, error, refetch } = useQuery<any>({ queryKey: ["workbook", month, from], queryFn: () => apiJson(`/api/accounting/workbook/${month}${qs}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  const { toast } = useToast();
  const [feeDates, setFeeDates] = useState<Record<number, string>>({});
  async function download() {
    const r = await apiFetch(`/api/accounting/workbook/${month}.xlsx${qs}`);
    if (!r.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = `YALLA_Workbook_${month}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }
  async function saveFee(bookingId: number) {
    try { await apiJson(`/api/accounting/workbook/fee-received/${bookingId}`, "PUT", { receivedOn: feeDates[bookingId] || null }); toast({ title: "Saved" }); refetch(); }
    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
  }
  const pendingFees = (data?.income ?? []).filter((r: any) => r.kind === "management-fee" && r.status === "Pending");
  const d = data?.m3?.dashboard;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">Month<Input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
        <label className="text-sm">Input rows from (optional)<Input type="month" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <Button onClick={download}><Download className="w-4 h-4 mr-1" />Download workbook (.xlsx)</Button>
      </div>
      <p className="text-sm text-muted-foreground">Sheets as in the master finance workbook: Dashboard, Apartment Performance, Monthly Summary, Income Input, Expense Input and Lists &amp; Sources, with the master's formulas. Airbnb counts by payout date; property-report rows are view-only. ZAR rows are listed below, never converted. Leave "rows from" empty to export the month only.</p>
      {isFetching && <p className="text-sm">Loading…</p>}{error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {data && <div className="text-sm space-y-2">
        <p>Income rows {data.income.length} · Expense rows {data.expense.length} · Income (counted) {fmt(data.totals.income)} · Operating expenses {fmt(data.totals.operatingExpenses)} · Owner paid {fmt(data.totals.ownerPaid)} · Pass-through {fmt(data.totals.passThrough)} · Refundable deposits {fmt(data.totals.refundableDeposits)}</p>
        {d && <p>Dashboard: properties {d.propertiesManaged} · income this month {fmt(d.incomeMonth)} · deposits held {fmt(d.depositsHeld)} · bank {d.bankBalance == null ? "not entered" : fmt(d.bankBalance)} · net operating profit {fmt(d.netProfit)}</p>}
        {data.warnings?.length > 0 && <div><b>To check</b><ul className="list-disc pl-5">{data.warnings.map((w: any, i: number) => <li key={i}>{w.message}</li>)}</ul></div>}
        {pendingFees.length > 0 && <div><b>Management fees still Pending</b> (enter the date the fee was received, e.g. netted from the owner payout)
          <ul>{pendingFees.map((r: any) => <li key={r.bookingId} className="flex gap-2 items-center">{r.property} · {fmt(r.gross)}
            <Input type="date" className="w-40" value={feeDates[r.bookingId] ?? ""} onChange={e => setFeeDates({ ...feeDates, [r.bookingId]: e.target.value })} />
            <Button size="sm" variant="outline" onClick={() => saveFee(r.bookingId)} disabled={!feeDates[r.bookingId]}>Mark received</Button></li>)}</ul></div>}
        {data.excluded.length > 0 && <div><b>Not in the AED sheets</b><ul>{data.excluded.map((x: any, i: number) => <li key={i}>{x.date} · {x.description} · {fmt(x.amount, x.currency)} · {x.reason}</li>)}</ul></div>}
      </div>}
    </div>
  );
}

export default function FinanceInputsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">Finance inputs (monthly workbook)</h1>
      <Tabs defaultValue="export">
        <TabsList className="flex flex-wrap h-auto"><TabsTrigger value="export">Monthly export</TabsTrigger><TabsTrigger value="deposits">Deposits</TabsTrigger><TabsTrigger value="leases">Leases</TabsTrigger><TabsTrigger value="bank">Bank balance</TabsTrigger><TabsTrigger value="names">Workbook names</TabsTrigger></TabsList>
        <TabsContent value="export"><Export /></TabsContent>
        <TabsContent value="deposits"><Deposits /></TabsContent>
        <TabsContent value="leases"><Leases /></TabsContent>
        <TabsContent value="bank"><BankBalances /></TabsContent>
        <TabsContent value="names"><ReportNames /></TabsContent>
      </Tabs>
    </div>
  );
}
