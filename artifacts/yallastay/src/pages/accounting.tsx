import { CompanyFinance } from "@/components/CompanyFinance";
import { CleaningCostSettings } from "@/components/CleaningCostSettings";
import { apiFetch } from "@/lib/api-fetch";
import { Pager, usePagedList } from "@/components/Pager";
import { AirbnbIncome } from "@/components/AirbnbIncome";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProperties } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DollarSign, FileText, Settings2, Plus, Send, CheckCircle2,
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Building, RefreshCw, Pencil, Trash2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, subMonths } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const f = async (path: string, opts?: RequestInit) => {
  const res = await apiFetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error((await res.json()).error || "Could not save");
  if (res.status === 204) return null;
  return res.json();
};

function groupedMoney(rows:any[],value:(r:any)=>number){const sums:Record<string,number>={};for(const r of rows||[])sums[r.currency||'AED']=(sums[r.currency||'AED']||0)+value(r);return Object.entries(sums).map(([c,n])=>aed(n,c)).join(' · ')||'No entries';}
function aed(n: number,currency="AED") {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = subMonths(new Date(), i);
  return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
});

const TX_CATEGORIES = [
  "Management Fee", "Cleaning", "Maintenance", "Utility", "Insurance",
  "Municipality Fee", "Owner Payout", "Booking Revenue", "Other",
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:  { label: "Draft",  color: "bg-slate-100 text-slate-700 border-slate-200" },
  sent:   { label: "Sent",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  paid:   { label: "Paid",   color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

// ── Owner Statements Tab ─────────────────────────────────────────────────────

function StatementRow({ stmt, onStatusChange }: { stmt: any; onStatusChange: (id: number, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS_CONFIG[stmt.status] ?? STATUS_CONFIG.draft;
  const totalDeductions = stmt.platformFees + stmt.managementFee + stmt.cleaningCosts + stmt.maintenanceCosts + stmt.otherExpenses + stmt.vatAmount + (stmt.tourismFee || 0);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-sm">{stmt.propertyName}</div>
            <div className="text-xs text-muted-foreground">{stmt.bookingsCount} booking{stmt.bookingsCount !== 1 ? "s" : ""} · {stmt.nightsOccupied} nights</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-muted-foreground">Gross</div>
            <div className="text-sm font-medium">{aed(stmt.grossRevenue,stmt.currency || "AED")}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Payout</div>
            <div className={`text-sm font-bold ${stmt.ownerPayout >= 0 ? "text-emerald-600" : "text-red-500"}`}>{aed(stmt.ownerPayout,stmt.currency || "AED")}</div>
          </div>
          <Badge className={`text-xs border ${s.color} hidden sm:flex`}>{s.label}</Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Breakdown */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground font-medium border-b pb-1">
                <span>Item</span><span>Amount</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground">Gross Revenue</span>
                <span className="font-medium text-emerald-600">{aed(stmt.grossRevenue,stmt.currency || "AED")}</span>
              </div>
              {stmt.platformFees > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Platform Fees</span>
                  <span className="text-red-500">− {aed(stmt.platformFees,stmt.currency || "AED")}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Management Fee</span>
                <span className="text-red-500">− {aed(stmt.managementFee,stmt.currency || "AED")}</span>
              </div>
              {stmt.cleaningCosts > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Cleaning Costs</span>
                  <span className="text-red-500">− {aed(stmt.cleaningCosts,stmt.currency || "AED")}</span>
                </div>
              )}
              {stmt.maintenanceCosts > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Maintenance</span>
                  <span className="text-red-500">− {aed(stmt.maintenanceCosts,stmt.currency || "AED")}</span>
                </div>
              )}
              {stmt.otherExpenses > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Other Expenses</span>
                  <span className="text-red-500">− {aed(stmt.otherExpenses,stmt.currency || "AED")}</span>
                </div>
              )}
              {stmt.tourismFee > 0 && <div className="flex justify-between text-muted-foreground"><span>Tourism fee</span><span>− {aed(stmt.tourismFee,stmt.currency || "AED")}</span></div>}
              {stmt.vatAmount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>VAT</span>
                  <span className="text-red-500">− {aed(stmt.vatAmount,stmt.currency || "AED")}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-2 text-base">
                <span>Owner Payout</span>
                <span className={stmt.ownerPayout >= 0 ? "text-emerald-600" : "text-red-500"}>{aed(stmt.ownerPayout,stmt.currency || "AED")}</span>
              </div>
            </div>

            {stmt.bookingDetails && <div className="sm:col-span-2 overflow-x-auto"><p className="text-xs text-muted-foreground mb-2">Bookings recognized in checkout month</p><table className="w-full text-xs"><thead><tr>{["Guest","Dates","Total","VAT","Tourism","Company","Owner"].map(h=><th className="text-left p-2" key={h}>{h}</th>)}</tr></thead><tbody>{JSON.parse(stmt.bookingDetails).map((r:any)=><tr key={r.id} className="border-t"><td className="p-2">{r.guestName}</td><td className="p-2 whitespace-nowrap">{r.checkIn} → {r.checkOut}</td>{["grossAmount","vatAmount","tourismFee","managementAmount","ownerAmount"].map(k=><td className="p-2 whitespace-nowrap" key={k}>{aed(Number(r[k]),stmt.currency || "AED")}</td>)}</tr>)}</tbody></table><p className="text-xs text-muted-foreground mt-2">{stmt.notes}</p><Button size="sm" variant="outline" className="mt-2" onClick={()=>window.print()}>Print / Save PDF</Button></div>}
            {/* Actions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
              <div className="flex flex-wrap gap-2">
                {stmt.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => onStatusChange(stmt.id, "sent")}>
                    <Send className="h-3.5 w-3.5 mr-1" />Mark as Sent
                  </Button>
                )}
                {stmt.status === "sent" && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onStatusChange(stmt.id, "paid")}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Mark as Paid
                  </Button>
                )}
                {stmt.paidAt && <span className="text-xs text-muted-foreground self-center">Paid {stmt.paidAt}</span>}
                {stmt.sentAt && !stmt.paidAt && <span className="text-xs text-muted-foreground self-center">Sent {stmt.sentAt}</span>}
              </div>
              <Badge className={`text-xs border ${s.color} mt-1`}>{s.label}</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value);

  const [statusFilter, setStatusFilter] = useState("all");
  // Paged on the server; the KPI totals are server sums over every statement for the month (per currency).
  const list = usePagedList<any, any>("statements", "accounting/statements", { month: selectedMonth, status: statusFilter }, 20);
  const statements = list.data?.items, isLoading = list.isLoading, summary = list.data?.summary;
  const serverMoney = (key: "grossRevenue" | "managementFee" | "ownerPayout") => (summary?.currencies ?? []).map((c: any) => aed(Number(c[key]), c.currency)).join(" · ") || "—";

  const generateMutation = useMutation({
    mutationFn: () => f("/api/accounting/statements/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: selectedMonth }),
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["statements"] });
      toast({ title: `Generated ${data.generated} statement${data.generated !== 1 ? "s" : ""}`, description: data.skipped?.map((s:any)=>`${s.property}: ${s.reason}`).join("; ") });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      f(`/api/accounting/statements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["statements"] }),
    onError: (e: any) => { queryClient.invalidateQueries({ queryKey: ["statements"] }); toast({ title: "Statement not updated", description: e.message, variant: "destructive" }); },
  });
  const { data: duplicates } = useQuery({ queryKey: ["statements", "duplicates"], queryFn: () => f("/api/accounting/statements/duplicates") });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-44" aria-label="Statement month"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" aria-label="Statement status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        </div>
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
          {generateMutation.isPending ? "Generating…" : "Generate Statements"}
        </Button>
      </div>

      {duplicates?.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">Duplicate owner statements need attention</p>
          <p className="text-xs mt-0.5">These were created before the one-statement-per-month rule. Nothing was deleted. They cannot be recalculated, sent or paid until only one remains per property and month.</p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {duplicates.map((d: any) => <li key={`${d.propertyId}-${d.month}`}>{d.propertyName ?? `Property ${d.propertyId}`} · {d.month}: {d.statements.map((s: any) => `#${s.id} (${s.status}, ${s.currency} ${s.ownerPayout.toFixed(2)})`).join(", ")}</li>)}
          </ul>
        </div>
      )}

      {/* Summary KPIs */}
      {!isLoading && summary?.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Gross Revenue", key: "grossRevenue" as const, color: "text-emerald-600" },
            { label: "Management Fees", key: "managementFee" as const, color: "text-amber-600" },
            { label: "Total Payouts", key: "ownerPayout" as const, color: "text-primary" },
          ].map(({ label, key, color }) => (
            <Card key={label}>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-lg font-bold ${color}`}>{serverMoney(key)}</div>
                <div className="text-[11px] text-muted-foreground">All {summary.total} statement{summary.total !== 1 ? "s" : ""}{statusFilter !== "all" ? ` (${statusFilter})` : ""} this month</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Statements list */}
      {isLoading ? (
        <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : list.isError ? (
        <div className="text-center py-10 text-muted-foreground">Could not load statements. Please refresh.</div>
      ) : !statements?.length ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl text-muted-foreground space-y-3">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <div>
            <p className="font-medium">No {statusFilter !== "all" ? `${statusFilter} ` : ""}statements for {format(new Date(selectedMonth + "-01"), "MMMM yyyy")}</p>
            <p className="text-sm mt-1">Click "Generate Statements" to auto-calculate from reservations</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {statements.map((stmt: any) => (
            <StatementRow key={stmt.id} stmt={stmt} onStatusChange={(id, status) => statusMutation.mutate({ id, status })} />
          ))}
          <Pager page={list.page} pages={list.data!.pages} total={list.data!.total} pageSize={list.data!.pageSize} onPage={list.setPage} noun="statements" busy={list.isFetching} />
        </div>
      )}
    </div>
  );
}

// ── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: properties } = useGetProperties();
  const [addOpen, setAddOpen] = useState(false);
  const [filterMonth, setFilterMonth] = useState(MONTHS[0].value);
  const [filterProp, setFilterProp] = useState("all");
  const [form, setForm] = useState({ date: format(new Date(), "yyyy-MM-dd"), propertyId: "", type: "expense", category: "Other", description: "", amount: "", reference: "", notes: "" });

  const queryKey = ["transactions", filterMonth, filterProp];
  const url = `/api/accounting/transactions?month=${filterMonth}${filterProp !== "all" ? `&propertyId=${filterProp}` : ""}`;
  const { data: transactions, isLoading } = useQuery({ queryKey, queryFn: () => f(url) });

  const addMutation = useMutation({
    mutationFn: (data: any) => f("/api/accounting/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transactions"] }); setAddOpen(false); toast({ title: "Transaction added" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => f(`/api/accounting/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["transactions"] }); toast({ title: "Deleted" }); },
  });

  const totalIn = transactions?.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + t.amount, 0) ?? 0;
  const totalOut = transactions?.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + t.amount, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterProp} onValueChange={setFilterProp}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All properties" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Transaction</Button>
      </div>

      {/* Summary */}
      {!isLoading && transactions?.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><ArrowUpRight className="h-3 w-3 text-emerald-500" />Income</div>
            <div className="text-lg font-bold text-emerald-600">{groupedMoney(transactions,(r:any)=>r.type==="income"?r.amount:0)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><ArrowDownRight className="h-3 w-3 text-red-500" />Expenses</div>
            <div className="text-lg font-bold text-red-500">{groupedMoney(transactions,(r:any)=>r.type==="expense"?r.amount:0)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Net</div>
            <div className={`text-lg font-bold ${totalIn - totalOut >= 0 ? "text-emerald-600" : "text-red-500"}`}>{groupedMoney(transactions,(r:any)=>r.type==="income"?r.amount:-r.amount)}</div>
          </CardContent></Card>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">Date</th>
              <th className="text-left px-4 py-2.5 font-medium">Description</th>
              <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Property</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Category</th>
              <th className="text-right px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <tr key={i} className="border-b">
                  {[1,2,3,4,5,6].map(j => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            ) : transactions?.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No transactions for this period</td></tr>
            ) : (
              transactions.map((tx: any) => (
                <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{tx.date}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{tx.description}</div>
                    {tx.reference && <div className="text-xs text-muted-foreground">Ref: {tx.reference}</div>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{tx.propertyName ?? "—"}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Badge variant="outline" className="text-xs">{tx.category}</Badge>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${tx.type === "income" ? "text-emerald-600" : "text-red-500"}`}>
                    {tx.type === "income" ? "+" : "−"} {aed(tx.amount,tx.currency || "AED")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteMutation.mutate(tx.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Transaction Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs mb-1 block">Date</Label>
                <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Property</Label>
              <Select value={form.propertyId} onValueChange={v => setForm(p => ({ ...p, propertyId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select property (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No property</SelectItem>
                  {properties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Category</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TX_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Description</Label>
              <Input placeholder="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs mb-1 block">Amount (AED)</Label>
                <Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Reference (optional)</Label>
                <Input placeholder="Ref #" value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <p className="text-xs text-muted-foreground">Property expenses charge the owner. General expenses and income belong to the company. Use Company statement for explicit allocation.</p>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate({ ...form, propertyId: form.propertyId && form.propertyId !== "none" ? parseInt(form.propertyId) : null, amount: parseFloat(form.amount),allocation:form.type==="income"?"company":form.propertyId&&form.propertyId!=="none"?"owner":"company" })}
              disabled={addMutation.isPending || !form.description || !form.amount}
            >
              {addMutation.isPending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["acc-settings"], queryFn: () => f("/api/accounting/settings") });
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const saveMutation = useMutation({
    mutationFn: ({ propertyId, data }: { propertyId: number; data: any }) =>
      f(`/api/accounting/settings/${propertyId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onError: (e:any)=>toast({title:"Could not save fee settings",description:e.message,variant:"destructive"}),
    onSuccess: (row: any) => { queryClient.invalidateQueries({ queryKey: ["acc-settings"] }); setEditing(null); toast({ title: "Settings saved", description: row?.bookingsRecalculated != null ? `Owner amounts updated on ${row.bookingsRecalculated} booking(s) to follow the cleaning setting${row.bookingsInPublishedMonths ? `; ${row.bookingsInPublishedMonths} in already sent/paid months left unchanged` : ""}.` : undefined }); },
  });

  function startEdit(s: any) {
    setEditing(s.propertyId);
    setDraft(Object.fromEntries(Object.entries(s).filter(([key])=>!["id","propertyId","propertyName","propertyCurrency"].includes(key))));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">This is the one place each property's management fee, cleaning fee, channel fees and tax rules are kept (the property screen edits the same values). New bookings use these rates; bookings already verified keep the rates saved on them.</p>
      <CleaningCostSettings />
      {isLoading ? (
        Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)
      ) : (
        settings?.map((s: any) => (
          <Card key={s.propertyId}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-sm">{s.propertyName}</h3>
                  {editing !== s.propertyId && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Mgmt {s.managementFeePercent}% · Cleaning fee {s.cleaningFee != null ? s.cleaningFee : "none"} · Cleaning cost {s.cleaningCostOverride === 0 ? "no cost" : s.cleaningCostOverride != null ? `${s.cleaningCostCurrency || s.propertyCurrency || "AED"} ${s.cleaningCostOverride} (override)` : s.cleaningRateCard ? "rate card" : <span className="text-amber-700 dark:text-amber-300">no rate set</span>} · Airbnb {s.platformFeeAirbnb}% · Booking {s.platformFeeBookingCom}% · Direct {s.platformFeeDirect}% · Vrbo {s.platformFeeVrbo ?? 0}% · VAT {s.vatEnabled ? `${s.vatPercent}%` : "off"} · Tourism {s.tourismEnabled ? s.tourismRate : "off"}
                    </p>
                  )}
                </div>
                {editing !== s.propertyId ? (
                  <Button size="sm" variant="outline" onClick={() => startEdit(s)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => saveMutation.mutate({ propertyId: s.propertyId, data: draft })} disabled={saveMutation.isPending}>Save</Button>
                  </div>
                )}
              </div>
              {editing === s.propertyId && draft && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { key: "managementFeePercent", label: "Management Fee %" },
                    { key: "cleaningFee", label: "Cleaning fee per booking (blank = none)" },
                    { key: "platformFeeAirbnb", label: "Airbnb Fee %" },
                    { key: "platformFeeBookingCom", label: "Booking.com Fee %" },
                    { key: "platformFeeDirect", label: "Direct Fee %" },
                    { key: "platformFeeVrbo", label: "Vrbo Fee %" },
                    { key: "vatPercent", label: "VAT %" },
                    { key: "tourismRate", label: "Tourism / bedroom / night" },
                    { key: "cleaningCostOverride", label: "Cleaning cost override (blank = rate card, 0 = no cost)" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <Input type="number" step="0.5" min="0" value={draft[key] ?? ""} onChange={e => setDraft((p: any) => ({ ...p, [key]: (key === "cleaningCostOverride" || key === "cleaningFee") && e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                    </div>
                  ))}
                  <div className="flex flex-col gap-3 pt-1">
                    {[['tourismEnabled','Tourism fee enabled'],['vatEnabled','VAT enabled']].map(([key,label])=><label key={key} className="flex items-center gap-2 text-xs"><Switch checked={draft[key]} onCheckedChange={v=>setDraft((p:any)=>({...p,[key]:v}))}/>{label}</label>)}
                    <div className="flex items-center gap-2">
                      <Switch id={`cleaning-${s.propertyId}`} checked={draft.includeCleaning} onCheckedChange={v => setDraft((p: any) => ({ ...p, includeCleaning: v }))} />
                      <Label htmlFor={`cleaning-${s.propertyId}`} className="text-xs">Deduct the booking cleaning fee from the owner's share</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id={`ratecard-${s.propertyId}`} checked={!!draft.cleaningRateCard} onCheckedChange={v => setDraft((p: any) => ({ ...p, cleaningRateCard: v }))} />
                      <Label htmlFor={`ratecard-${s.propertyId}`} className="text-xs">Cleaned by the rate-card cleaning company</Label>
                    </div>
                    <label className="text-xs">Cleaning cost currency (blank = {s.propertyCurrency || "AED"})
                      <Input className="mt-1 h-8 w-24 uppercase" maxLength={3} value={draft.cleaningCostCurrency ?? ""} onChange={e => setDraft((p: any) => ({ ...p, cleaningCostCurrency: e.target.value.trim() === "" ? null : e.target.value.toUpperCase() }))} />
                    </label>
                    <p className="text-[11px] text-muted-foreground">No override and not on the rate card = no rate set: cleans are skipped and flagged. An override of 0 = no cleaning cost: nothing is recorded or flagged.</p>
                    <div className="flex items-center gap-2">
                      <Switch id={`maint-${s.propertyId}`} checked={draft.includeMaintenance} onCheckedChange={v => setDraft((p: any) => ({ ...p, includeMaintenance: v }))} />
                      <Label htmlFor={`maint-${s.propertyId}`} className="text-xs">Include maintenance costs</Label>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Accounting() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounting</h1>
        <p className="text-muted-foreground text-sm mt-1">Owner statements, transaction ledger, and fee configuration</p>
      </div>

      <AirbnbIncome/>
      <Tabs defaultValue="statements">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="statements" className="gap-1.5"><FileText className="h-4 w-4" />Owner Statements</TabsTrigger>
          <TabsTrigger value="company">Company statement</TabsTrigger>
          <TabsTrigger value="transactions" className="gap-1.5"><DollarSign className="h-4 w-4" />Transactions</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5"><Settings2 className="h-4 w-4" />Fee Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="statements"><StatementsTab /></TabsContent>
        <TabsContent value="company"><CompanyFinance /></TabsContent>
        <TabsContent value="transactions"><TransactionsTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
