import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, Upload } from "lucide-react";

// Import Airbnb reservation breakdowns (guest-paid figures from each reservation's details page).
// The server matches rows by confirmation code and previews them (read-only). Only ticked rows are applied,
// each through the normal booking edit (PATCH /reservations/:id), so the Activity Log and the month lock
// apply. Blank values stay blank. A co-host payout is recorded as "needs decision" and deducted nowhere.

type Row = any;
const fmt = (v: number | string | null | undefined, c: string) => v == null || v === "" ? "blank" : `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;

export function AirbnbBreakdownImport() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const [data, setData] = useState<{ rows: Row[]; summary: any } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [cohost, setCohost] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [csvText, setCsvText] = useState("");

  async function preview(text: string) {
    setBusy(true); setError(""); setResult({}); setTicked({});
    try {
      const r = await apiFetch("/api/reservations/airbnb-breakdowns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not read the file");
      setData(d);
    } catch (e) { setData(null); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onFile(f?: File) { if (!f) return; setFile(f.name); const t = await f.text(); setCsvText(t); await preview(t); }

  const needsAmount = (r: Row) => r.cohost?.mentioned && r.cohost.amount == null;
  const cohostValue = (r: Row) => r.cohost?.amount ?? (cohost[r.code] ?? "").trim();
  const canTick = (r: Row) => r.matched && !r.blocking.length && !result[r.code]?.ok && (!needsAmount(r) || amountOk(cohost[r.code] ?? ""));
  const rows: Row[] = data?.rows ?? [];
  const matched = rows.filter(r => r.matched), unmatched = rows.filter(r => !r.matched);
  const clean = matched.filter(r => r.bulkOk && canTick(r));
  const chosen = matched.filter(r => ticked[r.code] && canTick(r));

  async function apply() {
    setBusy(true);
    for (const r of chosen) {
      const body: any = { grossAmount: r.guestTotal, financeMode: "inclusive-v1" };
      if (r.cleaningFee != null) body.cleaningFee = r.cleaningFee;           // blank in the file: keep what the booking has
      const c = cohostValue(r); if (c) body.cohostPayout = c;
      try {
        const res = await apiFetch(`/api/reservations/${r.reservationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await res.json().catch(() => ({}));
        setResult(s => ({ ...s, [r.code]: res.ok ? { ok: true, message: "Saved" } : { ok: false, message: d.error || "Not saved" } }));
      } catch (e) { setResult(s => ({ ...s, [r.code]: { ok: false, message: (e as Error).message } })); }
    }
    setTicked({}); setBusy(false);
    await qc.invalidateQueries();
  }

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Upload className="mr-1 h-4 w-4" />Import Airbnb breakdowns</Button>;
  const saved = Object.values(result).filter(x => x.ok).length;
  return (
    <section className="space-y-3 rounded-lg border p-3 sm:p-4" aria-label="Import Airbnb breakdowns">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Import Airbnb breakdowns</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">A CSV with one row per reservation from Airbnb's reservation details (guest_paid_total, cleaning_fee, host_payout, notes…). Rows are matched by confirmation code. Nothing changes until you tick rows and apply them; each is saved like a normal booking edit. Blank values are left blank, never 0. Co-host payouts are recorded as "needs decision" and not deducted anywhere.</p>
        </div>
        <button className="text-xs underline" onClick={() => { setOpen(false); setData(null); setFile(""); }}>Close</button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Breakdowns CSV</span>
        <input aria-label="Breakdowns CSV" type="file" accept=".csv,text/csv" className="max-w-full text-sm" onChange={e => onFile(e.target.files?.[0])} />
        {file && <span className="text-xs text-muted-foreground">{file}</span>}
      </label>
      {busy && <p className="text-sm text-muted-foreground">Working…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {data && <>
        <p className="text-sm" role="status">{data.summary.rows} rows · {data.summary.matched} matched · <b>{data.summary.clean} clean</b> · {data.summary.review} to review one by one · {data.summary.blocked} can't be applied · {data.summary.unmatched} not matched{saved ? ` · ${saved} saved` : ""}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!clean.length || busy} onClick={() => setTicked(t => ({ ...t, ...Object.fromEntries(clean.map(r => [r.code, true])) }))}>Tick all clean rows ({clean.length})</Button>
          <Button size="sm" disabled={!chosen.length || busy} onClick={apply}>Apply ticked ({chosen.length})</Button>
          {saved > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => preview(csvText)}>Refresh preview</Button>}
        </div>
        <div className="space-y-2">
          {matched.map(r => <BreakdownRow key={r.code} r={r} ticked={!!ticked[r.code]} canTick={canTick(r)} onTick={v => setTicked(t => ({ ...t, [r.code]: v }))}
            cohostInput={cohost[r.code] ?? ""} setCohostInput={v => setCohost(s => ({ ...s, [r.code]: v }))} needsAmount={needsAmount(r)} result={result[r.code]} />)}
        </div>
        {unmatched.length > 0 && <div className="rounded border border-dashed p-2 text-xs">
          <p className="font-medium">Not matched to any booking ({unmatched.length})</p>
          <ul className="mt-1 space-y-0.5">{unmatched.map(r => <li key={`${r.line}-${r.code}`}>Line {r.line}: {r.code || "no code"} · {r.listing || ""} {r.checkIn} → {r.checkOut} · {r.blocking.join("; ")}</li>)}</ul>
        </div>}
      </>}
    </section>
  );
}

function BreakdownRow({ r, ticked, canTick, onTick, cohostInput, setCohostInput, needsAmount, result }: { r: Row; ticked: boolean; canTick: boolean; onTick: (v: boolean) => void; cohostInput: string; setCohostInput: (v: string) => void; needsAmount: boolean; result?: { ok: boolean; message: string } }) {
  const c = r.currencyExpected || r.currency;
  const fees = r.guestServiceFee != null && r.hostServiceFee != null ? Number(r.guestServiceFee) + Number(r.hostServiceFee) : null;
  const payoutDiffers = r.storedPayout != null && r.hostPayout != null && Number(r.storedPayout).toFixed(2) !== Number(r.hostPayout).toFixed(2);
  return (
    <div data-testid={`breakdown-${r.code}`} className={`rounded border p-2 text-xs ${result?.ok ? "opacity-60" : ""} ${r.blocking.length ? "bg-muted/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <input type="checkbox" aria-label={`Apply ${r.code}`} className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4" checked={ticked && canTick} disabled={!canTick} onChange={e => onTick(e.target.checked)} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm"><b>{r.bookingGuest}</b> · {r.propertyName} · {r.bookingCheckIn} → {r.bookingCheckOut} <span className="text-muted-foreground">({r.code})</span></p>
          <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-4">
            <p>Guest total: <b>{fmt(r.guestTotal, c)}</b> <span className="text-muted-foreground">now {r.current?.verified ? fmt(r.current.grossAmount, c) : "not verified"}</span></p>
            <p>Cleaning fee: <b>{r.cleaningFee != null ? fmt(r.cleaningFee, c) : "blank in file"}</b> <span className="text-muted-foreground">now {r.current?.cleaningFee != null ? fmt(r.current.cleaningFee, c) : "not set"}</span></p>
            <p className={payoutDiffers ? "font-medium text-red-700" : ""}>Airbnb payout: {fmt(r.hostPayout, r.currency || c)} <span className={payoutDiffers ? "" : "text-muted-foreground"}>stored {r.storedPayout != null ? fmt(r.storedPayout, r.storedPayoutCurrency || c) : "none"}</span></p>
            {r.cohost?.mentioned && <p className="text-amber-800">Co-host payout (needs decision): {r.cohost.amount != null ? <b>{fmt(r.cohost.amount, c)}</b> : <span>amount not in notes</span>}</p>}
          </div>
          {needsAmount && !result?.ok && <label className="flex flex-wrap items-center gap-2">Co-host payout amount from Airbnb ({c})<Input aria-label={`Co-host payout ${r.code}`} className="h-8 w-32" inputMode="decimal" value={cohostInput} onChange={e => setCohostInput(e.target.value)} placeholder="e.g. 1776.81" />
            {r.otherFees && <span className="text-muted-foreground">Other fees on Airbnb: {r.otherFees}</span>}</label>}
          {r.preview && <p className="text-muted-foreground">Calculated: owner {fmt(r.preview.ownerAmount, c)} · management {r.preview.managementPercent}% {fmt(r.preview.managementAmount, c)} · channel {r.preview.channelPercent}% {fmt(r.preview.channelAmount, c)}{r.preview.vatAmount ? ` · VAT ${fmt(r.preview.vatAmount, c)}` : ""}{r.preview.tourismFee ? ` · Tourism Dirham ${fmt(r.preview.tourismFee, c)}` : ""}
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
