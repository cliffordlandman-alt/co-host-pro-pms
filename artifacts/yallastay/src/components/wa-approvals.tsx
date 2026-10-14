// WhatsApp agent approvals UI (shown only when the instance has WA_APPROVALS=on).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { INSTANCE } from "@/lib/instance";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/wa";
async function call(path: string, method = "GET", body?: unknown) {
  const r = await apiFetch(API + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j;
}
const NAMES: Record<string, string> = { service_booking: "Service visit", technician_eta: "Technician ETA", new_lead: "New lead", urgent_breakdown: "Urgent breakdown" };
const label = (c: string) => NAMES[c] ?? c.replace(/_/g, " ").replace(/^./, s => s.toUpperCase());
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function useRun() { const qc = useQueryClient(); const { toast } = useToast();
  return async (f: () => Promise<any>, ok?: string) => { try { const r = await f(); if (ok) toast({ title: ok }); qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("wa-") }); return r; } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } }; }

export function WaApprovalsQueue({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth(); const admin = ["admin", "super_admin"].includes(user?.role ?? ""); const run = useRun();
  const q = useQuery<any[]>({ queryKey: ["wa-drafts"], queryFn: () => call("/drafts?status=pending"), refetchInterval: 20000, enabled: INSTANCE.waApprovals });
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [always, setAlways] = useState<any>(null); const [scope, setScope] = useState<"contact" | "all">("contact");
  if (!INSTANCE.waApprovals) return null;
  const list = q.data ?? [];
  return <section className="rounded-2xl border bg-card p-4 space-y-3" data-testid="wa-queue">
    <div className="flex items-center justify-between gap-2"><div><p className="today-eyebrow">WHATSAPP APPROVALS</p><h2 className="font-semibold mt-1">{list.length} draft{list.length === 1 ? "" : "s"} waiting</h2></div>
      <span className="text-[11px] rounded-full bg-amber-100 text-amber-800 px-2 py-1">Delivery off: sends are queued</span></div>
    {list.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting for approval.</p>}
    {(compact ? list.slice(0, 3) : list).map(d => <div key={d.id} className="border rounded-xl p-3 space-y-2" data-testid="wa-draft">
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{d.contactName || d.contact}</span><span className="text-xs text-muted-foreground">{d.contact}</span>
        <span className={`text-[11px] rounded-full px-2 py-0.5 ${d.blocked ? "bg-red-100 text-red-800" : d.urgent ? "bg-orange-100 text-orange-800" : "bg-sky-100 text-sky-800"}`}>{label(d.category)}{d.blocked ? " · manual only" : ""}</span></div>
      {edit?.id === d.id ? <Textarea value={edit!.text} onChange={e => setEdit({ id: d.id, text: e.target.value })} rows={4} data-testid="wa-edit-text" />
        : <p className="text-sm whitespace-pre-line bg-muted/40 rounded-lg p-2">{d.text}</p>}
      {d.reason && <p className="text-xs text-muted-foreground">Why: {d.reason.replace(/^\[sample\]\s*/, "")}</p>}
      {admin && <div className="flex flex-wrap gap-2">
        {edit?.id === d.id ? <><Button size="sm" onClick={() => run(() => call(`/drafts/${d.id}/approve`, "POST", { text: edit!.text }), "Edited and sent to the outbox").then(() => setEdit(null))} data-testid="wa-send-edit">Send edited</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></>
          : <><Button size="sm" onClick={() => run(() => call(`/drafts/${d.id}/approve`, "POST", {}), "Approved and sent to the outbox")} data-testid="wa-approve">Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setEdit({ id: d.id, text: d.text })} data-testid="wa-edit">Edit</Button>
            {!d.blocked && <Button size="sm" variant="outline" onClick={() => { setScope("contact"); setAlways(d); }} data-testid="wa-always">Always approve</Button>}
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => call(`/drafts/${d.id}/decline`, "POST", {}), "Declined")} data-testid="wa-decline">Decline</Button></>}
      </div>}
    </div>)}
    {compact && list.length > 3 && <a href={import.meta.env.BASE_URL.replace(/\/$/, "") + "/ai-staff?tab=whatsapp"} className="text-sm text-primary">See all {list.length} →</a>}
    <Dialog open={!!always} onOpenChange={o => !o && setAlways(null)}>
      <DialogContent><DialogHeader><DialogTitle>Always approve?</DialogTitle><DialogDescription>This sends the draft now and creates an auto-approve rule. Matching drafts will then go to the outbox without asking. You can switch rules off in Settings → Auto-approve rules.</DialogDescription></DialogHeader>
        {always && <div className="space-y-2 text-sm">
          <label className="flex gap-2 items-start border rounded-lg p-3 cursor-pointer"><input type="radio" checked={scope === "contact"} onChange={() => setScope("contact")} data-testid="wa-scope-contact" /><span><b>{label(always.category)}</b> messages to <b>{always.contactName || always.contact}</b> only</span></label>
          <label className="flex gap-2 items-start border rounded-lg p-3 cursor-pointer"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} data-testid="wa-scope-all" /><span><b>{label(always.category)}</b> messages to <b>all contacts</b></span></label>
        </div>}
        <DialogFooter><Button variant="ghost" onClick={() => setAlways(null)}>Cancel</Button><Button onClick={() => run(() => call(`/drafts/${always.id}/always`, "POST", { scope }), "Sent, and auto-approve rule created").then(() => setAlways(null))} data-testid="wa-always-confirm">Send and create rule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

export function WaRules() {
  const run = useRun(); const q = useQuery<any[]>({ queryKey: ["wa-rules"], queryFn: () => call("/rules"), enabled: INSTANCE.waApprovals });
  const st = useQuery<any>({ queryKey: ["wa-status"], queryFn: () => call("/status"), enabled: INSTANCE.waApprovals });
  if (!INSTANCE.waApprovals) return null;
  return <div className="space-y-3" data-testid="wa-rules">
    <p className="text-sm text-muted-foreground">Drafts matching an active rule are approved automatically and logged. These categories always need a person and can never have a rule: {(st.data?.blocked ?? []).map(label).join(", ")}.</p>
    {(q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No rules yet. Use "Always approve" on a draft to create one.</p>}
    {(q.data ?? []).map(r => <div key={r.id} className="border rounded-xl p-3 flex items-center gap-3" data-testid="wa-rule">
      <div className="flex-1 min-w-0"><p className="text-sm font-medium">{label(r.category)} → {r.scope === "all" ? "all contacts" : (r.contactName || r.contact)}</p><p className="text-xs text-muted-foreground">Created by {r.createdBy} · {fmt(r.createdAt)}</p></div>
      <Switch checked={r.enabled} onCheckedChange={v => run(() => call(`/rules/${r.id}`, "PATCH", { enabled: v }), v ? "Rule on" : "Rule off")} aria-label="Rule on or off" />
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => call(`/rules/${r.id}`, "DELETE"), "Rule deleted")}>Delete</Button>
    </div>)}
  </div>;
}

export function WaPromptEditor() {
  const run = useRun(); const q = useQuery<any>({ queryKey: ["wa-prompt"], queryFn: () => call("/prompt"), enabled: INSTANCE.waApprovals });
  const [v, setV] = useState<string | null>(null);
  if (!INSTANCE.waApprovals) return null;
  return <div className="space-y-2" data-testid="wa-prompt"><h3 className="font-semibold">WhatsApp bot instructions</h3>
    <Textarea rows={14} value={v ?? q.data?.prompt ?? ""} onChange={e => setV(e.target.value)} className="text-xs font-mono" />
    <Button size="sm" disabled={v == null} onClick={() => run(() => call("/prompt", "PUT", { prompt: v }), "Instructions saved").then(() => setV(null))}>Save instructions</Button></div>;
}

export function WaAuditLog() {
  const a = useQuery<any[]>({ queryKey: ["wa-audit"], queryFn: () => call("/audit"), enabled: INSTANCE.waApprovals });
  const o = useQuery<any[]>({ queryKey: ["wa-outbox"], queryFn: () => call("/outbox"), enabled: INSTANCE.waApprovals });
  if (!INSTANCE.waApprovals) return null;
  return <div className="grid md:grid-cols-2 gap-4">
    <div className="space-y-1" data-testid="wa-audit"><h3 className="font-semibold">Audit trail</h3>{(a.data ?? []).slice(0, 50).map(x => <p key={x.id} className="text-xs border-b py-1"><span className="text-muted-foreground">{fmt(x.at)}</span> · <b>{x.action}</b>{x.contact ? ` · ${x.contact}` : ""}{x.category ? ` · ${label(x.category)}` : ""} · by {x.by}</p>)}</div>
    <div className="space-y-1" data-testid="wa-outbox"><h3 className="font-semibold">Outbox</h3>{(o.data ?? []).slice(0, 50).map(x => <p key={x.id} className="text-xs border-b py-1"><span className="text-muted-foreground">{fmt(x.at)}</span> · {x.toName || x.to} · <span className="text-amber-700">{x.status}</span> · {x.how} by {x.approvedBy}</p>)}</div>
  </div>;
}
