import { CalendarBookingLabel, calendarBookingName } from "@/components/CalendarBookingLabel";
import { BlockDatesDialog } from "@/components/BlockDatesDialog";
import { DirectBookingDialog } from "@/components/DirectBookingDialog";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { useGetReservations, useGetProperties } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, Lock } from "lucide-react";
import {
  addDays, subDays, startOfWeek, format, parseISO, isSameDay, addWeeks, subWeeks,
  addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval,
} from "date-fns";

const PLATFORM_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  airbnb:      { bg: "#E0565B", text: "#fff", label: "Airbnb" },
  booking_com: { bg: "#003580", text: "#fff", label: "Booking.com" },
  direct:      { bg: "#059669", text: "#fff", label: "Direct" },
  vrbo:        { bg: "#7c3aed", text: "#fff", label: "VRBO" },
  blocked:     { bg: "#6b7280", text: "#fff", label: "Blocked" },
};

type CalView = "multi" | "monthly" | "yearly";

export default function MultiCalendar() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [view, setView] = useState<CalView>("multi");
  const [anchor, setAnchor] = useState(new Date());
  const [search, setSearch] = useState("");
  const [perPage, setPerPage] = useState(50);

  const { data: reservations, isLoading: loadingRes } = useGetReservations();
  const { data: properties, isLoading: loadingProps } = useGetProperties();
  const isLoading = loadingRes || loadingProps;

  const activeProperties = useMemo(() =>
    (properties ?? []).filter((p: any) => p.status === "active"),
    [properties]
  );

  const filtered = useMemo(() =>
    search.trim()
      ? activeProperties.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()))
      : activeProperties,
    [activeProperties, search]
  );

  // Multi view: 14-day window starting from anchor
  const multiDays = useMemo(() => {
    const start = anchor;
    return Array.from({ length: 14 }, (_, i) => addDays(start, i));
  }, [anchor]);

  // Monthly view: all days in current month
  const monthDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(anchor), end: endOfMonth(anchor) });
  }, [anchor]);

  const days = view === "monthly" ? monthDays : multiDays;

  function getReservation(propId: number, day: Date) {
    if (!reservations) return null;
    const ds = format(day, "yyyy-MM-dd");
    return reservations.find((r: any) =>
      r.propertyId === propId &&
      r.status !== "cancelled" &&
      r.checkIn <= ds && r.checkOut > ds
    ) ?? null;
  }

  function prev() {
    if (view === "monthly") setAnchor(d => subMonths(d, 1));
    else setAnchor(d => subDays(d, 7));
  }
  function next() {
    if (view === "monthly") setAnchor(d => addMonths(d, 1));
    else setAnchor(d => addDays(d, 7));
  }
  function jumpBack() {
    if (view === "monthly") setAnchor(d => subMonths(d, 3));
    else setAnchor(d => subDays(d, 14));
  }
  function jumpFwd() {
    if (view === "monthly") setAnchor(d => addMonths(d, 3));
    else setAnchor(d => addDays(d, 14));
  }

  const today = new Date();
  const dateLabel = view === "monthly"
    ? format(anchor, "MMM ''yy")
    : `${format(days[0], "MMM d")} – ${format(days[days.length - 1], "MMM d, yyyy")}`;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <DirectBookingDialog open={bookingOpen} onOpenChange={setBookingOpen} />
      <Link href="/airbnb-import" className="text-sm underline">Import Airbnb bookings & income</Link>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <Button onClick={() => setBookingOpen(true)}>Add Direct Reservation</Button><BlockDatesDialog/>
          <div className="flex items-center border rounded-lg overflow-hidden text-sm">
            {(["multi", "monthly", "yearly"] as CalView[]).map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-1.5 font-medium transition-colors capitalize ${view === v ? "bg-teal-600 text-white" : "text-muted-foreground hover:bg-muted/60"} ${i > 0 ? "border-l" : ""}`}
              >
                {v === "multi" ? "Multi" : v === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-600 text-white">
          Available listings
        </button>
        <Select>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Tags" /></SelectTrigger>
          <SelectContent><SelectItem value="none">No tags</SelectItem></SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent><SelectItem value="ae">UAE</SelectItem></SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="City" /></SelectTrigger>
          <SelectContent><SelectItem value="dubai">Dubai</SelectItem></SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="All units" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All units</SelectItem></SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {filtered.length > 0 && (
            <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-muted text-muted-foreground">
              Show ({filtered.length})
            </span>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by listing"
              className="h-8 pl-8 pr-3 text-xs w-44"
            />
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Navigation bar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/20">
          <button onClick={() => setAnchor(today)} className="px-3 py-1 rounded text-xs font-medium border hover:bg-muted transition-colors mr-2">
            Today
          </button>
          <button onClick={prev} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={next} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold mx-2">{dateLabel}</span>
          <button onClick={jumpBack} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
            <ChevronLeft className="w-3.5 h-3.5 -mr-0.5" /><ChevronLeft className="w-3.5 h-3.5 -ml-0.5" />
          </button>
          <button onClick={jumpFwd} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
            <ChevronRight className="w-3.5 h-3.5 -mr-0.5" /><ChevronRight className="w-3.5 h-3.5 -ml-0.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          {view === "yearly" ? (
            <YearlyView properties={filtered} reservations={reservations ?? []} anchor={anchor} isLoading={isLoading} />
          ) : (
            <table className="w-full border-collapse" style={{ minWidth: `${Math.max(days.length * 48 + 200, 600)}px` }}>
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 z-10 bg-card text-left px-4 py-2 text-xs font-medium text-muted-foreground w-48 border-r">
                    Listing
                  </th>
                  {days.map(day => {
                    const isToday = isSameDay(day, today);
                    const isWeekend = [0, 6].includes(day.getDay());
                    return (
                      <th key={day.toISOString()} style={{ minWidth: "48px" }}
                        className={`px-1 py-2 text-center border-r last:border-r-0 ${isToday ? "bg-teal-50 dark:bg-teal-950/30" : isWeekend ? "bg-muted/20" : ""}`}>
                        <div className="text-[10px] text-muted-foreground leading-none">{format(day, "EEE")}</div>
                        <div className={`text-xs font-semibold mt-0.5 w-6 h-6 flex items-center justify-center mx-auto rounded-full ${isToday ? "bg-teal-600 text-white" : "text-foreground"}`}>
                          {format(day, "d")}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="sticky left-0 bg-card px-4 py-3 border-r">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      {days.map((_, j) => (
                        <td key={j} className="px-1 py-2"><Skeleton className="h-6 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 1} className="text-center py-16 text-muted-foreground text-sm">
                      {search ? "No listings match your search" : "No active properties yet"}
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, perPage).map((prop: any) => (
                    <tr key={prop.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="sticky left-0 z-10 bg-card px-4 py-2.5 border-r">
                        <div className="font-medium text-sm truncate max-w-[160px]" title={prop.name}>{prop.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{prop.id}</div>
                      </td>
                      {days.map(day => {
                        const res = getReservation(prop.id, day);
                        const isToday = isSameDay(day, today);
                        const isWeekend = [0, 6].includes(day.getDay());
                        const colors = res ? ((res.status as string) === "blocked" ? PLATFORM_COLORS.blocked : PLATFORM_COLORS[res.platform] ?? PLATFORM_COLORS.direct) : null;
                        const isCheckIn = res ? isSameDay(parseISO(res.checkIn), day) : false;
                        const isCheckOut = res ? format(day, "yyyy-MM-dd") === res.checkOut : false;

                        return (
                          <td key={day.toISOString()}
                            className={`px-0 py-1.5 border-r last:border-r-0 ${isToday ? "bg-teal-50/50 dark:bg-teal-950/10" : isWeekend ? "bg-muted/10" : ""}`}>
                            {res && colors ? (
                              <div
                                title={`${calendarBookingName(res)} (${res.checkIn} → ${res.checkOut})`}
                                className="h-7 mx-0.5 flex items-center justify-center text-[10px] font-medium truncate px-1"
                                style={{
                                  background: colors.bg,
                                  color: colors.text,
                                  borderRadius: isCheckIn && isCheckOut ? "6px" : isCheckIn ? "6px 0 0 6px" : isCheckOut ? "0 6px 6px 0" : "0",
                                  marginLeft: isCheckIn ? "2px" : "0",
                                  marginRight: isCheckOut ? "2px" : "0",
                                }}
                              >
                                {(isCheckIn || isSameDay(day, days[0])) && <CalendarBookingLabel booking={res} />}
                              </div>
                            ) : (
                              <div className="h-7 mx-0.5 rounded flex items-center justify-center" style={{ background: "transparent" }}>
                                {prop.status === "archived" && (
                                  <Lock className="w-3 h-3 text-muted-foreground/30" />
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Footer */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Show
            <select
              value={perPage}
              onChange={e => setPerPage(Number(e.target.value))}
              className="mx-2 border rounded px-2 py-0.5 bg-card text-xs"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            per page
          </span>
          <div className="flex gap-3 ml-auto">
            {Object.entries(PLATFORM_COLORS).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: v.bg }} />
                {v.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function YearlyView({ properties, reservations, anchor, isLoading }: {
  properties: any[];
  reservations: any[];
  anchor: Date;
  isLoading: boolean;
}) {
  const year = anchor.getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1));
  const today = new Date();

  function getOccupancy(propId: number, month: Date) {
    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
    let occupied = 0;
    for (const day of days) {
      const ds = format(day, "yyyy-MM-dd");
      const hasRes = reservations.some((r: any) =>
        r.propertyId === propId && r.status !== "cancelled" && r.status !== "blocked" &&
        r.checkIn <= ds && r.checkOut > ds
      );
      if (hasRes) occupied++;
    }
    return Math.round((occupied / days.length) * 100);
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (!properties.length) {
    return <div className="text-center py-16 text-sm text-muted-foreground">No active properties</div>;
  }

  return (
    <table className="w-full border-collapse text-xs" style={{ minWidth: "900px" }}>
      <thead>
        <tr className="border-b">
          <th className="sticky left-0 bg-card text-left px-4 py-2 text-muted-foreground font-medium w-40 border-r">Property</th>
          {months.map(m => (
            <th key={m.toISOString()} className={`px-2 py-2 text-center font-medium text-muted-foreground ${isSameDay(new Date(year, m.getMonth(), 1), new Date(today.getFullYear(), today.getMonth(), 1)) ? "text-teal-600" : ""}`}>
              {format(m, "MMM")}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {properties.map((prop: any) => (
          <tr key={prop.id} className="border-b last:border-0 hover:bg-muted/10">
            <td className="sticky left-0 bg-card px-4 py-2.5 border-r">
              <div className="font-medium truncate max-w-[144px]" title={prop.name}>{prop.name}</div>
            </td>
            {months.map(m => {
              const occ = getOccupancy(prop.id, m);
              const color = occ >= 80 ? "#10b981" : occ >= 50 ? "#f59e0b" : occ > 0 ? "#ef4444" : "";
              return (
                <td key={m.toISOString()} className="px-2 py-2 text-center">
                  {occ > 0 ? (
                    <span className="font-semibold" style={{ color }}>{occ}%</span>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
