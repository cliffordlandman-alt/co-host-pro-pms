import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Download, FileCheck2, Info, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api-fetch";
import { apiJson } from "@/lib/api-json";
import { monthLabel, shiftMonth, dubaiMonth, money } from "@/lib/income";

// Dubai compliance: permit record per unit with renewal reminders, the monthly Tourism Dirham and VAT report
// (CSV) with the filing reminder, and DTCM guest registration per booking. Rates come only from Fee settings.

type Reminder = { propertyId: number; propertyName: string; field: string; label: string; expiry: string; days: number; stage: string };
type Permit = Record<string, string | null> & { propertyId?: any };
type PermitProp = { id: number; name: string; unitNumber: string; city: string | null; dubai: boolean; permit: Permit | null; reminders: Reminder[] };
type Filing = { id: number; kind: string; period: string; filedOn: string; reference: string | null; filedBy: string | null };
type PermitsData = { today: string; uploads: boolean; uploadsNote: string; properties: PermitProp[]; reminders: Reminder[]; filing: { period: string; due: string; days: number; overdue: boolean } | null; filings: Filing[] };

const FIELDS: { key: string; label: string; type?: string; group: string }[] = [
  { key: "dtcmPermitNumber", label: "DTCM permit number", group: "DTCM holiday-home permit" },
  { key: "permitIssueDate", label: "Issue date", type: "date", group: "DTCM holiday-home permit" },
  { key: "permitExpiryDate", label: "Expiry date", type: "date", group: "DTCM holiday-home permit" },
  { key: "oaNocReference", label: "OA NOC reference", group: "Building (OA) NOC" },
  { key: "oaNocExpiryDate", label: "NOC expiry date", type: "date", group: "Building (OA) NOC" },
  { key: "insuranceReference", label: "Insurance policy", group: "Insurance" },
  { key: "insuranceExpiryDate", label: "Insurance expiry date", type: "date", group: "Insurance" },
  { key: "ejariNumber", label: "Ejari number", group: "Ejari (leased units)" },
  { key: "ejariExpiryDate", label: "Ejari expiry date", type: "date", group: "Ejari (leased units)" },
];
const fmtDate = (d?: string | null) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "–");
const stageCls = (s: string) => s === "expired" || s === "7" ? "border-rose-300 bg-rose-50 text-rose-800" : s === "30" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-800";
const dueText = (r: Reminder) => r.days < 0 ? `expired ${-r.days} day${r.days === -1 ? "" : "s"} ago` : r.days === 0 ? "expires today" : `expires in ${r.days} day${r.days === 1 ? "" : "s"}`;

function PermitDialog({ p, onClose }: { p: PermitProp; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...FIELDS.map(f => f.key), "dtcmClass", "notes"].map(k => [k, String(p.permit?.[k] ?? "")])));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await apiJson(`/api/compliance/permits/${p.id}`, "PUT", form); toast({ title: "Permit record saved" }); qc.invalidateQueries({ queryKey: ["compliance-permits"] }); qc.invalidateQueries({ queryKey: ["task-centre"] }); onClose(); }
    catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  const groups = [...new Set(FIELDS.map(f => f.group))];
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Permits · {p.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {groups.map(g => (
            <fieldset key={g} className="space-y-2">
              <legend className="text-sm font-semibold">{g}</legend>
              {g.startsWith("DTCM") && <label className="block text-sm">Class
                <Select value={form.dtcmClass || "none"} onValueChange={v => setForm(f => ({ ...f, dtcmClass: v === "none" ? "" : v }))}>
                  <SelectTrigger data-testid="permit-class"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Not recorded</SelectItem><SelectItem value="standard">Standard</SelectItem><SelectItem value="deluxe">Deluxe</SelectItem></SelectContent>
                </Select></label>}
              <div className="grid gap-2 sm:grid-cols-2">
                {FIELDS.filter(f => f.group === g).map(f => <label key={f.key} className="text-sm">{f.label}<Input data-testid={`permit-${f.key}`} type={f.type ?? "text"} value={form[f.key]} onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} /></label>)}
              </div>
            </fieldset>
          ))}
          <label className="block text-sm">Notes (where the documents are kept, who to call)<Input value={form.notes} onChange={e => setForm(x => ({ ...x, notes: e.target.value }))} /></label>
          <p className="flex gap-2 rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Document uploads come with hosting (file storage). For now, record the numbers and dates; reminders work from the expiry dates.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button data-testid="permit-save" disabled={busy} onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FiledDialog({ period, onClose }: { period: string; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const [filedOn, setFiledOn] = useState(today); const [reference, setReference] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await apiJson("/api/compliance/filings", "POST", { kind: "tourism_dirham", period, filedOn, reference }); toast({ title: `${monthLabel(period)} return recorded as filed` }); qc.invalidateQueries(); onClose(); }
    catch (e: any) { toast({ title: "Not recorded", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Tourism Dirham return · {monthLabel(period)}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Record that you filed this return on the DTCM portal. LaunchRiot doesn't file it for you.</p>
        <label className="text-sm">Filed on<Input type="date" max={today} value={filedOn} onChange={e => setFiledOn(e.target.value)} /></label>
        <label className="text-sm">DTCM reference (optional)<Input data-testid="filing-reference" value={reference} onChange={e => setReference(e.target.value)} /></label>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button data-testid="filing-save" disabled={busy} onClick={save}>Record as filed</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermitsTab({ canEdit }: { canEdit: boolean }) {
  const q = useQuery<PermitsData>({ queryKey: ["compliance-permits"], queryFn: () => apiJson("/api/compliance/permits") });
  const [edit, setEdit] = useState<PermitProp | null>(null); const [filing, setFiling] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const qc = useQueryClient(); const { toast } = useToast();
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data!;
  const dubai = d.properties.filter(p => p.dubai), other = d.properties.filter(p => !p.dubai);
  async function undo(f: Filing) {
    try { await apiJson(`/api/compliance/filings/${f.id}`, "DELETE"); toast({ title: `${monthLabel(f.period)} filing removed` }); qc.invalidateQueries(); }
    catch (e: any) { toast({ title: "Not removed", description: e.message, variant: "destructive" }); }
  }
  const card = (p: PermitProp) => {
    const x = p.permit;
    return (
      <section key={p.id} data-testid={`permit-card-${p.id}`} className="rounded-2xl border bg-card p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-semibold">{p.name}</h3><p className="text-xs text-muted-foreground">{p.unitNumber}{p.city ? ` · ${p.city}` : ""}</p></div>
          {canEdit && <Button size="sm" variant="outline" data-testid={`permit-edit-${p.id}`} onClick={() => setEdit(p)}><Pencil className="mr-1 h-3.5 w-3.5" />{x ? "Edit" : "Add"}</Button>}
        </div>
        {!x ? <p className="mt-2 text-sm text-muted-foreground">No permit details recorded yet.</p> : (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">DTCM permit</dt><dd className="font-medium">{x.dtcmPermitNumber || "–"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Class</dt><dd className="font-medium capitalize">{x.dtcmClass || "not recorded"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Issued</dt><dd>{fmtDate(x.permitIssueDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Permit expires</dt><dd>{fmtDate(x.permitExpiryDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">OA NOC</dt><dd>{x.oaNocReference || "–"}{x.oaNocExpiryDate ? ` · to ${fmtDate(x.oaNocExpiryDate)}` : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Insurance expires</dt><dd>{fmtDate(x.insuranceExpiryDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Ejari</dt><dd>{x.ejariNumber || "–"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Ejari expires</dt><dd>{fmtDate(x.ejariExpiryDate)}</dd></div>
          </dl>
        )}
        {p.reminders.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{p.reminders.map(r => <span key={r.field} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stageCls(r.stage)}`}>{r.label} {dueText(r)}</span>)}</div>}
      </section>
    );
  };
  return (
    <div className="space-y-3">
      {d.filing && (
        <div data-testid="filing-reminder" className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${d.filing.overdue ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          <p className="text-sm"><CalendarClock className="mr-1 inline h-4 w-4" /><b>Tourism Dirham return for {monthLabel(d.filing.period)}</b> {d.filing.overdue ? `was due on ${fmtDate(d.filing.due)} (${-d.filing.days} days ago).` : `is due by ${fmtDate(d.filing.due)} (${d.filing.days === 0 ? "today" : `${d.filing.days} day${d.filing.days === 1 ? "" : "s"} left`}).`}{" "}
            <Link href={`/compliance?tab=tax&month=${d.filing.period}`} className="underline">See the figures</Link></p>
          <Button size="sm" data-testid="filing-mark" onClick={() => setFiling(d.filing!.period)}><FileCheck2 className="mr-1 h-4 w-4" />Mark as filed</Button>
        </div>
      )}
      <p data-testid="uploads-note" className="flex gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />{d.uploadsNote}</p>
      {d.reminders.length > 0 && (
        <section className="rounded-2xl border bg-card p-3 sm:p-4">
          <h2 className="font-semibold">Renewals due</h2>
          <p className="text-xs text-muted-foreground">Shown from 60 days before expiry; also in the Task Centre, more urgent at 30 and 7 days.</p>
          <ul className="mt-2 divide-y">{d.reminders.map(r => <li key={`${r.propertyId}-${r.field}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{r.propertyName}</b> · {r.label}</span><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stageCls(r.stage)}`}>{dueText(r)} · {fmtDate(r.expiry)}</span></li>)}</ul>
        </section>
      )}
      <h2 className="pt-1 font-semibold">Dubai units ({dubai.length})</h2>
      {dubai.length === 0 ? <p className="text-sm text-muted-foreground">No properties with Dubai as the city.</p> : dubai.map(card)}
      {other.length > 0 && <>
        <Button variant="ghost" size="sm" onClick={() => setShowOther(!showOther)}>{showOther ? "Hide" : "Show"} other properties ({other.length}, not in Dubai)</Button>
        {showOther && other.map(card)}
      </>}
      {d.filings.length > 0 && (
        <section className="rounded-2xl border bg-card p-3 sm:p-4">
          <h2 className="font-semibold">Returns recorded as filed</h2>
          <ul className="mt-1 divide-y text-sm">{d.filings.map(f => <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>Tourism Dirham · <b>{monthLabel(f.period)}</b> · filed {fmtDate(f.filedOn)}{f.reference ? ` · ref ${f.reference}` : ""}</span>{canEdit && <Button size="sm" variant="ghost" onClick={() => undo(f)}>Undo</Button>}</li>)}</ul>
        </section>
      )}
      {edit && <PermitDialog p={edit} onClose={() => setEdit(null)} />}
      {filing && <FiledDialog period={filing} onClose={() => setFiling(null)} />}
    </div>
  );
}

function TaxTab({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth); const [filing, setFiling] = useState(false);
  const { toast } = useToast();
  const q = useQuery<any>({ queryKey: ["compliance-tax", month], queryFn: () => apiJson(`/api/compliance/tax-report?month=${month}`) });
  const current = dubaiMonth();
  async function csv() {
    const r = await apiFetch(`/api/compliance/tax-report.csv?month=${month}`);
    if (!r.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = `tourism-dirham-vat-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const d = q.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <span data-testid="tax-month" className="min-w-[9rem] text-center font-semibold">{monthLabel(month)}</span>
        <Button size="sm" variant="outline" aria-label="Next month" disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" data-testid="tax-csv" onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          {d && !d.filing && month < current && <Button size="sm" data-testid="tax-mark-filed" onClick={() => setFiling(true)}><FileCheck2 className="mr-1 h-4 w-4" />Mark as filed</Button>}
        </div>
      </div>
      {d?.filing && <p data-testid="tax-filed" className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900"><ShieldCheck className="mr-1 inline h-4 w-4" />Return recorded as filed on {fmtDate(d.filing.filedOn)}{d.filing.reference ? ` (ref ${d.filing.reference})` : ""}.</p>}
      <p className="text-xs text-muted-foreground">{d?.basis} Due to DTCM by the 15th of the next month. Rates come only from Fee settings.</p>
      {q.isLoading && <Skeleton className="h-40" />}
      {d && d.unconfirmed.length > 0 && <p data-testid="rate-unconfirmed" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mr-1 inline h-4 w-4" /><b>Rate not confirmed for {d.unconfirmed.length} propert{d.unconfirmed.length === 1 ? "y" : "ies"}</b> ({d.unconfirmed.join(", ")}). The amounts below are what the bookings were charged with, but the Tourism Dirham rate or VAT position hasn't been confirmed. Once decided, tick "confirmed" for the property in <Link href="/accounting?tab=settings" className="underline">Fee settings</Link>.</p>}
      {d && d.unverified > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-950">{d.unverified} booking{d.unverified === 1 ? "" : "s"} not verified yet: not in these figures. <Link href="/verify-bookings" className="underline">Verify bookings</Link></p>}
      {d && <div className="grid gap-2 sm:grid-cols-2">{d.totals.length === 0 ? <p className="text-sm text-muted-foreground">No verified bookings checked out in {monthLabel(month)} at these properties.</p> : d.totals.map((t: any) => (
        <section key={t.currency} data-testid={`tax-total-${t.currency}`} className="rounded-2xl border bg-card p-3">
          <h3 className="font-semibold">{t.currency} total</h3>
          <div className="mt-1 grid grid-cols-2 gap-2 text-sm"><div><div className="text-xs text-muted-foreground">Tourism Dirham</div><div className="text-lg font-bold">{money(t.tourismFee, t.currency)}</div></div><div><div className="text-xs text-muted-foreground">VAT</div><div className="text-lg font-bold">{money(t.vat, t.currency)}</div></div>
            <div className="text-xs text-muted-foreground">{t.bookings} bookings · {t.roomNights} room-nights</div><div className="text-xs text-muted-foreground">Accommodation {money(t.accommodation, t.currency)}</div></div>
        </section>))}</div>}
      {d && <div className="space-y-2 lg:hidden">{d.properties.map((p: any) => (
        <section key={p.propertyId} data-testid={`tax-row-${p.propertyId}`} className="rounded-xl border bg-card p-3 text-sm">
          <div className="font-semibold">{p.name}</div>
          {p.figures.length === 0 ? <div className="text-xs text-muted-foreground">No verified bookings checked out this month.</div> : p.figures.map((f: any) => <div key={f.currency} className="mt-1 grid grid-cols-2 gap-1"><span>Tourism Dirham <b>{money(f.tourismFee, f.currency)}</b></span><span>VAT <b>{money(f.vat, f.currency)}</b></span><span className="text-xs text-muted-foreground">{f.bookings} bookings · {f.roomNights} room-nights</span><span className="text-xs text-muted-foreground">Accommodation {money(f.accommodation, f.currency)}</span></div>)}
          <div className="mt-1 text-xs"><Setting s={p.settings.tourism} label="Tourism Dirham" /> · <Setting s={p.settings.vat} label="VAT" />{p.unverified ? <span className="text-amber-800"> · {p.unverified} not verified</span> : null}</div>
        </section>))}</div>}
      {d && <div className="hidden overflow-x-auto rounded-2xl border bg-card lg:block"><table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Property</th><th className="px-2">Bookings</th><th className="px-2">Room-nights</th><th className="px-2">Accommodation</th><th className="px-2">Tourism Dirham</th><th className="px-2">VAT</th><th className="px-2">Fee settings</th><th className="px-2">Not verified</th></tr></thead>
        <tbody>{d.properties.flatMap((p: any) => (p.figures.length ? p.figures : [null]).map((f: any, i: number) => (
          <tr key={`${p.propertyId}-${i}`} data-testid={`tax-tr-${p.propertyId}`} className="border-t"><td className="px-3 py-2 font-medium">{p.name}</td>
            <td className="px-2">{f?.bookings ?? 0}</td><td className="px-2">{f?.roomNights ?? 0}</td><td className="px-2">{f ? money(f.accommodation, f.currency) : "–"}</td>
            <td className="px-2 font-semibold">{f ? money(f.tourismFee, f.currency) : "–"}</td><td className="px-2 font-semibold">{f ? money(f.vat, f.currency) : "–"}</td>
            <td className="px-2 text-xs"><Setting s={p.settings.tourism} label="TD" /><br /><Setting s={p.settings.vat} label="VAT" /></td><td className="px-2">{p.unverified || ""}</td></tr>)))}</tbody>
      </table></div>}
      {filing && <FiledDialog period={month} onClose={() => setFiling(false)} />}
    </div>
  );
}
function Setting({ s, label }: { s: any; label: string }) {
  return s.confirmed ? <span>{label}: {s.text}</span> : <span className="font-semibold text-amber-800">{label}: {s.text}</span>;
}

function RegistrationTab() {
  const q = useQuery<any>({ queryKey: ["compliance-registrations"], queryFn: () => apiJson("/api/compliance/registrations") });
  const qc = useQueryClient(); const { toast } = useToast();
  async function set(id: number, status: string) {
    try { await apiJson(`/api/compliance/registrations/${id}`, "PATCH", { status }); qc.invalidateQueries({ queryKey: ["compliance-registrations"] }); qc.invalidateQueries({ queryKey: ["task-centre"] }); toast({ title: "Registration status saved" }); }
    catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
  }
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Dubai bookings checking out from yesterday to arrivals in the next 30 days. Airbnb bookings count as "Airbnb-verified ID" (never pending); change to Registered once the guest is registered with DTCM. LaunchRiot doesn't submit to DTCM itself.</p>
      {d.bookings.length === 0 ? <p className="text-sm text-muted-foreground">No Dubai bookings in this window.</p> : d.bookings.map((b: any) => (
        <div key={b.reservationId} data-testid={`reg-${b.reservationId}`} className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><Link href={`/reservations/${b.reservationId}`} className="font-medium hover:underline">{b.guestName}</Link>
            <div className="text-xs text-muted-foreground">{b.propertyName} · {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} · {b.platform === "booking_com" ? "Booking.com" : b.platform[0].toUpperCase() + b.platform.slice(1)}</div></div>
          <Select value={b.status} onValueChange={v => set(b.reservationId, v)}>
            <SelectTrigger className={`h-9 w-full sm:w-52 ${b.status === "pending" ? "border-amber-400 bg-amber-50" : b.status === "registered" ? "border-emerald-300 bg-emerald-50" : ""}`} data-testid={`reg-select-${b.reservationId}`}><SelectValue /></SelectTrigger>
            <SelectContent>{b.options.map((o: any) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

export default function CompliancePage() {
  const { user } = useAuth();
  const search = new URLSearchParams(useSearch());
  const role = user?.role ?? "";
  const money = ["admin", "super_admin", "manager", "accountant"].includes(role);
  const canEdit = ["admin", "super_admin", "manager"].includes(role);
  const bookings = ["admin", "super_admin", "manager", "reservations", "operations"].includes(role);
  const tabs = [money && "permits", money && "tax", bookings && "registration"].filter(Boolean) as string[];
  const wanted = search.get("tab") || tabs[0];
  const tab = tabs.includes(wanted) ? wanted : tabs[0];
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(search.get("month") || "") ? search.get("month")! : shiftMonth(dubaiMonth(), -1);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div><h1 className="text-xl font-bold sm:text-2xl">Dubai compliance</h1>
        <p className="text-sm text-muted-foreground">DTCM permits and renewals, the monthly Tourism Dirham and VAT figures, and guest registration per booking.</p></div>
      {tabs.length === 0 ? <p className="text-sm">Your role has no compliance tasks.</p> : (
        <Tabs key={`${tab}-${month}`} defaultValue={tab}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            {tabs.includes("permits") && <TabsTrigger value="permits">Permits & renewals</TabsTrigger>}
            {tabs.includes("tax") && <TabsTrigger value="tax">Tourism Dirham & VAT</TabsTrigger>}
            {tabs.includes("registration") && <TabsTrigger value="registration">Guest registration</TabsTrigger>}
          </TabsList>
          <TabsContent value="permits"><PermitsTab canEdit={canEdit} /></TabsContent>
          <TabsContent value="tax"><TaxTab initialMonth={month} /></TabsContent>
          <TabsContent value="registration"><RegistrationTab /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
