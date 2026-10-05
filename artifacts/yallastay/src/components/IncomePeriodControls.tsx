import { ChevronLeft, ChevronRight } from "lucide-react";
import { dubaiMonth, monthLabel, shiftMonth, type Period } from "@/lib/income";

/** Month with previous/next, and a "This year" view. Big touch targets for phones. */
export function IncomePeriodControls({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const isMonth = "month" in period;
  const step = (by: number) => onChange(isMonth ? { month: shiftMonth(period.month, by) } : { year: String(Number(period.year) + by) });
  const label = isMonth ? monthLabel(period.month) : `Year ${period.year}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="income-period">
      <div className="flex items-center rounded-xl border bg-card">
        <button type="button" aria-label={isMonth ? "Previous month" : "Previous year"} onClick={() => step(-1)} className="h-11 w-11 flex items-center justify-center rounded-l-xl hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
        <span className="min-w-[9.5rem] text-center font-semibold px-1" aria-live="polite">{label}</span>
        <button type="button" aria-label={isMonth ? "Next month" : "Next year"} onClick={() => step(1)} className="h-11 w-11 flex items-center justify-center rounded-r-xl hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="flex rounded-xl border bg-card p-1" role="group" aria-label="Period">
        <button type="button" aria-pressed={isMonth} onClick={() => onChange({ month: isMonth ? period.month : (period.year === dubaiMonth().slice(0, 4) ? dubaiMonth() : `${period.year}-12`) })} className={`h-9 px-3 rounded-lg text-sm font-medium ${isMonth ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>Month</button>
        <button type="button" aria-pressed={!isMonth} onClick={() => onChange({ year: isMonth ? period.month.slice(0, 4) : period.year })} className={`h-9 px-3 rounded-lg text-sm font-medium ${!isMonth ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{!isMonth || period.month.slice(0, 4) === dubaiMonth().slice(0, 4) ? "This year" : `Year ${period.month.slice(0, 4)}`}</button>
      </div>
      {isMonth && period.month !== dubaiMonth() && <button type="button" onClick={() => onChange({ month: dubaiMonth() })} className="h-11 px-3 text-sm text-primary underline-offset-2 hover:underline">Back to this month</button>}
    </div>
  );
}
