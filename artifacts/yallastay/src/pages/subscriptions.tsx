import { apiFetch } from "@/lib/api-fetch";
import { BRAND } from "../../../../lib/brand.mjs";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Plus, Loader2, Building2, Zap, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRICE_PER_PROPERTY = 49;

const PLANS = [
  { id: "standard", label: "Standard", price: PRICE_PER_PROPERTY, icon: Zap, color: "text-teal-600 bg-teal-50", desc: "AED 49 per property / month" },
];

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  trial:    { color: "bg-blue-100 text-blue-700",   icon: Clock,         label: "Trial" },
  active:   { color: "bg-green-100 text-green-700", icon: CheckCircle2,  label: "Active" },
  overdue:  { color: "bg-red-100 text-red-700",     icon: AlertTriangle, label: "Overdue" },
  cancelled:{ color: "bg-gray-100 text-gray-600",   icon: XCircle,       label: "Cancelled" },
};

async function fetchSubs() {
  const r = await apiFetch(`${API}/api/subscriptions`); return r.json();
}

export default function Subscriptions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ clientName: "", contactEmail: "", contactPhone: "", plan: "standard", propertyCount: "1", billingDate: "", notes: "" });

  const { data: subs = [], isLoading } = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubs });

  const addMutation = useMutation({
    mutationFn: async () => {
      const propertyCount = Math.max(1, parseInt(form.propertyCount) || 1);
      const monthlyAmount = PRICE_PER_PROPERTY * propertyCount;
      const r = await apiFetch(`${API}/api/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, plan: "standard", propertyCount, monthlyAmount }),
      });
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subscriptions"] }); toast({ title: "Subscription added" }); setShowAdd(false); },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiFetch(`${API}/api/subscriptions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  const mrr = subs.filter((s: any) => s.status === "active" || s.status === "trial").reduce((acc: number, s: any) => acc + (s.monthlyAmount || 0), 0);
  const activeSubs = subs.filter((s: any) => s.status === "active").length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="h-6 w-6 text-purple-600" /> PMS Subscriptions</h1>
          <p className="text-muted-foreground mt-1">Manage external clients using {BRAND}</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-2" /> Add Client</Button>
      </div>

      {/* MRR + stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Monthly Revenue", val: `AED ${mrr.toLocaleString()}`, sub: "MRR", color: "text-emerald-600" },
          { label: "Active Clients", val: activeSubs, sub: "subscriptions", color: "text-foreground" },
          { label: "Trial Clients", val: subs.filter((s: any) => s.status === "trial").length, sub: "in trial", color: "text-blue-600" },
          { label: "Overdue", val: subs.filter((s: any) => s.status === "overdue").length, sub: "need attention", color: "text-red-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Plans overview */}
      <div className="grid sm:grid-cols-3 gap-4">
        {PLANS.map(({ id, label, price, icon: Icon, color, desc }) => {
          const count = subs.filter((s: any) => s.plan === id).length;
          return (
            <div key={id} className="bg-card border rounded-xl p-5 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}><Icon className="h-6 w-6" /></div>
              <div>
                <div className="font-bold">{label}</div>
                <div className="text-sm text-muted-foreground">AED {price} / property / month</div>
                <div className="text-xs text-muted-foreground mt-0.5">{count} client{count !== 1 ? "s" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Client list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : subs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Add your first PMS subscription client</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>{["Client", "Plan", "Properties", "Monthly", "Status", "Billing", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {subs.map((sub: any) => {
                const sc = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.trial;
                const Icon = sc.icon;
                const plan = PLANS.find(p => p.id === sub.plan);
                const PIcon = plan?.icon ?? Zap;
                return (
                  <tr key={sub.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{sub.clientName}</div>
                      <div className="text-xs text-muted-foreground">{sub.contactEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${plan?.color ?? "bg-gray-100 text-gray-600"}`}>
                        <PIcon className="h-3 w-3" /> {plan?.label ?? sub.plan}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{sub.propertyCount}</td>
                    <td className="px-4 py-3 font-semibold">AED {(sub.monthlyAmount || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${sc.color}`}>
                        <Icon className="h-3 w-3" /> {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{sub.billingDate || "—"}</td>
                    <td className="px-4 py-3">
                      <Select value={sub.status} onValueChange={status => patchMutation.mutate({ id: sub.id, status })}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_CONFIG).map(([val, { label }]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Client Subscription</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Company / Client Name</Label><Input value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} placeholder="e.g. Horizon Properties LLC" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} /></div>
            </div>
            <div><Label>Plan</Label>
              <Select value={form.plan} onValueChange={v => setForm({ ...form, plan: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLANS.map(p => <SelectItem key={p.id} value={p.id}>{p.label} — AED {p.price} / property / month</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Properties</Label><Input type="number" min="1" value={form.propertyCount} onChange={e => setForm({ ...form, propertyCount: e.target.value })} /></div>
              <div><Label>Billing Date</Label><Input type="date" value={form.billingDate} onChange={e => setForm({ ...form, billingDate: e.target.value })} /></div>
            </div>
            <p className="text-sm text-muted-foreground">Monthly total: <span className="font-semibold text-foreground">AED {(PRICE_PER_PROPERTY * Math.max(1, parseInt(form.propertyCount) || 1)).toLocaleString()}</span> ({PRICE_PER_PROPERTY} × {Math.max(1, parseInt(form.propertyCount) || 1)} properties)</p>
            <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.clientName || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Add Client
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
