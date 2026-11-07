import { useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { IncomePeriodControls } from "@/components/IncomePeriodControls";
import { AirbnbSplitSummary } from "@/components/AirbnbSplit";
import { estimateText, hasFigures, money, periodFromSearch, periodLabel, periodQuery, useIncome, type IncomeProperty, type IncomeRow, type IncomeTotal, type Period } from "@/lib/income";

// Income per property: every property for a month (default: this month) or a calendar year, in dirhams.
// All figures come from the server's owner-statement calculation, converted for display.

export function statementChip(p: IncomeProperty) {
  const s: any = p.statement;
  if ("published" in s) return s.published ? { text: `${s.published} statement${s.published === 1 ? "" : "s"} sent`, cls: "bg-emerald-50 text-emerald-800 border-emerald-200" } : null;
  if (s.status === "paid") return { text: "Statement paid", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (s.status === "sent") return { text: "Statement sent", cls: "bg-sky-50 text-sky-800 border-sky-200" };
  if (s.status === "draft") return { text: "Draft statement", cls: "bg-slate-50 text-slate-700 border-slate-200" };
  if (s.status === "duplicate") return { text: "Duplicate statements", cls: "bg-rose-50 text-rose-800 border-rose-200" };
  return null;
}
export function EstimateChip({ p }: { p: IncomeProperty }) {
  if (!p.estimate) return null;
  return <span data-testid="estimate-chip" className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900"><AlertTriangle className="h-3 w-3" />Estimate · {p.unverified.count} not verified</span>;
}

function TotalsCard({ t }: { t: IncomeTotal }) {
  return (
    <section data-testid={`income-total-${t.currency}`} className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t.currency} properties</h2>
        <span className="text-xs text-muted-foreground">{t.properties} with income · {t.bookings} booking{t.bookings === 1 ? "" : "s"} · {t.nights} nights</span>
      </div>
      {t.properties === 0 ? <p className="mt-3 text-sm text-muted-foreground">No verified {t.currency} income in this period yet.</p> : <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Gross booking income" value={money(t.gross, t.currency)} />
        <Figure label="Company management fee" value={money(t.managementFee, t.currency)} strong />
        <Figure label="Owner share" value={money(t.ownerShare, t.currency)} />
        <Figure label="Net to company" value={money(t.companyNet, t.currency)} strong />
      </div>}
      {t.unverifiedBookings > 0 && <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
        <b>{t.unverifiedBookings} booking{t.unverifiedBookings === 1 ? "" : "s"} not verified yet</b> and not in these figures.{t.unverifiedEstimate ? <> Airbnb host payouts recorded for them: <b>{money(t.unverifiedEstimate, t.currency)}</b> (estimate, not the guest total).</> : null}{" "}
        <Link href="/verify-bookings" className="underline font-medium">Verify bookings</Link></p>}
    </section>
  );
}
function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] text-muted-foreground leading-tight">{label}</p><p className={`mt-1 tabular-nums break-words ${strong ? "text-lg font-bold text-primary" : "text-lg font-semibold"}`}>{value}</p></div>;
}

function PropertyCard({ p, href }: { p: IncomeProperty; href: string }) {
  const chip = statementChip(p);
  const rows = p.rows.filter(hasFigures);
  return (
    <Link href={href}>
      <article data-testid="income-property" className="rounded-2xl border bg-card p-4 active:scale-[.99] transition-transform cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="font-semibold leading-snug line-clamp-2">{p.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{p.ownerName ? `Owner: ${p.ownerName}` : "No owner yet"}</p></div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2"><EstimateChip p={p} />{chip && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>}</div>
        {rows.length === 0 && !p.estimate && <p className="text-sm text-muted-foreground mt-3">No bookings checked out in this period · {p.occupancy.percent}% occupied</p>}
        {rows.map(r => <div key={r.currency} className="mt-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Figure label="Gross booking income" value={money(r.gross, r.currency)} />
            <Figure label="Company fee" value={money(r.managementFee, r.currency)} strong />
            <Figure label="Owner share" value={money(r.ownerShare, r.currency)} />
            <Figure label="Net to company" value={money(r.companyNet, r.currency)} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{r.bookings} booking{r.bookings === 1 ? "" : "s"} · {r.nights} nights · {p.occupancy.percent}% occupied · channel fees {money(r.channelFees, r.currency)} · cleaning & expenses {money(r.cleaning + r.expenses, r.currency)}{r.taxes ? ` · VAT & tourism ${money(r.taxes, r.currency)}` : ""}</p>
        </div>)}
        {p.estimate && <p className="text-xs text-amber-900 mt-2">{p.unverified.count} booking{p.unverified.count === 1 ? "" : "s"} ({p.unverified.nights} nights) not verified{p.unverified.estimates.length ? `: Airbnb payouts ${estimateText(p.unverified)} (estimate)` : ""}.</p>}
      </article>
    </Link>
  );
}

const COLS: { key: keyof IncomeRow | "occ" | "bn"; label: string; hint?: string }[] = [
  { key: "bn", label: "Bookings · nights" }, { key: "occ", label: "Occupancy" }, { key: "gross", label: "Gross booking income" }, { key: "taxes", label: "VAT & tourism" }, { key: "channelFees", label: "Channel fees" },
  { key: "cleaning", label: "Cleaning & expenses" }, { key: "managementFee", label: "Company fee" }, { key: "ownerShare", label: "Owner share" }, { key: "companyNet", label: "Net to company" },
];
function PropertyTable({ props, hrefOf, showTaxes }: { props: IncomeProperty[]; hrefOf: (p: IncomeProperty) => string; showTaxes: boolean }) {
  const [, go] = useLocation();
  const cols = COLS.filter(c => c.key !== "taxes" || showTaxes);
  const cell = (p: IncomeProperty, r: IncomeRow | null, k: string) => {
    if (k === "occ") return `${p.occupancy.percent}%`;
    if (!r) return "–";
    if (k === "bn") return `${r.bookings} · ${r.nights}`;
    if (k === "cleaning") return money(r.cleaning + r.expenses, r.currency);
    return money((r as any)[k], r.currency);
  };
  return (
    <div className="rounded-2xl border bg-card overflow-x-auto">
      <table className="w-full text-[13px]" data-testid="income-table">
        <thead><tr className="bg-muted/40 text-left text-xs text-muted-foreground">
          <th className="px-4 py-3 font-medium min-w-[200px]">Property</th>{cols.map(c => <th key={c.key} className="px-2 py-3 font-medium text-right">{c.label}</th>)}
        </tr></thead>
        <tbody>{props.flatMap(p => {
          const rows = p.rows.filter(hasFigures); const list: (IncomeRow | null)[] = rows.length ? rows : [null]; const chip = statementChip(p);
          return list.map((r, i) => <tr key={`${p.propertyId}-${r?.currency ?? "none"}`} data-testid={i === 0 ? "income-property" : undefined} onClick={() => go(hrefOf(p))} className={`cursor-pointer hover:bg-muted/40 ${i === 0 ? "border-t" : ""}`}>
            <td className="px-4 py-3 align-top min-w-[200px] max-w-[300px]">{i === 0 && <><Link href={hrefOf(p)} className="font-medium hover:underline" onClick={e => e.stopPropagation()}>{p.name}</Link>
              <div className="flex flex-wrap gap-1.5 mt-1 items-center"><span className="text-xs text-muted-foreground">{p.ownerName ?? "No owner yet"}</span><EstimateChip p={p} />{chip && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>}</div>
              {p.estimate && p.unverified.estimates.length > 0 && <div className="text-[11px] text-amber-900 mt-1">Airbnb payouts {estimateText(p.unverified)} (estimate, not included)</div>}</>}</td>
            {cols.map(c => <td key={c.key} className={`px-2 py-3 text-right tabular-nums whitespace-nowrap align-top ${["managementFee", "companyNet"].includes(c.key) && r ? "font-semibold" : ""} ${!r ? "text-muted-foreground" : ""}`}>{c.key === "occ" && i > 0 ? "" : cell(p, r, c.key)}</td>)}
          </tr>);
        })}</tbody>
      </table>
    </div>
  );
}

export default function IncomePage() {
  const search = useSearch();
  const [, go] = useLocation();
  const period = useMemo(() => periodFromSearch(search), [search]);
  const setPeriod = (p: Period) => go(`/income?${periodQuery(p)}`);
  const { data, isLoading, error } = useIncome(period);
  const active = (p: IncomeProperty) => p.rows.some(hasFigures) || p.estimate;
  const props = useMemo(() => (data?.properties ?? []).filter(active), [data]);
  const empty = useMemo(() => (data?.properties ?? []).filter(p => !active(p)), [data]);
  const hrefOf = (p: IncomeProperty) => `/income/${p.propertyId}?${periodQuery(period)}`;
  const showTaxes = !!data?.properties.some(p => p.rows.some(r => r.taxes));
  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="space-y-3">
        <div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Income per property</h1>
          <p className="text-sm text-muted-foreground mt-1">{periodLabel(period)} · each booking counts in the month the guest checks out, exactly as on owner statements. Tap a property for its bookings.</p></div>
        <IncomePeriodControls period={period} onChange={setPeriod} />
      </header>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{(error as Error).message}</p> : isLoading || !data ? <div className="space-y-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div> : <>
        <div className="grid gap-3 xl:grid-cols-2">{data.totals.length ? data.totals.map(t => <TotalsCard key={t.currency} t={t} />) : <p className="text-sm text-muted-foreground">No bookings checked out in this period.</p>}</div>
        <AirbnbSplitSummary splits={(data as any).airbnbSplit ?? []} totals={(data as any).airbnbSplitTotals ?? []} hrefOf={id => `/income/${id}?${periodQuery(period)}`} />
        {data.companyOther.length > 0 && <p className="text-xs text-muted-foreground flex gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />Company income and costs not tied to a property (not in the rows below): {data.companyOther.map(c => `${money(c.net, c.currency)} net`).join(" · ")}. See the company statement in Reports.</p>}
        {props.length > 0 && <>
          <div className="lg:hidden space-y-3">{props.map(p => <PropertyCard key={p.propertyId} p={p} href={hrefOf(p)} />)}</div>
          <div className="hidden lg:block"><PropertyTable props={props} hrefOf={hrefOf} showTaxes={showTaxes} /></div>
        </>}
        {empty.length > 0 && <section className="rounded-2xl border bg-card p-4" data-testid="income-empty">
          <h2 className="text-sm font-semibold">No bookings checked out in {periodLabel(period)} ({empty.length})</h2>
          <div className="flex flex-wrap gap-2 mt-3">{empty.map(p => <Link key={p.propertyId} href={hrefOf(p)} data-testid="income-property-empty"><span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted cursor-pointer min-h-10"><span className="max-w-[16rem] truncate">{p.name}</span><span className="text-xs text-muted-foreground">{p.occupancy.percent}%</span></span></Link>)}</div>
        </section>}
        <details className="rounded-xl border bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">What the columns mean</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground list-disc pl-5">
            <li><b>Gross booking income</b>: what guests paid for bookings that checked out in the period (verified bookings only).</li>
            <li><b>Channel fees</b>: Airbnb/Booking.com fees. <b>Cleaning & expenses</b>: cleaning charged to the owner, owner expenses and repairs.</li>
            <li><b>Company fee</b>: the management fee, the company's commission. <b>Owner share</b>: what the owner earns after all deductions (including any co-host payout Airbnb paid the owner directly).</li>
            <li><b>Net to company</b>: company income from the property (management fee, cleaning charged, Airbnb co-host income) minus company costs for it (cleaners, company-paid repairs), as on the company statement.</li>
            <li><b>Occupancy</b>: nights booked in the period ÷ nights in the period. <b>Estimate</b>: some bookings aren't verified yet, so their money isn't counted; verify them to complete the figures.</li>
            <li>Each property is shown in its own currency. AED and ZAR are never added together and no exchange rate is used.</li>
          </ul></details>
      </>}
    </div>
  );
}
