import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, Upload } from "lucide-react";

// Import Airbnb reservation breakdowns (the figures from each reservation's details page).
// The server matches rows by confirmation code; a stay that isn't in the app yet is linked to the same stay from the
// calendar feed, or created on the property named like the listing (or the one chosen here). Nothing changes until
// rows are ticked and applied; the server re-checks every row and saves it like a normal booking edit (Activity
// Log, month lock, overlap check). Blank values stay blank, never 0. Re-running the same file changes nothing.
// For a property calculated from Airbnb's payout, the host figures are used (gross earnings, host fee, payout);
// otherwise the guest-paid total. Payout dates, the account and a USD transfer's own amount are kept as payout info.

type Row = any;
const fmt = (v: number | string | null | undefined, c: string) => v == null || v === "" ? "blank" : `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;
const ACTION: Record<string, string> = { update: "Update booking", link: "Link calendar stay", create: "Create booking", none: "Up to date" };

export function AirbnbBreakdownImport() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const [data, setData] = useState<{ rows: Row[]; summary: any; properties: { id: number; name: string; currency: string | null }[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [cohost, setCohost] = useState<Record<string, string>>({});
  const [propertyFor, setPropertyFor] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; action: string; message: string }>>({});
  const [counts, setCounts] = useState<any>(null);
  const [csvText, setCsvText] = useState("");

  async function preview(text: string, chosen = propertyFor, keepResult = false) {
    setBusy(true); setError(""); if (!keepResult) { setResult({}); setCounts(null); } setTicked({});
    try {
      const r = await apiFetch("/api/reservations/airbnb-breakdowns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: text, propertyFor: chosen }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not read the file");
      setData(d);
    } catch (e) { setData(null); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onFile(f?: File) { if (!f) return; setFile(f.name); setPropertyFor({}); const t = await f.text(); setCsvText(t); await preview(t, {}); }

  // A co-host amount is asked for only where the booking gets verified figures (a stay added unverified waits anyway).
  const needsAmount = (r: Row) => r.basis !== "airbnb-payout" && r.verify && r.cohost?.mentioned && r.cohost.amount == null;
  const cohostInput = (r: Row) => cohost[r.code] ?? r.cohost?.suggested ?? "";   // pre-filled from other fees when there is exactly one amount
  const canTick = (r: Row) => !r.needsProperty && r.action !== "none" && !r.blocking.length && !result[r.code]?.ok && (!needsAmount(r) || amountOk(cohostInput(r)));
  const rows: Row[] = data?.rows ?? [];
  const listed = rows.filter(r => !r.needsProperty), homeless = rows.filter(r => r.needsProperty);
  const listings = [...new Set(homeless.map(r => r.listing || "").filter(Boolean))] as string[];
  const clean = listed.filter(r => r.bulkOk && canTick(r));
  const chosen = listed.filter(r => ticked[r.code] && canTick(r));

  async function apply() {
    setBusy(true); setError("");
    try {
      const res = await apiFetch("/api/reservations/airbnb-breakdowns/apply", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, fileName: file, codes: chosen.map(r => r.code), propertyFor, cohost: Object.fromEntries(chosen.filter(needsAmount).map(r => [r.code, cohostInput(r).trim()])) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Not applied");
      setResult(s => ({ ...s, ...d.results })); setCounts(d);
    } catch (e) { setError((e as Error).message); }
    setTicked({}); setBusy(false);
    await qc.invalidateQueries();
  }

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Upload className="mr-1 h-4 w-4" />Import Airbnb breakdowns</Button>;
  const s = data?.summary;
  return (
    <section className="space-y-3 rounded-lg border p-3 sm:p-4" aria-label="Import Airbnb breakdowns">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Import Airbnb breakdowns</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">A CSV with one row per reservation from Airbnb's reservation details (confirmation code, listing, dates, accommodation, cleaning fee, host service fee, host payout, payout dates…). Rows are matched by confirmation code; a stay that isn't in the app yet is linked to the same stay from the calendar feed, or created on the property named like the listing. Nothing changes until you tick rows and apply them. Blank values stay blank, never 0, and a stay with missing figures is added as "not verified". Re-running the same file changes nothing.</p>
        </div>
        <button className="text-xs underline" onClick={() => { setOpen(false); setData(null); setFile(""); setCounts(null); }}>Close</button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Breakdowns CSV</span>
        <input aria-label="Breakdowns CSV" type="file" accept=".csv,text/csv" className="max-w-full text-sm" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        {file && <span className="text-xs text-muted-foreground">{file}</span>}
      </label>
      {busy && <p className="text-sm text-muted-foreground">Working…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {data && s && <>
        <p className="text-sm" role="status" data-testid="breakdown-summary">{s.rows} rows · {s.matched} matched · {s.toLink} to link · {s.toCreate} to create · {s.upToDate} up to date · <b>{s.clean} clean</b> · {s.review} to review · {s.blocked} can't be applied{s.needsProperty ? ` · ${s.needsProperty} need a property` : ""}</p>
        {counts && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" data-testid="breakdown-result">Applied: {counts.created} created · {counts.linked} linked · {counts.updated} updated · {counts.unchanged} already up to date{counts.failed ? ` · ${counts.failed} not saved (see the rows)` : ""}</p>}
        {listings.length > 0 && <div className="space-y-2 rounded border border-amber-300 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
          <p className="font-medium">Choose the property for listings that don't match a property name</p>
          {listings.map(l => <label key={l} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{l} <span className="text-muted-foreground">({homeless.filter(r => r.listing === l).length} rows)</span></span>
            <select aria-label={`Property for ${l}`} className="h-8 max-w-full rounded border bg-background px-2" value={propertyFor[l] ?? ""} disabled={busy}
              onChange={e => { const next = { ...propertyFor, [l]: e.target.value }; setPropertyFor(next); preview(csvText, next); }}>
              <option value="">Choose…</option>
              {data.properties.map(p => <option key={p.id} value={p.id}>{p.name}{p.currency ? ` (${p.currency})` : ""}</option>)}
            </select></label>)}
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!clean.length || busy} onClick={() => setTicked(t => ({ ...t, ...Object.fromEntries(clean.map(r => [r.code, true])) }))}>Tick all clean rows ({clean.length})</Button>
          <Button size="sm" disabled={!chosen.length || busy} onClick={apply}>Apply ticked ({chosen.length})</Button>
          {Object.keys(result).length > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => preview(csvText, propertyFor, true)}>Refresh preview</Button>}
        </div>
        <div className="space-y-2">
          {listed.map(r => <BreakdownRow key={r.code || r.line} r={r} ticked={!!ticked[r.code]} canTick={canTick(r)} onTick={v => setTicked(t => ({ ...t, [r.code]: v }))}
            cohostInput={cohostInput(r)} setCohostInput={v => setCohost(x => ({ ...x, [r.code]: v }))} needsAmount={needsAmount(r)} result={result[r.code]} />)}
        </div>
        {homeless.length > 0 && <div className="rounded border border-dashed p-2 text-xs">
          <p className="font-medium">Waiting for a property ({homeless.length})</p>
          <ul className="mt-1 space-y-0.5">{homeless.map(r => <li key={`${r.line}-${r.code}`} className="break-words">Line {r.line}: {r.code || "no code"} · {r.listing || "no listing"} · {r.checkIn} → {r.checkOut}</li>)}</ul>
        </div>}
      </>}
    </section>
  );
}

function BreakdownRow({ r, ticked, canTick, onTick, cohostInput, setCohostInput, needsAmount, result }: { r: Row; ticked: boolean; canTick: boolean; onTick: (v: boolean) => void; cohostInput: string; setCohostInput: (v: string) => void; needsAmount: boolean; result?: { ok: boolean; message: string } }) {
  const c = r.currencyExpected || r.currency;
  const fees = r.guestServiceFee != null && r.hostServiceFee != null ? Number(r.guestServiceFee) + Number(r.hostServiceFee) : null;
  const payoutDiffers = r.payoutCheck === "differs", rounding = r.payoutCheck === "rounding";
  const hostBasis = r.basis === "airbnb-payout";
  return (
    <div data-testid={`breakdown-${r.code}`} className={`rounded border p-2 text-xs ${result?.ok || r.action === "none" ? "opacity-70" : ""} ${r.blocking.length ? "bg-muted/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <input type="checkbox" aria-label={`Apply ${r.code}`} className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4" checked={ticked && canTick} disabled={!canTick} onChange={e => onTick(e.target.checked)} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words text-sm"><b>{r.bookingGuest}</b> · {r.propertyName} · {r.bookingCheckIn} → {r.bookingCheckOut} <span className="text-muted-foreground">({r.code})</span>
            <span data-testid="breakdown-action" className={`ml-1 rounded px-1 ${r.action === "create" ? "bg-sky-100 text-sky-900" : r.action === "link" ? "bg-violet-100 text-violet-900" : r.action === "none" ? "bg-emerald-100 text-emerald-900" : "bg-muted"}`}>{ACTION[r.action] ?? r.action}</span>
            {!r.verify && r.action !== "none" && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">not verified</span>}</p>
          {hostBasis ? <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-4">
            <p>Gross earnings: <b>{fmt(r.hostGross, c)}</b> <span className="text-muted-foreground">accommodation {fmt(r.accommodationTotal, c)} + cleaning {fmt(r.cleaningFee, c)}</span></p>
            <p>Host service fee: <b>{r.hostServiceFee != null ? fmt(r.hostServiceFee, c) : "not in the file"}</b></p>
            <p className={payoutDiffers ? "font-medium text-red-700" : ""}>Payout from Airbnb: <b>{fmt(r.hostPayout, r.currency || c)}</b>{r.current?.airbnbPayout != null && <span className="text-muted-foreground"> now {fmt(r.current.airbnbPayout, c)}</span>}{rounding && <span data-testid="rounding" className="ml-1 rounded bg-muted px-1">rounding difference</span>}</p>
            <p>Guest paid total: {r.guestTotal != null ? fmt(r.guestTotal, c) : <span className="text-muted-foreground">not in the file</span>}</p>
          </div> : <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-4">
            <p>Guest total: <b>{fmt(r.guestTotal, c)}</b> <span className="text-muted-foreground">now {r.current ? (r.current.verified ? fmt(r.current.grossAmount, c) : "not verified") : "new"}</span></p>
            <p>Cleaning fee: <b>{r.cleaningFee != null ? fmt(r.cleaningFee, c) : "blank in file"}</b> <span className="text-muted-foreground">now {r.current?.cleaningFee != null ? fmt(r.current.cleaningFee, c) : "not set"}</span></p>
            <p className={payoutDiffers ? "font-medium text-red-700" : ""}>{r.cohostLineOnly ? "Co-host payout line" : "Airbnb payout"}: {fmt(r.hostPayout, r.currency || c)} <span className={payoutDiffers ? "" : "text-muted-foreground"}>stored {r.storedPayout != null ? fmt(r.storedPayout, r.storedPayoutCurrency || c) : "none"}</span>{rounding && <span data-testid="rounding" className="ml-1 rounded bg-muted px-1">rounding difference</span>}</p>
            {r.cohost?.mentioned && <p className={r.cohost.source === "column" ? "" : "text-amber-800"}>Co-host payout: {r.cohost.amount != null ? <b>{fmt(r.cohost.amount, c)}</b> : <span>amount not in the file</span>} {r.cohost.source === "column" && <span data-testid="cohost-verified" className="rounded bg-emerald-100 px-1 text-emerald-900">verified column</span>}{r.cohost.source === "notes" && <span className="text-muted-foreground">(from notes)</span>}</p>}
          </div>}
          {r.payoutParts?.length > 0 && <ul data-testid="payout-parts" className="space-y-0.5 text-muted-foreground">{r.payoutParts.map((p: any) => <li key={p.part}>Paid {p.paidOn ?? "date not in the file"}{p.amount != null ? ` · ${fmt(p.amount, p.currency || c)}` : ""}{p.paidTo ? ` · to ${p.paidTo}` : ""}{p.sentAmount != null ? ` · sent as ${p.sentCurrency} ${Number(p.sentAmount).toFixed(2)} (payout info only, not added to ${c})` : ""}</li>)}</ul>}
          {needsAmount && !result?.ok && <label className="flex flex-wrap items-center gap-2">Co-host payout amount from Airbnb ({c})<Input aria-label={`Co-host payout ${r.code}`} className="h-8 w-32" inputMode="decimal" value={cohostInput} onChange={e => setCohostInput(e.target.value)} placeholder="e.g. 1776.81" />
            {r.cohost?.suggested != null && cohostInput === r.cohost.suggested && <span data-testid="cohost-suggested" className="rounded bg-amber-100 px-1 text-amber-900">from other fees, check</span>}
            {r.otherFees && <span className="text-muted-foreground">Other fees on Airbnb: {r.otherFees}</span>}</label>}
          {r.preview && r.preview.feeBasis === "airbnb-payout" && <p className="text-muted-foreground">Calculated: Airbnb fees (gross − payout) {fmt(r.preview.channelAmount, c)} · management {r.preview.managementPercent}% of the payout {fmt(r.preview.managementAmount, c)} · cleaning cost {fmt(r.preview.cleaningDeducted ? r.preview.cleaningFee : 0, c)} · owner {fmt(r.preview.ownerAmount, c)}</p>}
          {r.preview && r.preview.feeBasis === "net-payout" && <p className="text-muted-foreground">Calculated: Airbnb fees (actual) {fmt(r.preview.channelAmount, c)} · net payout {fmt(Number(r.guestTotal) - Number(r.preview.channelAmount), c)} · management {r.preview.managementPercent}% of net payout {fmt(r.preview.managementAmount, c)} · owner {fmt(r.preview.ownerAmount, c)}</p>}
          {r.preview && r.preview.feeBasis === "gross" && <p className="text-muted-foreground">Calculated: owner {fmt(r.preview.ownerAmount, c)} · management {r.preview.managementPercent}% {fmt(r.preview.managementAmount, c)} · channel {r.preview.channelPercent}% {fmt(r.preview.channelAmount, c)}{r.preview.vatAmount ? ` · VAT ${fmt(r.preview.vatAmount, c)}` : ""}{r.preview.tourismFee ? ` · Tourism Dirham ${fmt(r.preview.tourismFee, c)}` : ""}
            {fees != null && Number(r.guestTotal) > 0 && <> · Airbnb's own fees in the file: {fmt(fees, c)} ({(fees / Number(r.guestTotal) * 100).toFixed(1)}% of the guest total)</>}</p>}
          {r.blocking.map((m: string) => <p key={m} className="flex items-start gap-1 text-red-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{m}</p>)}
          {r.review.map((m: string) => <p key={m} className="text-amber-800">Review: {m}</p>)}
          {r.notes.map((m: string) => <p key={m} className="text-muted-foreground">{m}</p>)}
          {result && <p role="status" className={result.ok ? "flex items-center gap-1 text-emerald-700" : "text-red-700"}>{result.ok && <CheckCircle2 className="h-3 w-3" />}{result.message}</p>}
        </div>
      </div>
    </div>
  );
}
