import { PayoutLine } from "@/components/OwnerPayouts";
import { apiFetch } from "@/lib/api-fetch";
import { statementBalance, feeLabels } from "@/lib/statement-balance";
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarRange, FileText, Home, LogOut, TrendingUp, Moon,
  ChevronLeft, ChevronRight, DollarSign, CheckCircle2, Send,
  BedDouble, Building,
} from "lucide-react";
import {
  addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  format, parseISO, isSameDay,
} from "date-fns";
import logoPath from "../assets/yallastay-logo.png";
import { useToast } from "@/hooks/use-toast";
import { CHANNEL_COLORS, LEGEND, barStyle, channelColor } from "@/lib/channel-colors";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fj = async (url: string, opts?: RequestInit) => {
  const res = await apiFetch(`${API_BASE}${url}`, opts);
  if (!res.ok) throw new Error("API error");
  if (res.status === 204) return null;
  return res.json();
};

function aed(n: number, currency="AED") {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft",  color: "bg-slate-100 text-slate-700 border-slate-200" },
  sent:  { label: "Sent",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  paid:  { label: "Paid",   color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
  return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
});

// ── Calendar Tab ────────────────────────────────────────────────────────────

function OwnerCalendar({ properties }: { properties: any[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const propertyIds = properties.map((p: any) => p.id);

  const days = useMemo(() =>
    eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) }),
    [currentMonth]
  );

  const { data: allReservations, isLoading } = useQuery({
    queryKey: ["owner-reservations", propertyIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        propertyIds.map(id => fj(`/api/reservations?propertyId=${id}`).catch(() => []))
      );
      return results.flat();
    },
    enabled: propertyIds.length > 0,
  });

  function getCell(propId: number, day: Date) {
    const ds = format(day, "yyyy-MM-dd");
    return allReservations?.find((r: any) =>
      r.propertyId === propId && r.status !== "cancelled" && r.checkIn <= ds && r.checkOut > ds
    ) ?? null;
  }

  return (
    <div className="space-y-4">
      {/* Month Nav */}
      <div className="flex items-center justify-between bg-card border rounded-lg px-4 py-2">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="font-semibold text-base">{format(currentMonth, "MMMM yyyy")}</span>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {LEGEND.map(k => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CHANNEL_COLORS[k].bg }} />
            {CHANNEL_COLORS[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block w-3 h-3 rounded-sm bg-muted border" />
          Available
        </span>
      </div>

      {/* Grid */}
      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: `${Math.max(days.length * 36 + 160, 500)}px` }}>
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card text-left px-3 py-2 font-medium text-muted-foreground w-40 border-r text-xs">
                Your Properties
              </th>
              {days.map(day => {
                const isToday = isSameDay(day, new Date());
                const isWknd = [0, 6].includes(day.getDay());
                return (
                  <th key={day.toISOString()} className={[
                    "px-0 py-2 text-center w-9 min-w-[36px]",
                    isToday ? "bg-primary/10" : isWknd ? "bg-muted/30" : "",
                  ].join(" ")}>
                    <div className="text-[10px] text-muted-foreground leading-none">{format(day, "EEE")[0]}</div>
                    <div className={[
                      "text-xs mt-0.5 w-6 h-6 flex items-center justify-center mx-auto rounded-full font-medium",
                      isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    ].join(" ")}>{format(day, "d")}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(properties.length || 2).fill(0).map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="sticky left-0 bg-card px-3 py-3 border-r"><Skeleton className="h-4 w-28" /></td>
                  {days.map((_, j) => <td key={j} className="px-0.5 py-2"><Skeleton className="h-5 w-full rounded" /></td>)}
                </tr>
              ))
            ) : properties.map((prop: any) => (
              <tr key={prop.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="sticky left-0 z-10 bg-card px-3 py-2 border-r">
                  <div className="font-medium text-xs truncate max-w-[140px]" title={prop.name}>{prop.name}</div>
                  <div className="text-[11px] text-muted-foreground">{prop.unitNumber}</div>
                </td>
                {days.map(day => {
                  const res = getCell(prop.id, day);
                  const style = res ? barStyle(res) : null;
                  const isCI = res ? isSameDay(parseISO(res.checkIn), day) : false;

                  return (
                    <td key={day.toISOString()} className={[
                      "px-0 py-1.5 h-10",
                      isSameDay(day, new Date()) ? "bg-primary/5" : [0, 6].includes(day.getDay()) ? "bg-muted/20" : "",
                    ].join(" ")}>
                      {res && style ? (
                        <div
                          title={`${res.guestName} · ${res.checkIn} → ${res.checkOut}`}
                          style={style}
                          className={[
                            "h-6 mx-0.5 flex items-center justify-center text-[10px] font-medium px-1 truncate",
                            isCI ? "rounded-l-full ml-1" : "",
                            res.checkOut === format(new Date(new Date(day).setDate(day.getDate() + 1)), "yyyy-MM-dd") ? "rounded-r-full mr-1" : "",
                          ].join(" ")}
                        >
                          {isCI ? <span className="truncate">{res.guestName.split(" ")[0]}</span> : null}
                        </div>
                      ) : (
                        <div className="h-6 mx-0.5 rounded bg-muted/40 border border-muted" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Upcoming reservations list */}
      {!isLoading && (() => {
        const today = format(new Date(), "yyyy-MM-dd");
        const upcoming = (allReservations ?? [])
          .filter((r: any) => r.status !== "cancelled" && r.checkOut >= today)
          .sort((a: any, b: any) => a.checkIn.localeCompare(b.checkIn))
          .slice(0, 8);
        if (!upcoming.length) return null;
        return (
          <div>
            <h3 className="font-semibold text-sm mb-2">Upcoming Stays</h3>
            <div className="space-y-2">
              {upcoming.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 bg-card border rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: channelColor(r).bg }} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{r.guestName}</div>
                      <div className="text-xs text-muted-foreground">{r.propertyName ?? properties.find((p: any) => p.id === r.propertyId)?.name}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium">{format(parseISO(r.checkIn), "MMM d")} – {format(parseISO(r.checkOut), "MMM d")}</div>
                    <div className="text-xs text-muted-foreground">{r.nights} night{r.nights !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Statements Tab ──────────────────────────────────────────────────────────

function OwnerStatements({ ownerId }: { ownerId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value);

  const { data: statements, isLoading } = useQuery({
    queryKey: ["owner-statements", ownerId, selectedMonth],
    queryFn: () => fj(`/api/accounting/statements?ownerId=${ownerId}&month=${selectedMonth}`),
  });

  const generateMutation = useMutation({
    mutationFn: async () => queryClient.invalidateQueries({queryKey:["owner-statements"]}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["owner-statements"] }); toast({ title: "Statements refreshed" }); },
  });

  const statementCurrencies=[...new Set((statements || []).map((s:any)=>s.currency || "AED"))];
  const totalGross = statements?.reduce((s: number, st: any) => s + st.grossRevenue, 0) ?? 0;
  const totalPayout = statements?.reduce((s: number, st: any) => s + st.ownerPayout, 0) ?? 0;
  const totalDeductions = totalGross - totalPayout;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {generateMutation.isPending ? "Refreshing…" : "Refresh Statements"}
        </Button>
      </div>

      {/* Summary */}
      {!isLoading && (statements?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Gross Revenue", value: totalGross, color: "text-emerald-600" },
            { label: "Deductions", value: totalDeductions, color: "text-red-500" },
            { label: "Your Payout", value: totalPayout, color: "text-primary font-bold" }, // balance after co-host payouts Airbnb paid you directly
          ].map(({ label, value, color }) => (
            <Card key={label} className="text-center">
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-base font-bold ${color}`}>{statementCurrencies.map((currency:any)=>{const rows=(statements||[]).filter((s:any)=>(s.currency||"AED")===currency);const total=rows.reduce((n:number,r:any)=>n+Number(label==="Gross Revenue"?r.grossRevenue:label==="Your Payout"?r.ownerPayout:r.grossRevenue-r.ownerPayout-Number(r.paidByAirbnb||0)),0);return <div key={currency}>{label==="Your Payout"&&Math.round(total*100)<0?`You owe ${aed(-total,currency)}`:aed(total,currency)}</div>;})}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : !statements?.length ? (
        <div className="text-center py-14 border-2 border-dashed rounded-xl text-muted-foreground space-y-2">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="font-medium">No statement for {format(new Date(selectedMonth + "-01"), "MMMM yyyy")}</p>
          <p className="text-sm">Your operator will publish statements here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {statements.map((stmt: any) => {
            const s = STATUS_CONFIG[stmt.status] ?? STATUS_CONFIG.draft;
            const deductions = stmt.platformFees + stmt.managementFee + stmt.cleaningCosts + stmt.maintenanceCosts + stmt.otherExpenses + stmt.vatAmount;
            return (
              <Card key={stmt.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{stmt.propertyName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{stmt.bookingsCount} booking{stmt.bookingsCount !== 1 ? "s" : ""} · {stmt.nightsOccupied} nights</span>
                      <Badge className={`text-xs border ${s.color}`}>{s.label}</Badge>
                    </div>
                  </div>

                  {/* Breakdown table */}
                  <div className="bg-muted/30 rounded-lg px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{feeLabels(stmt, "owner").gross}</span>
                      <span className="font-medium text-emerald-600">{aed(stmt.grossRevenue,stmt.currency || "AED")}</span>
                    </div>
                    {stmt.platformFees > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{feeLabels(stmt).platform}</span>
                        <span className="text-red-400">− {aed(stmt.platformFees,stmt.currency || "AED")}</span>
                      </div>
                    )}
                    {feeLabels(stmt, "owner").net && <div className="flex justify-between text-muted-foreground"><span>{feeLabels(stmt, "owner").net}</span><span>{aed(stmt.grossRevenue - stmt.platformFees,stmt.currency || "AED")}</span></div>}
                    <div className="flex justify-between text-muted-foreground">
                      <span>{feeLabels(stmt).management}</span>
                      <span className="text-red-400">− {aed(stmt.managementFee,stmt.currency || "AED")}</span>
                    </div>
                    {stmt.cleaningCosts > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Cleaning Costs</span>
                        <span className="text-red-400">− {aed(stmt.cleaningCosts,stmt.currency || "AED")}</span>
                      </div>
                    )}
                    {stmt.maintenanceCosts > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Maintenance</span>
                        <span className="text-red-400">− {aed(stmt.maintenanceCosts,stmt.currency || "AED")}</span>
                      </div>
                    )}
                    {stmt.tourismFee > 0 && <div className="flex justify-between"><span>Tourism fee</span><span>{stmt.currency || "AED"} {Number(stmt.tourismFee).toFixed(2)}</span></div>}
                    {stmt.vatAmount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>VAT</span>
                        <span className="text-red-400">− {aed(stmt.vatAmount,stmt.currency || "AED")}</span>
                      </div>
                    )}
                    {(() => { const bal = statementBalance(stmt, "owner"); return <>
                      {bal.hasCohost && <>
                        <div className="flex justify-between border-t pt-2"><span>Your share</span><span className="font-medium">{aed(bal.ownerShare,stmt.currency || "AED")}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>{feeLabels(stmt, "owner").paidByAirbnb}</span><span className="text-red-400">− {aed(bal.paidByAirbnb,stmt.currency || "AED")}</span></div>
                      </>}
                      <div className="flex justify-between font-semibold border-t pt-2 text-base mt-1">
                        <span>{bal.label}</span>
                        <span className={bal.owes ? "text-red-600" : "text-emerald-600"}>{bal.settled ? "Nothing owed" : aed(bal.amount,stmt.currency || "AED")}</span>
                      </div>
                      {bal.rounding && <p className="text-xs text-muted-foreground">Airbnb already paid you your share; the {aed(bal.amount,stmt.currency || "AED")} difference is rounding.</p>}
                      {bal.settled && !bal.rounding && <p className="text-xs text-muted-foreground">Airbnb paid you directly, so nothing is owed either way.</p>}
                    </>; })()}
                  </div>

                  {stmt.paidAt && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {stmt.payouts?.length ? "Paid to you" : `Payment transferred on ${stmt.paidAt}`}
                      </div>
                      {stmt.payouts?.length > 0 && <ul className="space-y-1 pl-5">{stmt.payouts.map((p: any) => <PayoutLine key={p.id} p={p} />)}</ul>}
                    </div>
                  )}
                  {stmt.sentAt && !stmt.paidAt && (
                    <p className="text-xs text-muted-foreground mt-2">Statement sent on {stmt.sentAt}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OwnerOverview({ properties, ownerId }: { properties: any[]; ownerId: number }) {
  const propertyIds = properties.map((p: any) => p.id);

  const { data: allReservations } = useQuery({
    queryKey: ["owner-res-overview", propertyIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(propertyIds.map(id => fj(`/api/reservations?propertyId=${id}`).catch(() => [])));
      return results.flat();
    },
    enabled: propertyIds.length > 0,
  });

  const { data: statements } = useQuery({
    queryKey: ["owner-statements-overview", ownerId],
    queryFn: () => fj(`/api/accounting/statements?ownerId=${ownerId}`),
  });

  const today = format(new Date(), "yyyy-MM-dd");
  const thisMonth = format(new Date(), "yyyy-MM");

  const active = allReservations?.filter((r: any) => r.status !== "cancelled" && r.checkIn <= today && r.checkOut > today) ?? [];
  const upcoming = allReservations?.filter((r: any) => r.status !== "cancelled" && r.checkIn > today) ?? [];
  const totalRevenue = allReservations?.filter((r: any) => r.status !== "cancelled").reduce((s: number, r: any) => s + parseFloat(r.revenue || "0"), 0) ?? 0;
  const pendingPayout = statements?.filter((s: any) => s.status !== "paid").reduce((sum: number, s: any) => sum + s.ownerPayout, 0) ?? 0;

  const kpis = [
    { icon: Home,        label: "Your Properties",     value: properties.length, color: "text-primary" },
    { icon: BedDouble,   label: "Active Guests",        value: active.length,     color: "text-emerald-600" },
    { icon: CalendarRange, label: "Upcoming Bookings",  value: upcoming.length,   color: "text-blue-600" },
    { icon: DollarSign,  label: "Pending Payout",       value: [...new Set((statements||[]).filter((s:any)=>s.status!=="paid").map((s:any)=>s.currency||"AED"))].map((currency:any)=>aed((statements||[]).filter((s:any)=>s.status!=="paid"&&(s.currency||"AED")===currency).reduce((n:number,s:any)=>n+Number(s.ownerPayout),0),currency)).join(" · ") || "None", color: pendingPayout > 0 ? "text-amber-600" : "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      <section className="today-panel mb-5"><p className="today-eyebrow">YOUR INVESTMENT · THIS MONTH</p><h2 className="text-2xl font-semibold mt-2">A clearer view of your returns.</h2><p className="text-sm text-muted-foreground mt-2">Published statements are shown below. Draft or unverified income is excluded.</p><div className="grid sm:grid-cols-2 gap-4 mt-5">{[...new Set((statements || []).filter((s:any)=>s.month===thisMonth).map((s:any)=>s.currency || 'AED'))].map((currency:any)=>{const rows=(statements || []).filter((s:any)=>s.month===thisMonth&&(s.currency || 'AED')===currency);return <div key={currency} className="border rounded-xl p-4"><p className="text-xs text-muted-foreground">{currency} · Published this month</p>{[['grossRevenue','Booking totals'],['managementFee','Management fees'],['otherExpenses','Other expenses'],['ownerPayout','Your payout']].map(([key,label])=><div key={key} className="flex justify-between text-sm mt-3"><span>{label}</span><strong>{currency} {rows.reduce((n:number,r:any)=>n+Number(r[key] || 0),0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>)}</div>;})}</div>{!(statements || []).some((s:any)=>s.month===thisMonth)&&<p className="text-sm text-muted-foreground mt-4">Your operator hasn’t published this month’s statement yet.</p>}</section>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <div className={`text-xl font-bold ${color}`}>{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Properties */}
      <div>
        <h3 className="font-semibold text-sm mb-3">Your Properties</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {properties.map((p: any) => {
            const propReservations = allReservations?.filter((r: any) => r.propertyId === p.id && r.status !== "cancelled") ?? [];
            const isOccupied = propReservations.some((r: any) => r.checkIn <= today && r.checkOut > today);
            const nextRes = propReservations.filter((r: any) => r.checkIn > today).sort((a: any, b: any) => a.checkIn.localeCompare(b.checkIn))[0];
            return (
              <Card key={p.id} className="overflow-hidden">
                <div className={`h-1.5 ${isOccupied ? "bg-emerald-500" : "bg-muted"}`} />
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.unitNumber} · {p.building}</div>
                      <div className="text-xs text-muted-foreground">{p.bedroomType}</div>
                    </div>
                    <Badge variant={isOccupied ? "default" : "secondary"} className={isOccupied ? "bg-emerald-600 text-white text-[11px]" : "text-[11px]"}>
                      {isOccupied ? "Occupied" : "Available"}
                    </Badge>
                  </div>
                  {nextRes && (
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarRange className="h-3 w-3" />
                      Next: {nextRes.guestName} · {format(parseISO(nextRes.checkIn), "MMM d")}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recent statements preview */}
      {statements?.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-3">Recent Statements</h3>
          <div className="space-y-2">
            {statements.slice(0, 4).map((stmt: any) => {
              const s = STATUS_CONFIG[stmt.status] ?? STATUS_CONFIG.draft;
              return (
                <div key={stmt.id} className="flex items-center justify-between gap-3 bg-card border rounded-lg px-4 py-3">
                  <div>
                    <div className="font-medium text-sm">{stmt.propertyName}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(stmt.month + "-01"), "MMMM yyyy")}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(() => { const bal = statementBalance(stmt, "owner"); return <span className={`font-semibold text-sm ${bal.owes ? "text-red-600" : "text-emerald-600"}`}>{bal.settled ? "Settled" : <>{bal.owes ? "You owe " : ""}{aed(bal.amount,stmt.currency || "AED")}</>}</span>; })()}
                    <Badge className={`text-xs border ${s.color}`}>{s.label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Owner Portal ───────────────────────────────────────────────────────

export default function OwnerPortal() {
  const [, setLocation] = useLocation();

  const ownerId = parseInt(sessionStorage.getItem("ownerPortalId") || "0");
  const ownerName = sessionStorage.getItem("ownerPortalName") || "Owner";

  useEffect(() => {
    if (!ownerId || !sessionStorage.getItem("ownerPortalToken")) setLocation("/owner-login");
  }, [ownerId]);

  const { data: properties, isLoading } = useQuery({
    queryKey: ["owner-properties", ownerId],
    queryFn: () => fj(`/api/properties?ownerId=${ownerId}`),
    enabled: ownerId > 0,
  });

  function handleLogout() {
    sessionStorage.removeItem("ownerPortalToken");
    sessionStorage.removeItem("ownerPortalId");
    sessionStorage.removeItem("ownerPortalName");
    setLocation("/owner-login");
  }

  if (!ownerId || !sessionStorage.getItem("ownerPortalToken")) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-sidebar text-sidebar-foreground border-b sticky top-0 z-20 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logoPath}
              alt="YallaStay"
              className="h-11 w-11 rounded-2xl bg-white p-1.5 shadow-lg ring-2 ring-white/10 transition-transform hover:scale-105"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base leading-none tracking-tight">YallaStay</span>
                <span className="text-xs bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-full font-semibold">Owner Portal</span>
              </div>
              <div className="text-xs text-sidebar-foreground/50 mt-0.5">Welcome back, {ownerName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground text-xs"
              onClick={() => setLocation("/dashboard")}
            >
              Admin
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground text-xs"
            >
              <LogOut className="h-3.5 w-3.5 mr-1" />Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6 pb-16">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-4 gap-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          </div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList className="mb-6">
              <TabsTrigger value="overview" className="gap-1.5">
                <Home className="h-4 w-4" />Overview
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5">
                <CalendarRange className="h-4 w-4" />Calendar
              </TabsTrigger>
              <TabsTrigger value="statements" className="gap-1.5">
                <FileText className="h-4 w-4" />Statements
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <OwnerOverview properties={properties ?? []} ownerId={ownerId} />
            </TabsContent>
            <TabsContent value="calendar">
              <OwnerCalendar properties={properties ?? []} />
            </TabsContent>
            <TabsContent value="statements">
              <OwnerStatements ownerId={ownerId} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Powered by YallaStay footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-sm border-t py-2.5 z-10">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logoPath} alt="YallaStay" className="h-5 w-5 rounded-md bg-sidebar p-0.5" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Powered by YallaStay</span> · Property Management System
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:block">Owners Come First · Dubai, UAE</span>
        </div>
      </footer>
    </div>
  );
}
