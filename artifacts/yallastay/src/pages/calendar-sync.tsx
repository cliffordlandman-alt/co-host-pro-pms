import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Info, Link2, RefreshCw, RotateCcw, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson, ago, dubaiTime } from "@/lib/api-json";

// Calendar sync: YallaPMS's own calendar link per property (for Airbnb, Booking.com and Vrbo to import, so a block
// or direct booking made here closes those dates there) and the health of every incoming channel calendar.

type Feed = { platform: string; label: string; configured: boolean; state: "not_connected" | "never" | "ok" | "failing" | "alert" | "stale"; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastErrorAt: string | null; failingSince: string | null; lastSummary: string | null };
type Events = { total: number; blocks: number; direct: number; channel: number; byChannel: Record<string, number> };
type Prop = { id: number; name: string; unitNumber: string; feeds: Feed[]; export: { includeChannelBookings: boolean; rotatedAt: string | null; lastFetchedAt: string | null; fetchCount: number; links: { target: string; path: string; events: Events }[] } };
type Data = { publicBaseUrl: string | null; outboundDelivery: boolean; properties: Prop[]; summary: { connected: number; ok: number; failing: number; alerts: number; stale: number; never: number } };
const TARGET: Record<string, string> = { airbnb: "Paste into Airbnb", booking_com: "Paste into Booking.com", vrbo: "Paste into Vrbo", all: "Any other calendar" };

function FeedRow({ f, propertyId }: { f: Feed; propertyId: number }) {
  const qc = useQueryClient(); const { toast } = useToast(); const [busy, setBusy] = useState(false);
  const chip = {
    ok: { cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2, text: `Synced ${ago(f.lastSuccessAt)}` },
    failing: { cls: "bg-amber-50 text-amber-900 border-amber-200", icon: AlertTriangle, text: `Failing since ${dubaiTime(f.failingSince)}` },
    alert: { cls: "bg-rose-50 text-rose-800 border-rose-200", icon: XCircle, text: `Failing over 2 h · since ${dubaiTime(f.failingSince)}` },
    stale: { cls: "bg-amber-50 text-amber-900 border-amber-200", icon: Clock, text: `No sync for ${ago(f.lastSuccessAt).replace(" ago", "")}` },
    never: { cls: "bg-slate-50 text-slate-700 border-slate-200", icon: Clock, text: "Link saved, not synced yet" },
    not_connected: { cls: "bg-slate-50 text-slate-500 border-slate-200", icon: Link2, text: "Not connected" },
  }[f.state];
  const Icon = chip.icon;
  async function syncNow() {
    setBusy(true);
    try { const r = await apiJson(`/api/calendar-sync/${propertyId}/sync/${f.platform}`, "POST"); toast({ title: `${f.label} synced`, description: `${r.total} events: ${r.created} new, ${r.updated} updated` }); }
    catch (e: any) { toast({ title: `${f.label} sync failed`, description: e.message, variant: "destructive" }); }
    finally { setBusy(false); qc.invalidateQueries({ queryKey: ["calendar-sync"] }); }
  }
  return (
    <div data-testid={`feed-${propertyId}-${f.platform}`} data-state={f.state} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-28 shrink-0 text-sm font-medium">{f.label}</span>
      <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${chip.cls}`}><Icon className="h-3.5 w-3.5" />{chip.text}</span>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {f.configured && f.lastSuccessAt && f.state !== "ok" && <div>Last successful sync: {dubaiTime(f.lastSuccessAt)}</div>}
        {f.state === "ok" && f.lastSummary && <div className="truncate">{f.lastSummary}</div>}
        {f.lastError && f.state !== "ok" && <div className="break-words text-rose-700">Error ({dubaiTime(f.lastErrorAt)}): {f.lastError}</div>}
      </div>
      {f.configured && <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={syncNow}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />Sync now</Button>}
    </div>
  );
}

function ExportBlock({ p, base }: { p: Prop; base: string }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [rotateOpen, setRotateOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const url = (path: string) => `${base}${path}`;
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast({ title: "Link copied" }); }
    catch { window.prompt("Copy this link", text); }
  }
  async function toggle(v: boolean) {
    setBusy(true);
    try { await apiJson(`/api/calendar-sync/${p.id}`, "PATCH", { includeChannelBookings: v }); toast({ title: v ? "Other channels' bookings included" : "Only LaunchRiot blocks and direct bookings" }); }
    catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); qc.invalidateQueries({ queryKey: ["calendar-sync"] }); }
  }
  async function rotate() {
    setBusy(true);
    try { await apiJson(`/api/calendar-sync/${p.id}/rotate`, "POST"); toast({ title: "New link created", description: "The old link no longer works. Paste the new one into each channel." }); setCheck(null); }
    catch (e: any) { toast({ title: "Not changed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); setRotateOpen(false); qc.invalidateQueries({ queryKey: ["calendar-sync"] }); }
  }
  async function checkLink(path: string) {
    setCheck("Checking…");
    try {
      const r = await fetch(path, { headers: { "X-YallaPMS-Check": "1" } });
      const text = await r.text();
      if (!r.ok || !text.startsWith("BEGIN:VCALENDAR")) throw new Error(`The link answered ${r.status}`);
      const n = (text.match(/BEGIN:VEVENT/g) || []).length;
      setCheck(`Link works here: ${n} unavailable period${n === 1 ? "" : "s"} in the calendar.`);
    } catch (e: any) { setCheck(`Link check failed: ${e.message}`); }
  }
  const e = p.export;
  const all = e.links.find(l => l.target === "all")!.events;
  return (
    <div className="mt-3 rounded-xl border bg-muted/30 p-3">
      <button type="button" data-testid={`export-toggle-${p.id}`} aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 text-left">
        <span className="text-sm font-semibold">LaunchRiot calendar link (outgoing)</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {all.total} unavailable period{all.total === 1 ? "" : "s"} · last read by a channel: {e.lastFetchedAt ? `${dubaiTime(e.lastFetchedAt)} (${e.fetchCount}×)` : "never"}
          <span className="inline-flex items-center whitespace-nowrap font-medium text-foreground">{open ? "Hide" : "Show links"}<ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></span>
        </span>
      </button>
      {open && <>
      <div className="mt-2 space-y-2">
        {e.links.map(l => (
          <div key={l.target} data-testid={`export-${p.id}-${l.target}`} className="rounded-lg border bg-background p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">{TARGET[l.target]}</span>
              <span className="text-[11px] text-muted-foreground">{l.events.total} period{l.events.total === 1 ? "" : "s"}: {l.events.blocks} blocks · {l.events.direct} direct{e.includeChannelBookings ? ` · ${l.events.channel} other channels` : ""}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{url(l.path)}</code>
              <Button size="sm" variant="outline" className="h-7 px-2" aria-label="Copy link" onClick={() => copy(url(l.path))}><Copy className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => checkLink(l.path)}>Check</Button>
            </div>
          </div>
        ))}
      </div>
      {check && <p data-testid={`export-check-${p.id}`} className="mt-2 text-xs">{check}</p>}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-start gap-2 text-sm">
          <Switch data-testid={`include-${p.id}`} checked={e.includeChannelBookings} disabled={busy} onCheckedChange={toggle} />
          <span><b>Also send bookings from other channels.</b><span className="block text-xs text-muted-foreground">Off: only blocks and direct bookings made in LaunchRiot. On: Airbnb's link also carries Booking.com and Vrbo bookings, and so on. A channel never gets its own bookings back. Leave off if your channels already read each other's calendars.</span></span>
        </label>
        <Button size="sm" variant="outline" className="w-fit shrink-0" disabled={busy} onClick={() => setRotateOpen(true)}><RotateCcw className="mr-1 h-3.5 w-3.5" />New secret link</Button>
      </div>
      {e.rotatedAt && <p className="mt-1 text-[11px] text-muted-foreground">Link last changed {dubaiTime(e.rotatedAt)}.</p>}
      </>}
      <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Make a new secret link for {p.name}?</AlertDialogTitle>
            <AlertDialogDescription>The current links stop working straight away. Any channel still using them will stop receiving LaunchRiot blocks until you paste the new link there.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep current link</AlertDialogCancel><AlertDialogAction onClick={rotate}>Make new link</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function CalendarSyncPage() {
  const q = useQuery<Data>({ queryKey: ["calendar-sync"], queryFn: () => apiJson("/api/calendar-sync"), refetchInterval: 60000 });
  const base = q.data?.publicBaseUrl ?? window.location.origin;
  const s = q.data?.summary;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Calendar sync</h1>
        <p className="text-sm text-muted-foreground">Incoming channel calendars and the LaunchRiot calendar link each channel can import, so dates blocked or booked here close on Airbnb, Booking.com and Vrbo too.</p>
      </div>
      {q.data && !q.data.publicBaseUrl && (
        <div data-testid="hosting-note" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div><b>These links can't be read by the channels yet.</b> LaunchRiot runs on your Mac, which Airbnb, Booking.com and Vrbo can't reach from the internet. The links work on this computer (use Check), and they'll work for the channels once LaunchRiot is hosted online. Don't paste them into the channels before then: they would show as broken there.</div>
        </div>
      )}
      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Channel calendars connected" value={s.connected} />
          <Tile label="Syncing fine" value={s.ok} tone="ok" />
          <Tile label="Failing" value={s.failing + s.alerts} tone={s.alerts ? "bad" : s.failing ? "warn" : undefined} testid="tile-failing" />
          <Tile label="Not synced recently" value={s.stale + s.never} tone={s.stale ? "warn" : undefined} />
        </div>
      )}
      {s && s.alerts > 0 && <p data-testid="alert-banner" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><b>{s.alerts} channel calendar{s.alerts === 1 ? " has" : "s have"} failed for more than 2 hours.</b> New bookings from that channel aren't reaching LaunchRiot, so double bookings are possible. An alert is in your notifications.{q.data?.outboundDelivery ? " Managers were also messaged on WhatsApp." : " No WhatsApp or email was sent (outgoing messages are switched off)."}</p>}
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && [...q.data.properties].sort((a, b) => rank(a) - rank(b)).map(p => (
        <section key={p.id} data-testid={`calsync-${p.id}`} className="rounded-2xl border bg-card p-3 sm:p-4">
          <h3 className="font-semibold">{p.name}{p.unitNumber ? <span className="ml-1 text-xs font-normal text-muted-foreground">· {p.unitNumber}</span> : null}</h3>
          {p.feeds.some(f => f.configured)
            ? <div className="mt-1 divide-y">{p.feeds.filter(f => f.configured).map(f => <FeedRow key={f.platform} f={f} propertyId={p.id} />)}
                {p.feeds.some(f => !f.configured) && <p className="pt-2 text-xs text-muted-foreground">Not connected: {p.feeds.filter(f => !f.configured).map(f => f.label).join(", ")}.</p>}</div>
            : <p data-testid={`no-feeds-${p.id}`} className="mt-1 text-sm text-muted-foreground">No channel calendars connected yet. Add the Airbnb, Booking.com or Vrbo calendar link on <Link href="/platforms" className="font-medium underline">Platforms</Link>.</p>}
          <ExportBlock p={p} base={base} />
        </section>
      ))}
    </div>
  );
}

const RANK = { alert: 0, failing: 1, stale: 2, never: 3, ok: 4, not_connected: 5 } as const;
/** Problems first, then connected properties, then the rest (each keeps its alphabetical order). */
const rank = (p: Prop) => Math.min(...p.feeds.map(f => RANK[f.state]));

function Tile({ label, value, tone, testid }: { label: string; value: number; tone?: "ok" | "warn" | "bad"; testid?: string }) {
  const cls = tone === "bad" ? "border-rose-300 bg-rose-50 text-rose-900" : tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "bg-card";
  return <div data-testid={testid} className={`rounded-xl border p-3 ${cls}`}><div className="text-2xl font-bold">{value}</div><div className="text-xs">{label}</div></div>;
}
