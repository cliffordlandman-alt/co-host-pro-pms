import { Link } from "wouter";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { dubaiMonth, hasFigures, money, monthLabel, useIncome } from "@/lib/income";

/** Dashboard: this month's income by property (same server figures as the Income per property page). */
export function IncomeThisMonth() {
  const month = dubaiMonth();
  const { data, isLoading, error } = useIncome({ month });
  if (error) return null; // no access to reports for this role: the section isn't shown
  const props = (data?.properties ?? []).filter(p => p.rows.some(hasFigures) || p.estimate);
  return (
    <section className="today-panel" data-testid="dashboard-income">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div><p className="today-eyebrow">INCOME THIS MONTH</p><h2 className="text-xl font-semibold mt-1">{monthLabel(month)} by property</h2>
          <p className="text-xs text-muted-foreground mt-1">Bookings checking out this month. All amounts are in UAE dirhams.</p></div>
        <Link href={`/income?month=${month}`} className="text-sm text-primary whitespace-nowrap inline-flex items-center gap-1 min-h-10">See all <ArrowRight className="h-4 w-4" /></Link>
      </div>
      {isLoading || !data ? <Skeleton className="h-28" /> : <>
        <div className="flex flex-wrap gap-x-6 gap-y-3 mb-4">{data.totals.filter(t => t.properties).map(t => <div key={t.currency}>
          <p className="text-[11px] text-muted-foreground">{t.currency} · Company fee</p><p className="text-2xl font-bold tabular-nums text-primary">{money(t.managementFee, t.currency)}</p>
          <p className="text-xs text-muted-foreground">Gross {money(t.gross, t.currency)} · owners {money(t.ownerShare, t.currency)}</p></div>)}
          {!data.totals.some(t => t.properties) && <p className="text-sm text-muted-foreground">No verified income yet this month.</p>}</div>
        {props.length ? <div className="divide-y">{props.slice(0, 8).map(p => { const rows = p.rows.filter(hasFigures); return (
          <Link key={p.propertyId} href={`/income/${p.propertyId}?month=${month}`}><div className="flex items-center gap-3 py-3 today-action cursor-pointer">
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.name}</p>
              <p className="text-xs text-muted-foreground">{rows.reduce((n, r) => n + r.bookings, 0)} verified · {p.occupancy.percent}% occupied{p.estimate ? "" : ""}</p>
              {p.estimate && <p className="text-[11px] text-amber-900 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Estimate · {p.unverified.count} not verified</p>}</div>
            <div className="text-right shrink-0">{rows.length ? rows.map(r => <p key={r.currency} className="text-sm font-semibold tabular-nums">{money(r.gross, r.currency, 0)}</p>) : <p className="text-sm text-muted-foreground">–</p>}
              {rows.map(r => <p key={r.currency} className="text-[11px] text-muted-foreground tabular-nums">fee {money(r.managementFee, r.currency, 0)}</p>)}</div>
          </div></Link>); })}</div> : <p className="text-sm text-muted-foreground">No bookings check out this month yet.</p>}
        {props.length > 8 && <Link href={`/income?month=${month}`} className="block text-sm text-primary mt-2">{props.length - 8} more properties →</Link>}
      </>}
    </section>
  );
}
