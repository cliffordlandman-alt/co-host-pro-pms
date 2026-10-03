import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetOwners, useGetProperties } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/api-fetch";
import { badgeStyle, platformLabel } from "@/lib/channel-colors";
import { AirbnbBreakdownImport } from "@/components/AirbnbBreakdownImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

// Verify bookings: enter the real guest totals for every unverified booking of one checkout month, so the
// month's owner statements can be generated. Every number shown is computed by the server, through the
// same calculation the booking edit uses (POST /reservations/:id/finance-preview is a dry run of it, and
// saving is the normal PATCH /reservations/:id). Guest totals are never pre-filled from payouts.

type Row = { id: number; propertyId: number; propertyName: string; ownerId: number | null; ownerName: string | null; guestName: string; checkIn: string; checkOut: string; platform: string;
  currency: string; channelEarnings: { currency: string; amount: number }[]; recordedAmount: number | null;
  defaults: { cleaningFee: number; channelPercent: number; managementPercent: number | null; vatRate: number; tourismEnabled: boolean }; needsRooms: boolean; locked: boolean; cohostPayout: number | null;
  /** Guest total already verified: only the co-host payout is missing. */ verified: boolean;
  /** Airbnb pays this property's co-host payout to the owner directly, so the amount is required. */ cohostRequired: boolean;
  /** The property's fee basis; "net-payout" needs the channel's actual fees. */ feeBasis: "gross" | "net-payout"; channelFees: number | null;
  /** Verified, but on another fee basis than the property's current one: saving recalculates it. */ needsRecalc: boolean };
type Form = { grossAmount: string; cleaningFee: string; channelCommissionPercent: string; tourismRooms: string; cohostPayout: string; channelFees: string };
type Preview = { ok: true; feeBasis?: string; grossAmount: number; revenue: number; vatAmount: number; tourismFee: number; channelPercent: number; channelAmount: number; managementPercent: number; managementAmount: number; cleaningFee: number; cleaningDeducted: boolean; ownerAmount: number } | { ok: false; error: string };
type State = { form: Form; preview?: Preview; previewKey?: string; checking?: boolean; saving?: boolean; saved?: boolean; error?: string };

const money = (v: number | null | undefined, c: string) => v == null ? "–" : `${c} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const keyOf = (f: Form, r: Row) => JSON.stringify(previewBody(f, r)); // what the finance preview depends on
const cohostOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const cents = (v: number) => Math.round(v * 100);
const isNet = (r: Row) => r.feeBasis === "net-payout";
/** The calculation input for this row (the same booking calculation as saving); null = nothing to recalculate. */
function previewBody(f: Form, r: Row): Record<string, unknown> | null {
  const fees = isNet(r) ? { channelFees: f.channelFees.trim() } : {};
  if (r.verified) return r.needsRecalc ? { financeMode: "inclusive-v1", ...fees } : null;
  return { grossAmount: f.grossAmount, cleaningFee: f.cleaningFee, financeMode: "inclusive-v1", ...(isNet(r) ? fees : { channelCommissionPercent: f.channelCommissionPercent }), ...(f.tourismRooms ? { tourismRooms: Number(f.tourismRooms) } : {}) };
}
/** Ready to ask the server for a breakdown (no request while a required amount is still blank). */
const previewReady = (f: Form, r: Row) => (r.verified || f.grossAmount !== "") && (!isNet(r) || f.channelFees.trim() !== "");
/** The breakdown adds back to the guest total (all parts as computed by the server). */
export function reconciles(p: Preview) {
  if (!p.ok) return false;
  const parts = cents(p.tourismFee) + cents(p.vatAmount) + cents(p.managementAmount) + cents(p.channelAmount) + (p.cleaningDeducted ? cents(p.cleaningFee) : 0) + cents(p.ownerAmount);
  return parts === cents(p.grossAmount) && cents(p.revenue) + cents(p.vatAmount) + cents(p.tourismFee) === cents(p.grossAmount);
}
function previousDubaiMonth() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
async function json(r: Response) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }

export default function VerifyBookings() {
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(params.get("month") || "") ? params.get("month")! : previousDubaiMonth());
  const [ownerId, setOwnerId] = useState(params.get("ownerId") || "");
  const [propertyId, setPropertyId] = useState(params.get("propertyId") || "");
  const { data: owners } = useGetOwners();
  const { data: properties } = useGetProperties();
  useEffect(() => {
    const q = new URLSearchParams({ month, ...(ownerId ? { ownerId } : {}), ...(propertyId ? { propertyId } : {}) });
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }, [month, ownerId, propertyId]);
  const query = new URLSearchParams({ month, ...(ownerId ? { ownerId } : {}), ...(propertyId ? { propertyId } : {}) }).toString();
  const { data: rows, isLoading, error, refetch } = useQuery<Row[]>({ queryKey: ["unverified-bookings", query], queryFn: async () => json(await apiFetch(`/api/reservations/unverified?${query}`)) });
  const [state, setState] = useState<Record<number, State>>({});
  const update = (id: number, patch: Partial<State>) => setState(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  const formFor = (r: Row): Form => state[r.id]?.form ?? { grossAmount: "", cleaningFee: String(r.defaults.cleaningFee), channelCommissionPercent: String(r.defaults.channelPercent), tourismRooms: "", cohostPayout: r.cohostPayout != null ? r.cohostPayout.toFixed(2) : "", channelFees: r.channelFees != null ? r.channelFees.toFixed(2) : "" };
  const propertyOptions = useMemo(() => ((properties as any[]) || []).filter(p => !ownerId || String(p.ownerId) === ownerId), [properties, ownerId]);
  const [bulk, setBulk] = useState<string>("");

  async function saveRow(r: Row): Promise<boolean> {
    const form = formFor(r);
    update(r.id, { saving: true, error: undefined });
    try {
      const cohost = r.cohostRequired ? { cohostPayout: form.cohostPayout.trim() } : {};
      const body = { ...(previewBody(form, r) ?? {}), ...cohost };
      await json(await apiFetch(`/api/reservations/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      update(r.id, { saving: false, saved: true });
      return true;
    } catch (e) { update(r.id, { saving: false, error: (e as Error).message }); return false; }
  }
  const valid = (r: Row) => {
    const s = state[r.id]; const form = formFor(r);
    if (r.locked || s?.saved || (r.cohostRequired && !cohostOk(form.cohostPayout))) return false;
    if (!previewBody(form, r)) return true; // verified; only the co-host payout was missing
    return !!s?.preview && s.preview.ok && reconciles(s.preview) && s.previewKey === keyOf(form, r);
  };
  const open = (rows || []).filter(r => !state[r.id]?.saved);
  const ready = open.filter(valid);
  async function saveAll() {
    setBulk("");
    let ok = 0, failed = 0;
    for (const r of ready) (await saveRow(r)) ? ok++ : failed++;
    setBulk(`${ok} saved${failed ? `, ${failed} not saved (see the rows)` : ""}.`);
    await qc.invalidateQueries();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Verify bookings</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">Bookings that checked out in the month and still have no verified guest total. Owner statements for a property are generated only once all of its bookings for the month are verified. Enter the full amount the guest paid (including VAT and tourism fees), not the Airbnb payout; the Airbnb figure is shown for reference only. Where Airbnb pays the co-host payout to the owner directly, the co-host payout is required too (bookings already verified but missing it are listed here as well).</p>
      </div>
      <AirbnbBreakdownImport />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Checkout month<Input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="w-44" /></label>
        <label className="text-sm">Owner<select aria-label="Owner" className="block h-9 rounded-md border bg-background px-2 text-sm w-48" value={ownerId} onChange={e => { setOwnerId(e.target.value); setPropertyId(""); }}>
          <option value="">All owners</option>{((owners as any[]) || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="text-sm">Property<select aria-label="Property" className="block h-9 rounded-md border bg-background px-2 text-sm w-56" value={propertyId} onChange={e => setPropertyId(e.target.value)}>
          <option value="">All properties</option>{propertyOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="flex items-center gap-3 sm:ml-auto">
          {bulk && <span className="text-sm text-muted-foreground" role="status">{bulk}</span>}
          <Button onClick={saveAll} disabled={!ready.length}>Save all valid ({ready.length})</Button>
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{(error as Error).message} <button className="underline" onClick={() => refetch()}>Retry</button></p>}
      {rows && !open.length && <p className="rounded-lg border p-4 text-sm">{rows.length ? "All bookings on this page are saved." : "No unverified bookings for this month and filter."} <Link href="/accounting" className="underline">Owner statements</Link></p>}
      <div className="space-y-3">
        {(rows || []).map(r => <VerifyRow key={r.id} row={r} form={formFor(r)} st={state[r.id]} canSave={valid(r)} update={p => update(r.id, p)} onSave={async () => { if (await saveRow(r)) await qc.invalidateQueries({ predicate: q => q.queryKey[0] !== "unverified-bookings" }); }} />)}
      </div>
    </div>
  );
}

function VerifyRow({ row: r, form, st, canSave, update, onSave }: { row: Row; form: Form; st?: State; canSave: boolean; update: (p: Partial<State>) => void; onSave: () => void }) {
  const seq = useRef(0);
  const key = keyOf(form, r);
  const net = isNet(r);
  useEffect(() => {
    if (r.locked || st?.saved || !previewBody(form, r)) return;
    if (!previewReady(form, r)) { update({ preview: undefined, previewKey: undefined, checking: false }); return; }
    const mine = ++seq.current;
    update({ checking: true });
    const t = setTimeout(async () => {
      try {
        const p = await json(await apiFetch(`/api/reservations/${r.id}/finance-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(previewBody(form, r)) }));
        if (mine === seq.current) update({ preview: p, previewKey: key, checking: false });
      } catch (e) { if (mine === seq.current) update({ preview: { ok: false, error: (e as Error).message }, previewKey: key, checking: false }); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, r.locked, st?.saved]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => update({ form: { ...form, [k]: e.target.value }, error: undefined });
  const p = st?.preview && st.previewKey === key ? st.preview : undefined;
  const c = r.currency;
  const disabled = r.locked || !!st?.saved || !!st?.saving;
  return (
    <div data-testid={`verify-row-${r.id}`} className={`rounded-lg border p-3 ${st?.saved ? "opacity-60" : ""}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(16rem,1.4fr)_minmax(14rem,1.4fr)_auto] lg:items-start">
        <div className="min-w-0 text-sm">
          <Link href={`/reservations/${r.id}`} className="font-medium hover:underline">{r.guestName || "Guest"}</Link>
          <p className="text-muted-foreground">{r.propertyName}{r.ownerName ? ` · ${r.ownerName}` : " · no owner"}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">{r.checkIn} → {r.checkOut}<span data-testid="channel-badge" className="rounded border px-1.5 py-0.5 text-[11px] font-medium" style={badgeStyle(r.platform)}>{platformLabel(r.platform)}</span></p>
          {r.channelEarnings.length > 0 && <p className="mt-1 text-xs">Airbnb expected earnings: <b>{r.channelEarnings.map(e => money(e.amount, e.currency)).join(" + ")}</b> <span className="text-muted-foreground">(reference only, not the guest total)</span></p>}
          {r.cohostPayout != null && !r.cohostRequired && <p className="mt-1 text-xs text-muted-foreground">Co-host payout: <b>{money(r.cohostPayout, r.currency)}</b> (recorded; not deducted for this property)</p>}
          {r.locked && <p className="mt-1 text-xs text-amber-700">This month's statement for this property was already sent or paid, so the booking can't be changed here.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {r.verified && !r.needsRecalc && <p className="col-span-2 text-xs text-emerald-700 sm:col-span-3"><CheckCircle2 className="mr-1 inline h-3 w-3" />Guest total already verified. Only the co-host payout is missing.</p>}
          {r.verified && r.needsRecalc && <p className="col-span-2 text-xs text-amber-800 sm:col-span-3">Guest total already verified, but on {net ? "the standard fee basis" : "the net-payout fee basis"}. {net ? "Enter the channel's actual fees and save to recalculate on the property's fee basis (management % of the net payout)." : "Save to recalculate on the standard basis."}</p>}
          {net && (!r.verified || r.needsRecalc) && <label className="col-span-2 text-xs sm:col-span-3">Channel fees, actual ({c}) <span className="text-red-600">required</span>
            <Input aria-label="Channel fees (actual)" inputMode="decimal" type="number" min="0" step="0.01" value={form.channelFees} onChange={set("channelFees")} disabled={disabled} />
            <span className="text-[11px] text-muted-foreground">Guest service fee + host service fee from the reservation's Airbnb details. This property's management fee is a % of the net payout.</span></label>}
          {r.cohostRequired && <label className="col-span-2 text-xs sm:col-span-3">Co-host payout, paid to the owner by Airbnb ({c}) <span className="text-red-600">required</span>
            <Input aria-label="Co-host payout" inputMode="decimal" type="number" min="0" step="0.01" value={form.cohostPayout} onChange={set("cohostPayout")} disabled={disabled} aria-invalid={form.cohostPayout !== "" && !cohostOk(form.cohostPayout)} />
            <span className="text-[11px] text-muted-foreground">From the reservation's Airbnb details (co-host payout). Not entered anywhere else.</span></label>}
          {!r.verified && <><label className="col-span-2 text-xs sm:col-span-1">Guest total ({c})<Input aria-label="Guest total" inputMode="decimal" type="number" min="0" step="0.01" value={form.grossAmount} onChange={set("grossAmount")} disabled={disabled} /></label>
          <label className="text-xs">Cleaning fee<Input aria-label="Cleaning fee" inputMode="decimal" type="number" min="0" step="0.01" value={form.cleaningFee} onChange={set("cleaningFee")} disabled={disabled} /></label>
          {!net && <label className="text-xs">Commission %<Input aria-label="Channel commission %" inputMode="decimal" type="number" min="0" max="100" step="0.01" value={form.channelCommissionPercent} onChange={set("channelCommissionPercent")} disabled={disabled} /></label>}
          {r.needsRooms && <label className="col-span-2 text-xs sm:col-span-3">Bedrooms for Tourism Dirham (studio = 1)<Input aria-label="Bedrooms" type="number" min="1" step="1" value={form.tourismRooms} onChange={set("tourismRooms")} disabled={disabled} /></label>}</>}
        </div>
        <div className="text-xs" aria-live="polite">
          {!p && !st?.checking && !r.locked && !!previewBody(form, r) && <p className="text-muted-foreground">{net && form.channelFees.trim() === "" ? "Enter the channel fees" : "Enter the guest total"} to see the breakdown.</p>}
          {st?.checking && <p className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Checking…</p>}
          {p && !p.ok && <p className="flex items-start gap-1 text-red-600"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{p.error}</p>}
          {p && p.ok && <>
            <dl className="grid grid-cols-2 gap-x-3">
              {p.tourismFee > 0 && <><dt className="text-muted-foreground">Tourism Dirham</dt><dd className="text-right">{money(p.tourismFee, c)}</dd></>}
              <dt className="text-muted-foreground">VAT</dt><dd className="text-right">{money(p.vatAmount, c)}</dd>
              <dt className="text-muted-foreground">{p.feeBasis === "net-payout" ? "Channel fees (actual)" : `Channel ${p.channelPercent}%`}</dt><dd className="text-right">{money(p.channelAmount, c)}</dd>
              {p.feeBasis === "net-payout" && <><dt className="text-muted-foreground">Net payout</dt><dd className="text-right">{money(p.grossAmount - p.channelAmount, c)}</dd></>}
              <dt className="text-muted-foreground">Management {p.managementPercent}%{p.feeBasis === "net-payout" ? " of net payout" : ""}</dt><dd className="text-right">{money(p.managementAmount, c)}</dd>
              <dt className="text-muted-foreground">Cleaning{p.cleaningDeducted ? "" : " (not deducted)"}</dt><dd className="text-right">{money(p.cleaningDeducted ? p.cleaningFee : 0, c)}</dd>
              <dt className="font-medium">Owner</dt><dd className="text-right font-medium">{money(p.ownerAmount, c)}</dd>
            </dl>
            {reconciles(p) ? <p className="mt-1 flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Adds up to {money(p.grossAmount, c)}</p>
              : <p className="mt-1 text-red-600">The breakdown does not add up to the guest total. Not saved; please report this booking.</p>}
          </>}
        </div>
        <div className="flex items-center gap-2 lg:flex-col lg:items-end">
          {st?.saved ? <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Saved</span>
            : <Button size="sm" onClick={onSave} disabled={disabled || !canSave}>{st?.saving ? "Saving…" : "Save"}</Button>}
          {st?.error && <p role="alert" className="text-xs text-red-600">{st.error}</p>}
        </div>
      </div>
    </div>
  );
}
