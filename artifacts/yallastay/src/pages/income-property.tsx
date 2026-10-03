import { useMemo } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { IncomePeriodControls } from "@/components/IncomePeriodControls";
import { EstimateChip, statementChip } from "@/pages/income";
import { platformLabel } from "@/lib/channel-colors";
import { estimateText, hasFigures, money, monthLabel, periodFromSearch, periodLabel, periodQuery, useIncomeDetail, type IncomeRow, type Period } from "@/lib/income";

// One property's income for a month (its bookings and entries) or a year (month by month). Figures come from
// the server: the owner-statement calculation, or the published statement as stored.

function Breakdown({ r, excludesCleaning }: { r: IncomeRow; excludesCleaning: boolean }) {
  const line = (label: string, v: number, sign = "−", strong = false) => <div className={`flex justify-between gap-3 py-1.5 ${strong ? "font-semibold border-t mt-1 pt-2" : ""}`}><span className={strong ? "" : "text-muted-foreground"}>{sign && !strong ? `${sign} ` : ""}{label}</span><span className="tabular-nums">{money(v, r.currency)}</span></div>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border bg-card p-4 text-sm" data-testid={`breakdown-${r.currency}`}>
        <h3 className="font-semibold mb-1">Owner side · {r.currency}</h3>
        <p className="text-xs text-muted-foreground mb-2">{r.bookings} verified booking{r.bookings === 1 ? "" : "s"} · {r.nights} nights</p>
        {line("Gross booking income", r.gross, "")}
        {r.taxes !== 0 && line("VAT & tourism fee", r.taxes)}
        {line("Channel fees", r.channelFees)}
        {line(excludesCleaning ? "Cleaning (not charged to this owner)" : "Cleaning", r.cleaning)}
        {line("Expenses & repairs", r.expenses)}
        {line("YallaStay management fee", r.managementFee)}
        {line("Owner share", r.ownerShare, "", true)}
        {r.paidByAirbnb !== 0 && <p className="text-xs text-muted-foreground mt-1">Of which Airbnb paid the owner directly {money(r.paidByAirbnb, r.currency)}; balance from YallaStay {money(r.ownerBalance, r.currency)}.</p>}
      </section>
      <section className="rounded-2xl border bg-card p-4 text-sm">
        <h3 className="font-semibold mb-3">YallaStay · {r.currency}</h3>
        {line("Company income from this property", r.companyIncome, "")}
        {line("Company costs for this property", r.companyCosts)}
        {line("Net to YallaStay", r.companyNet, "", true)}
        <p className="text-xs text-muted-foreground mt-2">Income is the management fee, cleaning charged and any Airbnb co-host income; costs are cleaners and company-paid repairs. Same lines as the company statement.</p>
      </section>
    </div>
  );
}

function BookingRow({ b, verifyHref }: { b: any; verifyHref: string }) {
  return (
    <div data-testid={b.verified ? "booking-verified" : "booking-estimate"} className={`rounded-xl border p-3 text-sm ${b.verified ? "bg-card" : "bg-amber-50/60 border-amber-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {b.fromStatement ? <p className="font-medium">{b.guestName}</p> : <Link href={`/reservations/${b.id}`} className="font-medium hover:underline">{b.guestName}</Link>}
          <p className="text-xs text-muted-foreground">{b.checkIn} → {b.checkOut}{b.nights ? ` · ${b.nights} nights` : ""} · {platformLabel(b.platform)}{b.code ? ` · ${b.code}` : ""}</p>
        </div>
        {b.verified ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 shrink-0"><CheckCircle2 className="h-3.5 w-3.5" />Verified</span>
          : <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 shrink-0"><AlertTriangle className="h-3 w-3" />Estimate</span>}
      </div>
      {b.verified ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
        <div><p className="text-muted-foreground">Guest paid</p><p className="font-semibold tabular-nums">{money(b.grossAmount, b.currency)}</p></div>
        <div><p className="text-muted-foreground">Channel fees</p><p className="tabular-nums">{money(b.channelAmount, b.currency)}</p></div>
        <div><p className="text-muted-foreground">YallaStay fee</p><p className="tabular-nums">{money(b.managementAmount, b.currency)}</p></div>
        <div><p className="text-muted-foreground">Owner</p><p className="tabular-nums">{money(b.ownerAmount, b.currency)}</p></div>
      </div> : <p className="text-xs text-amber-900 mt-2">Not verified, so not in the figures above. {b.estimate?.length ? `${b.estimate.map((e: any) => `${e.source}: ${money(e.amount, e.currency)}`).join(" · ")} (not the guest total).` : "No amount recorded yet."} <Link href={verifyHref} className="underline font-medium">Verify</Link></p>}
    </div>
  );
}

export default function IncomePropertyPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [, go] = useLocation();
  const period = useMemo(() => periodFromSearch(search), [search]);
  const setPeriod = (p: Period) => go(`/income/${id}?${periodQuery(p)}`);
  const { data, isLoading, error } = useIncomeDetail(Number(id), period);
  const s = data?.summary;
  const chip = s ? statementChip(s) : null;
  const month = "month" in period ? period.month : null;
  const verifyHref = `/verify-bookings?month=${month ?? ""}&propertyId=${id}`;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href={`/income?${periodQuery(period)}`} className="inline-flex items-center gap-1.5 text-sm text-primary h-10"><ArrowLeft className="h-4 w-4" />All properties</Link>
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{(error as Error).message}</p> : isLoading || !data ? <Skeleton className="h-64 rounded-2xl" /> : <>
        <header className="space-y-3">
          <div><h1 className="text-2xl font-bold tracking-tight">{data.property.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{periodLabel(period)} · {s.ownerName ? `Owner: ${s.ownerName}` : "No owner yet"} · {data.property.currency} · {s.occupancy.percent}% occupied ({s.occupancy.nights} of {s.occupancy.days} nights)</p>
            <div className="flex flex-wrap gap-1.5 mt-2"><EstimateChip p={s} />{chip && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>}</div></div>
          <IncomePeriodControls period={period} onChange={setPeriod} />
        </header>
        {data.held && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>Statement can't be generated yet:</b> {data.held}. {month && <Link href={verifyHref} className="underline font-medium">Verify bookings</Link>}</p>}
        {data.publishedFigures && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">These figures are the {s.statement.status} owner statement for {monthLabel(month!)}, exactly as sent. <Link href="/accounting" className="underline font-medium">Owner statements</Link></p>}
        {s.rows.filter(hasFigures).map((r: IncomeRow) => <Breakdown key={r.currency} r={r} excludesCleaning={data.excludesCleaning} />)}
        {!s.rows.some(hasFigures) && <p className="text-sm text-muted-foreground">No verified income in this period.</p>}
        {s.estimate && <p className="text-sm text-amber-900">{s.unverified.count} booking{s.unverified.count === 1 ? "" : "s"} not verified{s.unverified.estimates.length ? `: Airbnb host payouts ${estimateText(s.unverified)}` : ""}. Estimates only; they aren't counted until verified.</p>}

        {data.months && <section className="space-y-2"><h2 className="font-semibold text-lg">Month by month</h2>
          {data.months.map((m: any) => { const rows = m.rows.filter(hasFigures); return (
            <Link key={m.month} href={`/income/${id}?month=${m.month}`}><div data-testid="income-month" className="flex items-center gap-3 rounded-xl border bg-card p-3 cursor-pointer hover:bg-muted/40">
              <div className="w-28 shrink-0 font-medium">{monthLabel(m.month)}</div>
              <div className="flex-1 min-w-0 text-sm">{rows.length ? rows.map((r: IncomeRow) => <p key={r.currency} className="tabular-nums">{r.bookings} bkg · gross {money(r.gross, r.currency)} · fee <b>{money(r.managementFee, r.currency)}</b> · owner {money(r.ownerShare, r.currency)}</p>) : <p className="text-muted-foreground">{m.unverified.count ? "" : "No bookings"}</p>}
                {m.unverified.count > 0 && <p className="text-xs text-amber-900">Estimate · {m.unverified.count} not verified{m.unverified.estimates.length ? ` (Airbnb payouts ${estimateText(m.unverified)})` : ""}</p>}</div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div></Link>); })}
        </section>}

        {data.bookings && <section className="space-y-2"><h2 className="font-semibold text-lg">Bookings checked out in {monthLabel(month!)}</h2>
          {data.bookings.length ? data.bookings.map((b: any) => <BookingRow key={b.id} b={b} verifyHref={verifyHref} />) : <p className="text-sm text-muted-foreground">No bookings checked out this month.</p>}
        </section>}
        {(data.ownerEntries?.length > 0 || data.maintenance?.length > 0) && <section className="space-y-2"><h2 className="font-semibold text-lg">Owner expenses & repairs</h2>
          {data.ownerEntries.map((e: any) => <div key={`e${e.id}`} className="flex justify-between gap-3 rounded-xl border bg-card p-3 text-sm"><span>{e.date} · {e.description}<span className="text-muted-foreground"> · {e.category}</span></span><span className="tabular-nums">{money(e.amount, e.currency)}</span></div>)}
          {data.maintenance.map((t: any) => <div key={`m${t.id}`} className="flex justify-between gap-3 rounded-xl border bg-card p-3 text-sm"><span>{t.completedAt} · {t.issue}<span className="text-muted-foreground"> · repair</span></span><span className="tabular-nums">{money(t.amount, data.property.currency)}</span></div>)}
        </section>}
        {data.companyLines.length > 0 && <section className="space-y-2"><h2 className="font-semibold text-lg">YallaStay income & costs</h2>
          {data.companyLines.map((l: any) => <div key={l.id} className="flex justify-between gap-3 rounded-xl border bg-card p-3 text-sm"><span className="min-w-0">{l.date} · {l.description}<span className="text-muted-foreground"> · {l.category}</span></span><span className={`tabular-nums shrink-0 ${l.type === "income" ? "text-emerald-700" : "text-rose-700"}`}>{l.type === "income" ? "+" : "−"}{money(l.amount, l.currency)}</span></div>)}
        </section>}
      </>}
    </div>
  );
}
