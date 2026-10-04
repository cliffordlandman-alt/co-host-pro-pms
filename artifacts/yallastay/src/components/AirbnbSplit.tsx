import { Link } from "wouter";
import { Info } from "lucide-react";
import { money } from "@/lib/income";

// Full Airbnb earnings on co-host-payout properties: total Airbnb earnings, the co-host payout (the owner's share,
// paid to the owner directly by Airbnb) and the company's share, side by side, per currency. From the Airbnb payout
// files where imported, else the reservation breakdowns, else the verified booking. Not part of owner-statement figures.
type Total = { currency: string; bookings: number; total: number; cohostPayout: number; cohostPaid: number; cohostExpected: number; company: number; companyPaid: number; companyNotYet: number; cohostUnknown: number; properties?: number };

function Three({ t, compact }: { t: Total; compact?: boolean }) {
  const sub = (parts: [string, number][]) => parts.filter(([, v]) => v !== 0).map(([l, v]) => `${l} ${money(v, t.currency)}`).join(" · ");
  const box = (label: string, value: string, hint: string, testid: string, strong = false) => (
    <div className="min-w-0 rounded-xl border bg-background/60 p-3" data-testid={testid}>
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      <p className={`mt-1 tabular-nums break-words ${compact ? "text-base" : "text-lg"} ${strong ? "font-bold text-primary" : "font-semibold"}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
  const noneKnown = t.cohostUnknown > 0 && t.cohostUnknown === t.bookings; // no booking has a co-host figure: don't show 0
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {box("Total Airbnb earnings", noneKnown ? "Not known" : money(t.total, t.currency), t.cohostUnknown ? `leaves out ${t.cohostUnknown} booking${t.cohostUnknown === 1 ? "" : "s"} with no co-host figure` : `${t.bookings} booking${t.bookings === 1 ? "" : "s"}`, "split-total")}
      {box("Co-host payout to owner (Airbnb pays it)", noneKnown ? "Not known" : money(t.cohostPayout, t.currency), noneKnown ? "not in the Airbnb files or the bookings" : sub([["paid", t.cohostPaid], ["expected", t.cohostExpected]]), "split-cohost")}
      {box("Company's share", money(t.company, t.currency), sub([["paid", t.companyPaid], ["not paid yet", t.companyNotYet]]), "split-company", true)}
    </div>
  );
}

export function AirbnbSplitSummary({ splits, totals, hrefOf }: { splits: any[]; totals: Total[]; hrefOf: (id: number) => string }) {
  if (!splits?.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3" data-testid="airbnb-split">
      <div><h2 className="font-semibold">Full Airbnb earnings · co-host-payout properties</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Bookings that checked out in the period. The co-host payout is the owner's share, which Airbnb pays the owner directly; the company's share is what Airbnb pays YallaStay. From the Airbnb payout files, else the booking breakdown or the verified booking. Separate from the owner-statement figures above.</p></div>
      {totals.map(t => <div key={t.currency} data-testid={`split-totals-${t.currency}`} className="space-y-1.5"><p className="text-xs font-semibold">{t.currency} · {t.properties} propert{t.properties === 1 ? "y" : "ies"}</p><Three t={t} /></div>)}
      <div className="divide-y">{splits.map(s => s.totals.map((t: Total) => (
        <Link key={`${s.propertyId}-${t.currency}`} href={hrefOf(s.propertyId)}>
          <div data-testid="split-property" className="py-3 cursor-pointer hover:bg-muted/30 rounded-lg px-1 space-y-1.5">
            <p className="text-sm font-medium">{s.name} <span className="text-xs text-muted-foreground">· {t.currency}{s.withoutFigures ? ` · ${s.withoutFigures} booking${s.withoutFigures === 1 ? "" : "s"} without figures yet` : ""}</span></p>
            <Three t={t} compact />
            {!s.settingOn && <p className="text-[11px] text-amber-900">The Airbnb files show co-host payouts here, but "co-host payout goes directly to the owner" is off in this property's Fee settings.</p>}
          </div>
        </Link>)))}
        {splits.filter(s => !s.totals.length).map(s => <p key={s.propertyId} className="py-3 text-sm text-muted-foreground">{s.name}: no Airbnb figures for bookings in this period{s.withoutFigures ? ` (${s.withoutFigures} booking${s.withoutFigures === 1 ? "" : "s"} not verified or in the files yet)` : ""}.</p>)}
      </div>
    </section>
  );
}

const basis = (b?: string | null) => b === "paid" ? "paid" : b === "upcoming" ? "upcoming" : b === "expected" ? "expected" : "";
export function AirbnbSplitDetail({ split }: { split: any }) {
  if (!split) return null;
  return (
    <section className="space-y-3" data-testid="airbnb-split">
      <div><h2 className="font-semibold text-lg">Full Airbnb earnings</h2>
        <p className="text-xs text-muted-foreground">Total Airbnb earnings, the co-host payout Airbnb pays the owner directly (the owner's share) and the company's share. "Paid" means the Airbnb earnings file shows it paid; "expected" comes from the booking breakdown or the verified booking.</p></div>
      {!split.settingOn && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-px" />The Airbnb files show co-host payouts on this listing, but "co-host payout goes directly to the owner" is off in Fee settings, so owner statements don't deduct them.</p>}
      {split.totals.map((t: Total) => <div key={t.currency} data-testid={`split-totals-${t.currency}`}><Three t={t} /></div>)}
      {split.rows.length === 0 ? <p className="text-sm text-muted-foreground">No Airbnb bookings checked out in this period.</p> : <div className="space-y-2">{split.rows.map((r: any) => (
        <div key={r.code ?? r.reservationId} data-testid="split-booking" className={`rounded-xl border p-3 text-sm ${r.known ? "bg-card" : "bg-amber-50/60 border-amber-200"}`}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0">
            <p className="font-medium">{r.reservationId ? <Link href={`/reservations/${r.reservationId}`} className="hover:underline">{r.guestName || "Guest"}</Link> : (r.guestName || "Guest")}{r.code && <span className="ml-1 font-mono text-xs text-muted-foreground">{r.code}</span>}</p>
            <p className="text-xs text-muted-foreground">{r.checkIn} → {r.checkOut}{r.known ? ` · from the ${r.source}` : ""}{r.known && !r.inYallaPMS ? " · not a YallaPMS booking" : ""}</p></div></div>
          {r.known ? <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div><p className="text-muted-foreground">Total</p><p className="font-semibold tabular-nums">{money(r.total, r.currency)}</p></div>
            <div><p className="text-muted-foreground">Co-host payout</p><p className="tabular-nums">{money(r.cohostPayout, r.currency)}</p><p className="text-muted-foreground">{basis(r.cohostBasis)}</p></div>
            <div><p className="text-muted-foreground">Company</p><p className="font-semibold tabular-nums">{money(r.company, r.currency)}</p><p className="text-muted-foreground">{basis(r.companyBasis)}{r.companyPaidTo ? ` → ${r.companyPaidTo}` : ""}</p></div>
          </div> : null}
          {r.reason && <p className="text-xs text-amber-900 mt-1">{r.reason[0].toUpperCase() + r.reason.slice(1)}.</p>}
        </div>))}</div>}
    </section>
  );
}
