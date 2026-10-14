import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { INSTANCE } from "@/lib/instance";
import { WaApprovalsQueue, WaRules, WaPromptEditor, WaAuditLog } from "@/components/wa-approvals";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/ai-staff";
async function call(path: string, method = "GET", body?: unknown) {
  const r = await apiFetch(API + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j;
}
const BASE_TABS = [["chat", "Chat"], ["checks", "Bot checks"], ["escalations", "Needs a person"], ["checkins", "Staff check-ins"], ["reports", "Daily reports"], ["proposals", "Proposed changes"], ["setup", "Setup"]] as const;

export default function AiStaffPage() {
  const TABS: readonly (readonly [string, string])[] = INSTANCE.waApprovals ? [["whatsapp", "WhatsApp approvals"], ...BASE_TABS] : BASE_TABS;
  const [tab, setTab] = useState<string>(new URLSearchParams(location.search).get("tab") || "chat"); const [bot, setBot] = useState("bookings"); const [text, setText] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const qc = useQueryClient(); const { toast } = useToast(); const { user } = useAuth();
  const admin = ["admin", "super_admin"].includes(user?.role ?? "");
  const bots = useQuery<any>({ queryKey: ["ai-bots"], queryFn: () => call("/bots") });
  const msgs = useQuery<any[]>({ queryKey: ["ai-msgs", bot], queryFn: () => call(`/messages/${bot}`), refetchInterval: 15000, enabled: tab === "chat" });
  const checks = useQuery<any>({ queryKey: ["ai-checks"], queryFn: () => call("/checks"), enabled: tab === "checks" });
  const esc = useQuery<any[]>({ queryKey: ["ai-esc"], queryFn: () => call("/escalations"), enabled: tab === "escalations" });
  const cins = useQuery<any>({ queryKey: ["ai-cin"], queryFn: () => call("/checkins"), enabled: tab === "checkins" });
  const reps = useQuery<any[]>({ queryKey: ["ai-rep"], queryFn: () => call("/reports"), enabled: tab === "reports" });
  const ops = useQuery<any>({ queryKey: ["ai-ops"], queryFn: () => call("/ops") });
  const props = useQuery<any[]>({ queryKey: ["ai-props"], queryFn: () => call("/proposals"), enabled: tab === "proposals" });
  const run = async (f: () => Promise<any>, ok?: string) => { try { const r = await f(); if (ok) toast({ title: ok }); qc.invalidateQueries(); return r; } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } };
  const list = bots.data?.bots ?? []; const cur = list.find((b: any) => b.id === bot);
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div><h1 className="text-2xl font-semibold">AI staff</h1>
        <p className="text-sm text-muted-foreground">Your own bots, connected to this system. Messages go to the bot you pick; its replies appear here. Bots read only what their role needs and every change they suggest waits for your approval. They never message guests or owners.</p></div>
      <div className="flex gap-2 flex-wrap">{TABS.map(([id, l]) => <Button key={id} size="sm" variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)} data-testid={`ai-tab-${id}`}>{l}</Button>)}</div>
      {tab === "whatsapp" && <div className="space-y-6"><WaApprovalsQueue /><WaAuditLog /><div className="rounded-2xl border p-4"><h3 className="font-semibold mb-2">Auto-approve rules</h3><WaRules /></div></div>}
      {tab === "chat" && <div className="grid md:grid-cols-[220px_1fr] gap-4">
        <div className="space-y-1">{list.map((b: any) => <button key={b.id} disabled={!b.enabled} onClick={() => setBot(b.id)} data-testid={`ai-bot-${b.id}`} className={`w-full text-left rounded-md border p-2 text-sm ${bot === b.id ? "border-primary bg-primary/5" : ""} ${b.enabled ? "" : "opacity-50"}`}><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{b.enabled ? b.role : "Not in your plan / off"}</div></button>)}</div>
        <div className="border rounded-lg flex flex-col min-h-[420px]">
          <div className="p-3 border-b text-xs text-muted-foreground">{cur?.name} · {cur?.hasKey ? "your bot is connected (has a key)" : bots.data?.ai === "connected" ? "answered by the in-app AI" : "not connected"} · relay {bots.data?.relay}</div>
          {!cur?.hasKey && bots.data?.ai !== "connected" && <div data-testid="ai-not-connected" className="m-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><b>AI not connected yet.</b> Messages are saved and wait here. To get answers, add an OpenAI key on the server (OPENAI_API_KEY) or connect your own bot with a key in Setup. Bot checks, staff check-ins and daily reports already work without AI.</div>}
          <div className="flex-1 p-3 space-y-2 overflow-y-auto">{(msgs.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
            {(msgs.data ?? []).map(m => <div key={m.id} className={`max-w-[80%] rounded-lg p-2 text-sm whitespace-pre-wrap ${m.from === "user" ? "ml-auto bg-primary/10" : "bg-muted"}`}>{m.text}<div className="text-[10px] text-muted-foreground mt-1">{new Date(m.at).toLocaleString()}{m.from === "user" ? ` · ${m.status === "answered" ? "answered" : "waiting for the bot"}` : ""}</div></div>)}</div>
          <div className="p-3 border-t flex gap-2"><Textarea value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${cur?.name ?? "bot"}…`} className="min-h-[44px]" data-testid="ai-input" />
            <Button disabled={!text.trim() || !cur?.enabled} data-testid="ai-send" onClick={() => run(() => call(`/messages/${bot}`, "POST", { text }), "Sent to the bot").then(() => setText(""))}>Send</Button></div>
        </div></div>}
      {tab === "checks" && <div className="space-y-2">
        <div className="flex items-center gap-3"><Button size="sm" onClick={() => run(() => call("/checks/run", "POST"), "Checks done")} data-testid="ai-run-checks">Run checks now</Button><span className="text-xs text-muted-foreground">Rule-based, no AI needed. Runs daily. Last run: {checks.data?.runAt ? new Date(checks.data.runAt).toLocaleString() : "never"}</span></div>
        {(checks.data?.issues ?? []).filter((i: any) => !i.dismissed).map((i: any) => <div key={i.id} className="border rounded-md p-2 text-sm flex justify-between gap-2"><div><span className={`text-[10px] uppercase font-semibold mr-2 ${i.severity === "high" ? "text-red-600" : i.severity === "medium" ? "text-amber-600" : "text-muted-foreground"}`}>{i.severity}</span><span className="text-xs text-muted-foreground mr-2">{i.bot}</span>{i.text}</div><Button size="sm" variant="ghost" onClick={() => run(() => call(`/checks/${encodeURIComponent(i.id)}/dismiss`, "POST", {}))}>Dismiss</Button></div>)}
        {checks.data && !(checks.data.issues ?? []).some((i: any) => !i.dismissed) && <p className="text-sm text-muted-foreground">No open issues.</p>}
      </div>}
      {tab === "escalations" && <div className="space-y-2">{(esc.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting for a person.</p>}
        {(esc.data ?? []).map(e => <div key={e.id} className={`border rounded-md p-3 text-sm ${e.status === "open" ? "" : "opacity-60"}`}><div className="flex justify-between gap-2"><b>{e.topic} → {e.to?.name ?? "nobody set (choose in Setup)"}</b><span className="text-xs">{e.status} · {new Date(e.at).toLocaleString()}</span></div>
          <p className="whitespace-pre-wrap mt-1">{e.text}</p><p className="text-xs text-muted-foreground mt-1">From {e.from} · {e.delivery}</p>
          {e.status === "open" && <Button size="sm" variant="outline" className="mt-2" onClick={() => run(() => call(`/escalations/${e.id}/resolve`, "POST", {}), "Marked done")}>Mark done</Button>}</div>)}</div>}
      {tab === "checkins" && <div className="space-y-2">
        <div className="flex items-center gap-3"><Button size="sm" onClick={() => run(() => call("/checkins/run", "POST"), "Today's check-ins created")}>Create today's check-ins</Button><span className="text-xs text-muted-foreground">Created daily at {ops.data?.checkinTime ?? "18:00"} for active staff. WhatsApp sending is off: enter answers here.</span></div>
        {(cins.data?.checkins ?? []).length === 0 && <p className="text-sm text-muted-foreground">No check-ins for {cins.data?.date} yet.</p>}
        {(cins.data?.checkins ?? []).map((c: any) => <CheckinRow key={c.id} c={c} run={run} />)}</div>}
      {tab === "reports" && <div className="space-y-2">
        <div className="flex items-center gap-3"><Button size="sm" onClick={() => run(() => call("/reports/generate", "POST"), "Report drafted")} data-testid="ai-make-report">Make today's report now</Button><span className="text-xs text-muted-foreground">Drafted daily at {ops.data?.reportTime ?? "20:00"}. Not sent anywhere.</span></div>
        {(reps.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
        {(reps.data ?? []).map(r => <details key={r.id} open={r === reps.data?.[0]} className="border rounded-md p-3 text-sm"><summary className="cursor-pointer font-medium">{r.date} · {r.status} · {new Date(r.generatedAt).toLocaleTimeString()}</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{r.text}</pre></details>)}</div>}
      {tab === "proposals" && <div className="space-y-2">{(props.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No proposed changes.</p>}
        {(props.data ?? []).map(p => <div key={p.id} className="border rounded-md p-3 text-sm space-y-1"><div className="flex justify-between"><b>{p.title}</b><span className="text-xs">{p.bot} · {p.status}</span></div>{p.reason && <p className="text-muted-foreground">{p.reason}</p>}
          <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">{p.method} {p.path}{"\n"}{JSON.stringify(p.body, null, 2)}</pre>
          {p.status === "pending" && <div className="flex gap-2"><Button size="sm" onClick={() => run(() => call(`/proposals/${p.id}/approve`, "POST"), "Change applied")}>Approve & apply</Button><Button size="sm" variant="outline" onClick={() => run(() => call(`/proposals/${p.id}/reject`, "POST"), "Rejected")}>Reject</Button></div>}
          {p.result?.error && <p className="text-xs text-red-600">{String(p.result.error)}</p>}</div>)}</div>}
      {tab === "setup" && INSTANCE.waApprovals && admin && <div className="rounded-2xl border p-4"><WaPromptEditor /></div>}
      {tab === "setup" && <div className="space-y-3">
        {!admin && <p className="text-sm text-muted-foreground">Only admins can change bot setup.</p>}
        <div className="flex gap-2 items-center text-sm">Plan: {Object.keys(bots.data?.plans ?? {}).map(pl => <Button key={pl} size="sm" disabled={!admin} variant={bots.data?.plan === pl ? "default" : "outline"} onClick={() => run(() => call("/config", "PUT", { plan: pl }), "Plan saved")}>{pl === "full_ops" ? "Full Ops" : pl[0].toUpperCase() + pl.slice(1)}</Button>)}</div>
        {newKey && <div className="border border-amber-400 bg-amber-50 rounded p-2 text-xs break-all">New bot key (shown once, copy it now): <b>{newKey}</b></div>}
        {ops.data && <OpsSetup ops={ops.data} admin={admin} run={run} />}
        {list.map((b: any) => <BotRow key={b.id} b={b} admin={admin} run={run} setNewKey={setNewKey} />)}
        <p className="text-xs text-muted-foreground">Relay is {bots.data?.relay}. With BOT_RELAY=on the app forwards each message to the bot's webhook and/or email address; otherwise the bot collects messages with its key (GET /api/ai-staff/bot/inbox).</p>
      </div>}
    </div>);
}
function BotRow({ b, admin, run, setNewKey }: any) {
  const [email, setEmail] = useState(b.email ?? ""); const [hook, setHook] = useState(b.webhookUrl ?? "");
  return <div className="border rounded-md p-3 space-y-2 text-sm">
    <div className="flex justify-between items-center"><div><b>{b.name}</b> <span className="text-xs text-muted-foreground">{b.inPlan ? "" : "(not in plan)"} {b.hasKey ? "· key set" : "· no key"}</span></div>
      <Button size="sm" variant={b.enabled ? "default" : "outline"} disabled={!admin || !b.inPlan} onClick={() => run(() => call("/config", "PUT", { enabled: { [b.id]: !b.enabled } }))}>{b.enabled ? "On" : "Off"}</Button></div>
    <div className="grid md:grid-cols-2 gap-2"><Input placeholder="Bot email (e.g. its Grok Bot inbox)" value={email} onChange={e => setEmail(e.target.value)} disabled={!admin} /><Input placeholder="Webhook URL (https://…)" value={hook} onChange={e => setHook(e.target.value)} disabled={!admin} /></div>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!admin} onClick={() => run(() => call("/config", "PUT", { bots: { [b.id]: { email, webhookUrl: hook } } }), "Saved")}>Save address</Button>
      <Button size="sm" variant="outline" disabled={!admin} onClick={async () => { const r = await run(() => call(`/bots/${b.id}/key`, "POST")); if (r?.key) setNewKey(`${b.name}: ${r.key}`); }}>{b.hasKey ? "Replace key" : "Create key"}</Button></div>
    <details className="text-xs text-muted-foreground"><summary>Role instructions</summary><p className="mt-1">{b.instructions}</p></details>
  </div>;
}

function CheckinRow({ c, run }: any) {
  const [a, setA] = useState(c.answer ?? "");
  return <div className="border rounded-md p-3 text-sm space-y-1"><div className="flex justify-between"><b>{c.staffName} <span className="font-normal text-xs text-muted-foreground">{c.role}</span></b><span className="text-xs">{c.status}</span></div>
    <p className="text-xs text-muted-foreground">{c.question} · {c.delivery}</p>
    <div className="flex gap-2"><Textarea value={a} onChange={e => setA(e.target.value)} placeholder="What they did today" className="min-h-[40px]" /><Button size="sm" disabled={!a.trim()} onClick={() => run(() => call(`/checkins/${c.id}/answer`, "POST", { answer: a }), "Saved")}>Save</Button></div></div>;
}
function OpsSetup({ ops, admin, run }: any) {
  const [esc, setEsc] = useState<Record<string, string>>(Object.fromEntries((ops.topics ?? []).map((t: string) => [t, String(ops.escalation?.[t]?.staffId ?? "")])));
  const [ct, setCt] = useState(ops.checkinTime), [rt, setRt] = useState(ops.reportTime);
  return <div className="border rounded-md p-3 space-y-2 text-sm">
    <b>Who gets asked when a bot doesn't know</b>
    <div className="grid md:grid-cols-2 gap-2">{(ops.topics ?? []).map((t: string) => <label key={t} className="flex items-center gap-2"><span className="w-28 capitalize">{t}</span>
      <select className="border rounded h-9 px-2 flex-1 bg-background" disabled={!admin} value={esc[t]} onChange={e => setEsc({ ...esc, [t]: e.target.value })}><option value="">Nobody (show in app)</option>{(ops.staff ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}</select></label>)}</div>
    <div className="flex flex-wrap gap-3 items-center"><label>Staff check-in at <Input className="inline w-24 h-8" value={ct} onChange={e => setCt(e.target.value)} disabled={!admin} /></label><label>Daily report at <Input className="inline w-24 h-8" value={rt} onChange={e => setRt(e.target.value)} disabled={!admin} /></label><span className="text-xs text-muted-foreground">Dubai time · outgoing messages {ops.outbound}</span></div>
    <Button size="sm" variant="outline" disabled={!admin} onClick={() => run(() => call("/ops", "PUT", { checkinTime: ct, reportTime: rt, escalation: Object.fromEntries(Object.entries(esc).map(([t, v]) => [t, v ? { staffId: Number(v) } : null])) }), "Saved")}>Save</Button>
  </div>;
}
