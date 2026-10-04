import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProperties } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentName } from "@/lib/use-brand";
import { ChevronDown, ChevronUp, FileText, Printer, RefreshCw } from "lucide-react";

// Statement history: every month with stays for one property, from the same owner-statement calculation as the
// monthly statements (a sent or paid month shows the statement as stored). Totals per year and overall, per
// currency; amounts in different currencies are never added together. A payout Airbnb sent in another currency
// (e.g. USD to PayPal) is listed on its own, for reference only. Read-only, except "Generate monthly statements",
// which saves draft statements for the past months (sent and paid months are left as they are).

type Fig = { currency: string; months?: number; bookings: number; nights: number; gross: number; channel: number; management: number; cleaning: number; expenses: number; taxes: number; paidByAirbnb: number; balance: number; ownerShare: number };
type History = {
  property: { id: number; name: string; currency: string | null }; owner: { id: number; name: string; email: string | null } | null;
  settings: { feeBasis: string; payoutToOwner: boolean; managementFeePercent: number | null; includeCleaning: boolean };
  months: { month: string; statement: { id?: number; status: string } | null; held: string | null; figures: Fig | null; stays: any[] }[];
  years: (Fig & { year: string })[]; totals: Fig[]; held: number; sentInOtherCurrency: { currency: string; amount: number; transfers: number }[];
};
const money = (v: number | null | undefined, c: string) => v == null ? "–" : `${c} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function json(r: Response) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }

function labels(h: History) {
  const payout = h.settings.feeBasis === "airbnb-payout";
  return { gross: payout ? "Airbnb gross earnings" : "Gross", channel: payout ? "Airbnb fees" : "Channel fees", fee: "Management fee", share: "Owner share", paid: h.settings.payoutToOwner ? "Paid by Airbnb (whole payout)" : "Paid by Airbnb", balance: "Balance" };
}
function basisText(h: History) {
  const pct = h.settings.managementFeePercent ?? 0;
  if (h.settings.feeBasis === "airbnb-payout") return `Fee ${pct}% of Airbnb's payout${h.settings.payoutToOwner ? "; Airbnb pays the whole payout directly to the owner" : ""}${h.settings.includeCleaning ? "" : "; no cleaning cost deducted"}`;
  if (h.settings.feeBasis === "net-payout") return `Fee ${pct}% of the channel net payout`;
  return `Fee ${pct}% of guest revenue`;
}

/** Clean printable page (no app menus); "Save as PDF" in the print dialog makes the file. Nothing is sent. */
function printHistory(h: History, company: string) {
  const L = labels(h);
  const row = (name: string, f: Fig) => `<tr><td>${esc(name)}</td><td class="r">${f.bookings}</td><td class="r">${esc(money(f.gross, f.currency))}</td><td class="r">${esc(money(f.channel, f.currency))}</td><td class="r">${esc(money(f.management, f.currency))}</td><td class="r">${esc(money(f.ownerShare, f.currency))}</td><td class="r">${esc(money(f.paidByAirbnb, f.currency))}</td><td class="r">${esc(money(f.balance, f.currency))}</td></tr>`;
  const head = `<tr><th></th><th class="r">Stays</th><th class="r">${L.gross}</th><th class="r">${L.channel}</th><th class="r">${L.fee}</th><th class="r">${L.share}</th><th class="r">${L.paid}</th><th class="r">${L.balance}</th></tr>`;
  const stays = h.months.flatMap(m => m.stays.map(s => `<tr><td>${esc(s.code ?? "")}</td><td>${esc(s.checkIn)} → ${esc(s.checkOut)}</td><td class="r">${esc(money(s.grossAmount != null ? Number(s.grossAmount) : null, h.property.currency || "AED"))}</td><td class="r">${esc(money(s.ownerAmount != null ? Number(s.ownerAmount) : null, h.property.currency || "AED"))}</td><td>${(s.payouts ?? []).map((p: any) => `${esc(p.paidOn ?? "")}${p.paidTo ? ` · ${esc(p.paidTo)}` : ""}${p.sentAmount != null ? ` · sent as ${esc(p.sentCurrency)} ${esc(Number(p.sentAmount).toFixed(2))}` : ""}`).join("<br>")}</td></tr>`)).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement history · ${esc(h.property.name)}</title><style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:32px;font-size:12px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:20px 0 6px}.muted{color:#4b5563}table{width:100%;border-collapse:collapse}td,th{padding:5px 4px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}.r{text-align:right;white-space:nowrap}tr.total td{font-weight:700;border-top:2px solid #111827}@media print{body{margin:12mm}}@media screen and (max-width:640px){body{margin:12px}table{display:block;overflow-x:auto}}</style></head><body>
<h1>Statement history</h1><div class="muted">${esc(company)}</div><p><strong>${esc(h.property.name)}</strong><br>Owner: ${esc(h.owner?.name ?? "—")}<br><span class="muted">${esc(basisText(h))}</span></p>
<h2>By year</h2><table>${head}${h.years.map(y => row(`${y.year}${h.totals.length > 1 ? ` (${y.currency})` : ""}`, y)).join("")}${h.totals.map(t => `<tbody class="total">${row(`Total ${t.currency}`, t).replace("<tr>", '<tr class="total">')}</tbody>`).join("")}</table>
${h.sentInOtherCurrency.map(s => `<p class="muted">Airbnb sent ${s.transfers} payout${s.transfers === 1 ? "" : "s"} as ${esc(s.currency)} ${esc(s.amount.toFixed(2))} in total (PayPal). Reference only: not added to the totals above.</p>`).join("")}
<h2>Stays (by checkout month)</h2><table><tr><th>Code</th><th>Dates</th><th class="r">${L.gross}</th><th class="r">Owner</th><th>Paid by Airbnb</th></tr>${stays}</table></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { window.alert("Allow pop-ups for this site to print or save the history as PDF."); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

export default function OwnerHistoryPage() {
  const documentName = useDocumentName();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const propertyId = new URLSearchParams(useSearch()).get("propertyId") ?? "";
  const { data: properties } = useGetProperties();
  const { data: h, isLoading, error } = useQuery<History>({ queryKey: ["owner-history", propertyId], enabled: !!propertyId, queryFn: async () => json(await apiFetch(`/api/accounting/owner-history?propertyId=${propertyId}`)) });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function generate() {
    setBusy(true); setResult(null);
    try {
      const r = await json(await apiFetch("/api/accounting/owner-history/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: Number(propertyId) }) }));
      setResult({ ok: !r.skipped.length, text: `${r.generated} monthly draft statement${r.generated === 1 ? "" : "s"} saved for ${r.months} month${r.months === 1 ? "" : "s"}${r.locked ? `; ${r.locked} already sent or paid, left as they are` : ""}${r.skipped.length ? `; ${r.skipped.length} not generated: ${r.skipped.map((s: any) => `${s.month} (${s.reason})`).join(", ")}` : ""}.` });
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
    setBusy(false);
    await qc.invalidateQueries();
  }
  const L = h ? labels(h) : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Statement history</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">Every month with stays for one property, from the same calculation as the monthly owner statements. Totals per year, in the property's currency; amounts in other currencies are never added in.</p>
        </div>
        <Link href="/accounting" className="text-sm underline">Owner statements</Link>
      </div>
      <label className="block text-sm">Property
        <select aria-label="Property" className="mt-1 block h-9 w-full max-w-md rounded-md border bg-background px-2 text-sm" value={propertyId} onChange={e => { setResult(null); setLocation(`/owner-history${e.target.value ? `?propertyId=${e.target.value}` : ""}`); }}>
          <option value="">Choose a property…</option>
          {((properties as any[]) || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {!propertyId && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Choose a property to see its full statement history.</p>}
      {propertyId && isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
      {error && <p role="alert" className="text-sm text-red-600">{(error as Error).message}</p>}
      {h && L && <>
        <section className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3" data-testid="history-summary">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold break-words">{h.property.name}</h2>
              <p className="text-sm text-muted-foreground">Owner: {h.owner ? <Link href="/owners" className="underline">{h.owner.name}</Link> : "not linked"} · {basisText(h)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => printHistory(h, documentName)} disabled={!h.months.length}><Printer className="mr-1 h-4 w-4" />Print / Save PDF</Button>
              <Button size="sm" onClick={generate} disabled={busy || !h.owner || !h.months.length}><RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Generating…" : "Generate monthly statements"}</Button>
            </div>
          </div>
          {!h.owner && <p className="text-xs text-amber-800">Link an owner to this property (Owners) before monthly statements can be generated.</p>}
          {result && <p role="status" className={`rounded p-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}>{result.text}</p>}
          {h.held > 0 && <p className="text-xs text-amber-800">{h.held} month{h.held === 1 ? "" : "s"} can't be calculated yet (see below) and {h.held === 1 ? "is" : "are"} not in the totals.</p>}
          {!h.months.length && <p className="text-sm text-muted-foreground">No stays recorded for this property yet.</p>}
          {h.totals.map(t => <div key={t.currency} data-testid={`history-total-${t.currency}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Stays" value={`${t.bookings} · ${t.nights} nights`} />
            <Figure label={L.gross} value={money(t.gross, t.currency)} />
            <Figure label={L.fee} value={money(t.management, t.currency)} />
            <Figure label={L.share} value={money(t.ownerShare, t.currency)} strong />
            <Figure label={L.paid} value={money(t.paidByAirbnb, t.currency)} />
            <Figure label={L.balance} value={money(t.balance, t.currency)} strong />
          </div>)}
          {h.sentInOtherCurrency.map(s => <p key={s.currency} data-testid="sent-other-currency" className="rounded bg-muted/60 px-3 py-2 text-xs">Airbnb sent {s.transfers} payout{s.transfers === 1 ? "" : "s"} as <b>{money(s.amount, s.currency)}</b> in total (PayPal). Reference only: this is how those payouts were transferred, not added to the {h.totals.map(t => t.currency).join("/")} totals.</p>)}
        </section>
        {h.years.length > 0 && <section className="space-y-2" aria-label="By year">
          <h2 className="font-semibold">By year</h2>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/40 text-xs text-muted-foreground">{["Year", "Stays", L.gross, L.channel, L.fee, "Costs", L.share, L.paid, L.balance].map(x => <th key={x} className="p-2 text-right first:text-left">{x}</th>)}</tr></thead>
              <tbody>{[...h.years.map(y => ({ ...y, name: `${y.year}${h.totals.length > 1 ? ` · ${y.currency}` : ""}`, total: false })), ...h.totals.map(t => ({ ...t, name: `Total ${t.currency}`, total: true }))].map(y => <tr key={y.name} data-testid={y.total ? undefined : `history-year-${y.name}`} className={`border-t ${y.total ? "font-semibold" : ""}`}>
                <td className="p-2">{y.name}</td><td className="p-2 text-right">{y.bookings}</td>{[y.gross, y.channel, y.management, y.cleaning + y.expenses + y.taxes, y.ownerShare, y.paidByAirbnb, y.balance].map((v, i) => <td key={i} className="p-2 text-right whitespace-nowrap">{money(v, y.currency)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 md:hidden">{h.years.map(y => <div key={`${y.year}${y.currency}`} data-testid={`history-year-card-${y.year}`} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{y.year} <span className="text-xs font-normal text-muted-foreground">{y.bookings} stays · {y.nights} nights</span></p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs">{[[L.gross, y.gross], [L.fee, y.management], [L.share, y.ownerShare], [L.paid, y.paidByAirbnb], [L.balance, y.balance]].map(([k, v]) => <div key={String(k)} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{money(Number(v), y.currency)}</dd></div>)}</dl>
          </div>)}</div>
        </section>}
        {h.months.length > 0 && <section className="space-y-2" aria-label="Months">
          <h2 className="font-semibold">Months</h2>
          {[...h.months].reverse().map(m => <MonthRow key={m.month} m={m} h={h} />)}
        </section>}
      </>}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className={`break-words ${strong ? "font-semibold" : ""}`}>{value}</div></div>;
}

function MonthRow({ m, h }: { m: History["months"][number]; h: History }) {
  const [open, setOpen] = useState(false);
  const c = m.figures?.currency || h.property.currency || "AED";
  const status = m.statement?.status;
  return (
    <div className="rounded-lg border" data-testid={`history-month-${m.month}`}>
      <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="min-w-0"><span className="font-medium">{monthLabel(m.month)}</span> <span className="text-xs text-muted-foreground">{m.stays.length} stay{m.stays.length === 1 ? "" : "s"}{status ? ` · statement ${status}` : " · no statement saved"}</span></span>
        <span className="flex shrink-0 items-center gap-2">{m.figures ? <span className="text-xs sm:text-sm">{money(m.figures.ownerShare, c)}</span> : <span className="text-xs text-amber-800">can't be calculated yet</span>}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && <div className="space-y-2 border-t px-3 py-2 text-xs">
        {m.held && <p className="text-amber-800">{m.held}</p>}
        {m.figures && <p className="text-muted-foreground">Gross {money(m.figures.gross, c)} · fees {money(m.figures.channel, c)} · management {money(m.figures.management, c)} · owner share {money(m.figures.ownerShare, c)} · paid by Airbnb {money(m.figures.paidByAirbnb, c)} · balance {money(m.figures.balance, c)}</p>}
        <ul className="space-y-1">{m.stays.map((s: any) => <li key={s.id} className="break-words">
          <span className="font-medium">{s.code ?? s.guestName ?? "Stay"}</span> · {s.checkIn} → {s.checkOut}{s.grossAmount != null ? ` · ${money(Number(s.grossAmount), c)}` : ""}{s.ownerAmount != null ? ` · owner ${money(Number(s.ownerAmount), c)}` : ""}{s.verified === false ? " · not verified" : ""}
          {(s.payouts ?? []).map((p: any, i: number) => <span key={i} className="block text-muted-foreground">Paid {p.paidOn ?? "date not known"}{s.payouts.length > 1 && p.amount != null ? ` · ${money(Number(p.amount), c)}` : ""}{p.paidTo ? ` · ${p.paidTo}` : ""}{p.sentAmount != null ? ` · sent as ${p.sentCurrency} ${Number(p.sentAmount).toFixed(2)} (reference only)` : ""}</span>)}
        </li>)}</ul>
        <Link href={`/accounting?month=${m.month}`} className="inline-flex items-center gap-1 underline"><FileText className="h-3 w-3" />Open {monthLabel(m.month)} statements</Link>
      </div>}
    </div>
  );
}
