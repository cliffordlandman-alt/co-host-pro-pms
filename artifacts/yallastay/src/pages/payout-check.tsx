import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, FileUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiJson, dubaiTime } from "@/lib/api-json";

// Airbnb payout check: every payout in the imported Airbnb files matched to its YallaPMS booking, with problems
// first. Currencies are never added together; USD transfers are compared only with AED payouts, at the fixed peg.
const money = (n: number | null | undefined, c: string) => n == null ? "–" : `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE: Record<string, { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  mismatch: { label: "Doesn't match", cls: "bg-amber-50 text-amber-900 border-amber-300" },
  no_booking: { label: "No booking", cls: "bg-rose-50 text-rose-800 border-rose-200" },
  upcoming: { label: "Upcoming", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  breakdown_only: { label: "Breakdown only", cls: "bg-slate-50 text-slate-700 border-slate-200" },
  unmatched: { label: "No booking payout", cls: "bg-rose-50 text-rose-800 border-rose-200" },
  date: { label: "Same day, not compared", cls: "bg-slate-50 text-slate-700 border-slate-200" },
};
const Chip = ({ s }: { s: string }) => <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATE[s]?.cls ?? ""}`}>{STATE[s]?.label ?? s}</span>;

type Picked = { name: string; csv: string; preview?: any; error?: string };

function Importer({ imported }: { imported: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  async function pick(list: FileList | null) {
    const out: Picked[] = [];
    for (const f of Array.from(list ?? [])) {
      if (f.size > 5_000_000) { out.push({ name: f.name, csv: "", error: "Larger than 5 MB" }); continue; }
      const csv = await f.text();
      try { out.push({ name: f.name, csv, preview: await apiJson("/api/accounting/payout-check/preview", "POST", { csv, fileName: f.name }) }); }
      catch (e) { out.push({ name: f.name, csv, error: (e as Error).message }); }
    }
    setFiles(out);
  }
  async function save() {
    setBusy(true);
    try {
      for (const f of files.filter(x => x.preview)) await apiJson("/api/accounting/payout-check/import", "POST", { csv: f.csv, fileName: f.name });
      toast({ title: `Imported ${files.filter(x => x.preview).length} file${files.filter(x => x.preview).length === 1 ? "" : "s"}` });
      setFiles([]); qc.invalidateQueries({ queryKey: ["payout-check"] });
    } catch (e) { toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  const ok = files.filter(f => f.preview);
  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3" data-testid="payout-import">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-semibold">Import Airbnb payout files</h2>
          <p className="text-xs text-muted-foreground mt-0.5">The earnings file (cohost_earnings.csv: what Airbnb paid, with its transfers) and the reservation breakdowns (reservation_breakdowns.csv: what each booking should pay). Importing the same file again updates it; nothing is added twice.</p></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        {(["earnings", "breakdown"] as const).map(k => <div key={k} className="rounded-lg border bg-muted/30 p-2"><b>{k === "earnings" ? "Earnings file" : "Reservation breakdowns"}:</b> {imported?.[k]?.lines ? `${imported[k].lines} lines · ${imported[k].files.join(", ")} · imported ${dubaiTime(imported[k].lastImport)}` : "not imported yet"}</div>)}
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm hover:bg-muted/40">
        <FileUp className="h-4 w-4 shrink-0" /><span>Choose one or both CSV files</span>
        <input data-testid="payout-files" type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={e => { pick(e.target.files); e.target.value = ""; }} />
      </label>
      {files.length > 0 && <ul className="space-y-1 text-sm" data-testid="payout-preview">{files.map(f => <li key={f.name} className={f.error ? "text-rose-700" : ""}>
        <b>{f.name}</b>: {f.error ? f.error : `${f.preview.format === "earnings" ? "earnings file" : "reservation breakdowns"} · ${f.preview.bookings} booking payouts${f.preview.transfers ? ` · ${f.preview.transfers} transfers` : ""} · ${f.preview.currencies.join(", ")} · ${f.preview.added} new, ${f.preview.changed} changed, ${f.preview.unchanged} unchanged`}</li>)}</ul>}
      {ok.length > 0 && <Button data-testid="payout-import-save" disabled={busy} onClick={save}>{busy ? "Importing…" : `Import ${ok.length} file${ok.length === 1 ? "" : "s"}`}</Button>}
    </section>
  );
}

function PayoutRow({ r }: { r: any }) {
  return (
    <div data-testid={`payout-${r.code}`} data-state={r.state} className="rounded-xl border bg-card p-3 text-sm space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{r.reservationId ? <Link href={`/reservations/${r.reservationId}`} className="hover:underline">{r.guestName || "Guest"}</Link> : (r.guestName || "Guest")} <span className="font-mono text-xs text-muted-foreground">{r.code}</span></p>
          <p className="text-xs text-muted-foreground">{r.propertyName ?? "Unknown listing"}{r.checkIn ? ` · ${r.checkIn} → ${r.checkOut}` : ""}</p>
        </div>
        <Chip s={r.state} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div><p className="text-muted-foreground">{r.payoutStatus === "upcoming" ? "Airbnb will pay" : "Airbnb paid"}</p><p className="font-semibold tabular-nums">{money(r.paid, r.currency)}</p>{r.payoutDate && <p className="text-muted-foreground">{r.payoutStatus === "upcoming" ? "due" : "on"} {r.payoutDate}</p>}</div>
        <div><p className="text-muted-foreground">Breakdown says</p><p className="tabular-nums">{money(r.breakdown, r.currency)}</p></div>
        <div><p className="text-muted-foreground">Verified booking</p><p className="tabular-nums">{money(r.yalla, r.currency)}</p></div>
        <div><p className="text-muted-foreground">Co-host payout</p><p className="tabular-nums">{money(r.cohostPayout, r.currency)}</p>{r.cohostBasis && <p className="text-muted-foreground">{r.cohostBasis === "paid" ? "paid by Airbnb" : "expected (from the breakdown)"}</p>}</div>
      </div>
      {r.transfer && <p className="text-xs text-muted-foreground">In the transfer of {r.transfer.date}: {money(r.transfer.amount, r.transfer.currency)} to {r.transfer.destination ?? "an unknown account"}{r.transfer.reference ? ` · ref ${r.transfer.reference}` : ""}</p>}
      {r.problems.length > 0 && <ul className="space-y-0.5 text-xs text-amber-900">{r.problems.map((p: string) => <li key={p} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{p}</li>)}</ul>}
      {r.notes.length > 0 && <p className="text-[11px] text-muted-foreground">{r.notes.join(" · ")}</p>}
    </div>
  );
}

export default function PayoutCheckPage() {
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["payout-check"], queryFn: () => apiJson("/api/accounting/payout-check") });
  const [all, setAll] = useState(false);
  const [allT, setAllT] = useState(false);
  const c = data?.counts;
  const problems = data ? data.rows.filter((r: any) => ["no_booking", "mismatch"].includes(r.state)) : [];
  const shown = data ? (all ? data.rows : problems) : [];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header><h1 className="text-2xl font-bold tracking-tight">Airbnb payout check</h1>
        <p className="text-sm text-muted-foreground mt-1">Every Airbnb payout matched to its booking by confirmation code. Payouts with no booking, amounts that don't agree, bookings with no payout and transfers that can't be tied to bookings are listed first. Currencies are never added together.</p></header>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{(error as Error).message}</p> : isLoading || !data ? <Skeleton className="h-64 rounded-2xl" /> : <>
        <Importer imported={data.imported} />
        {data.rows.length === 0 && data.transfers.length === 0 ? <p className="text-sm text-muted-foreground">Nothing imported yet. Import the earnings file to start.</p> : <>
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="payout-summary">
            {[["Matched", c.matched, "text-emerald-700"], ["Don't match", c.mismatch, c.mismatch ? "text-amber-700" : ""], ["No booking in Co-Host Pro", c.noBooking, c.noBooking ? "text-rose-700" : ""], ["Bookings with no payout", c.missing, c.missing ? "text-rose-700" : ""],
              ["Upcoming", c.upcoming, ""], ["Transfers matched", c.transfersMatched, "text-emerald-700"], ["Transfers same day only", c.transfersByDate, ""], ["Transfers with a problem", c.transfersProblem, c.transfersProblem ? "text-rose-700" : ""]].map(([l, n, cls]) =>
              <div key={l as string} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className={`text-xl font-bold tabular-nums ${cls}`}>{n as number}</p></div>)}
          </section>
          <section className="rounded-2xl border bg-card p-4 text-sm space-y-2" data-testid="payout-totals">
            <h2 className="font-semibold">Totals, per currency</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground mb-1">Booking payouts Airbnb paid (by account)</p>{data.totals.paid.map((t: any) => <p key={t.currency + t.destination} className="tabular-nums"><b>{money(t.amount, t.currency)}</b> <span className="text-xs text-muted-foreground">{t.destination ? `→ ${t.destination}` : "no transfer tied"}</span></p>)}</div>
              <div><p className="text-xs text-muted-foreground mb-1">Transfers received (by account)</p>{data.totals.transfers.length ? data.totals.transfers.map((t: any) => <p key={t.currency + t.destination} className="tabular-nums"><b>{money(t.amount, t.currency)}</b> <span className="text-xs text-muted-foreground">→ {t.destination}</span></p>) : <p className="text-muted-foreground">None in the files</p>}</div>
              <div><p className="text-xs text-muted-foreground mb-1">Upcoming</p>{data.totals.upcoming.length ? data.totals.upcoming.map((t: any) => <p key={t.currency} className="tabular-nums"><b>{money(t.amount, t.currency)}</b></p>) : <p className="text-muted-foreground">None</p>}</div>
            </div>
            <p className="text-xs text-muted-foreground flex gap-1"><Info className="h-3.5 w-3.5 shrink-0 mt-px" />Airbnb converts AED and ZAR payouts to the payout account's currency (USD for PayPal). A USD transfer is checked against AED payouts at the fixed peg of 3.6725; ZAR has no fixed rate, so a transfer carrying ZAR is tied to its bookings by date only.</p>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-lg">Booking payouts</h2>
              <div className="flex gap-1"><Button size="sm" variant={all ? "outline" : "default"} onClick={() => setAll(false)}>Problems ({problems.length})</Button><Button size="sm" variant={all ? "default" : "outline"} data-testid="payout-show-all" onClick={() => setAll(true)}>All ({data.rows.length})</Button></div></div>
            {shown.length ? shown.map((r: any) => <PayoutRow key={r.code} r={r} />) : <p className="text-sm text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />No problems: every payout matches its booking.</p>}
          </section>

          {data.missing.length > 0 && <section className="space-y-2" data-testid="payout-missing"><h2 className="font-semibold text-lg">Airbnb bookings with no payout in the file</h2>
            <p className="text-xs text-muted-foreground">Bookings in Co-Host Pro that checked in between {data.window.from} and {data.window.to} at a listing the file covers, with no payout line.</p>
            {data.missing.map((m: any) => <div key={m.reservationId} className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-sm">
              <span className="min-w-0"><Link href={`/reservations/${m.reservationId}`} className="font-medium hover:underline">{m.guestName}</Link> <span className="text-xs text-muted-foreground">{m.propertyName} · {m.checkIn} → {m.checkOut}{m.code ? ` · ${m.code}` : " · no confirmation code"}</span></span>
              <Clock className="h-4 w-4 text-rose-700 shrink-0" /></div>)}
          </section>}

          <section className="space-y-2" data-testid="payout-transfers"><h2 className="font-semibold text-lg">Transfers</h2>
            {data.transfers.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{c.transfersMatched} tied by amount, {c.transfersByDate} by date only, {c.transfersProblem} with a problem.</span>
              <Button size="sm" variant="outline" data-testid="transfers-toggle" onClick={() => setAllT(v => !v)}>{allT ? "Problems only" : `Show all ${data.transfers.length}`}</Button></div>}
            {data.transfers.length ? data.transfers.filter((t: any) => allT || ["unmatched", "mismatch"].includes(t.state)).map((t: any) => <div key={t.id} data-testid="payout-transfer" data-state={t.state} className="rounded-xl border bg-card p-3 text-sm space-y-1">
              <div className="flex items-start justify-between gap-2"><p className="min-w-0"><b className="tabular-nums">{money(t.amount, t.currency)}</b> on {t.date} <span className="text-xs text-muted-foreground">→ {t.destination ?? "unknown account"}{t.reference ? ` · ref ${t.reference}` : ""}</span></p><Chip s={t.state} /></div>
              <p className="text-xs text-muted-foreground">{t.check}{t.codes.length ? ` · ${t.codes.join(", ")}` : ""}</p></div>) : <p className="text-sm text-muted-foreground">No transfers in the imported files.</p>}
          </section>
        </>}
      </>}
    </div>
  );
}
