import { Button } from "@/components/ui/button";
import { AirbnbIncome } from "@/components/AirbnbIncome";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  DoorOpen, DoorClosed, BedDouble, Building2, Sparkles,
  Wrench, CreditCard, AlertTriangle, CalendarRange, TrendingUp,
  ArrowRight, Moon, Shield, ChevronRight, Users, Link2, PlusCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth-context";
import logoPath from "../assets/cohost-logo.svg";
import { BRAND } from "../../../../lib/brand.mjs";
import { channelColor } from "@/lib/channel-colors";


function aed(n: number) {
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function GuestRow({ guest, type }: { guest: any; type: "in" | "out" }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
      <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: channelColor(guest).bg }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm leading-tight">{guest.guestName}</div>
        <div className="text-xs text-muted-foreground truncate">{guest.propertyName} · {guest.unitNumber}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-medium text-muted-foreground">{guest.nights}n</div>
        <div className="text-xs font-semibold text-emerald-600">{aed(guest.revenue)}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: response, isLoading } = useGetDashboardSummary();
  const data = response as (NonNullable<typeof response> & {
    monthRevenue?: number;
    todayArrivals?: Array<{id:number;guestName:string;propertyName:string;unitNumber:string;nights:number;revenue:number;platform:string;paymentStatus:string}>;
    todayDepartures?: Array<{id:number;guestName:string;propertyName:string;unitNumber:string;nights:number;revenue:number;platform:string;paymentStatus:string}>;
    upcomingArrivals?: Array<{id:number;guestName:string;propertyName:string;checkIn:string}>;
    propertyGrid?: Array<{id:number;name:string;unitNumber:string;occupied:boolean;currentGuest:string;checkOut:string}>;
    urgentMaintenance?: Array<{id:number;issue:string;propertyName:string}>;
    urgentCleaning?: Array<{id:number;propertyName:string}>;
    topProperties?: Array<{id:number;name:string;revenue:number;occupancy:number}>;
  }) | undefined;
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = format(now, "EEEE, MMMM d, yyyy");

  const apiArrivals: any[] = data?.todayArrivals ?? [];
  const apiDepartures: any[] = data?.todayDepartures ?? [];
  const apiUpcoming: any[] = data?.upcomingArrivals ?? [];
  const propGrid: any[] = data?.propertyGrid ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Link href="/task-centre"><Button variant="outline" className="mb-3">Open Task Centre</Button></Link>
      <AirbnbIncome/>

      {/* ── Today's Priorities — built from real urgent issues ── */}
      {!isLoading && (() => {
        const urgentItems = [
          ...(data?.urgentMaintenance ?? []).map((m: any) => ({
            id: `m-${m.id}`, href: "/maintenance",
            icon: "🔧", badge: "URGENT",
            badgeColor: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
            color: "bg-red-50 dark:bg-red-950/20 border-red-300",
            title: m.issue ?? "Maintenance required",
            desc: m.propertyName ?? "",
          })),
          ...(data?.urgentCleaning ?? []).map((c: any) => ({
            id: `c-${c.id}`, href: "/cleaning",
            icon: "🧹", badge: "OVERDUE",
            badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
            color: "bg-amber-50 dark:bg-amber-950/20 border-amber-300",
            title: "Cleaning overdue",
            desc: c.propertyName ?? "",
          })),
        ];
        return urgentItems.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="font-semibold text-sm">Today's Priorities</span>
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5">{urgentItems.length}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">{format(now, "EEEE, MMM d")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {urgentItems.map(p => (
                <Link key={p.id} href={p.href}>
                  <div className={`rounded-xl border-l-4 px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity ${p.color}`}>
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="text-base leading-none">{p.icon}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${p.badgeColor}`}>{p.badge}</span>
                    </div>
                    <div className="text-xs font-semibold leading-snug">{p.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{p.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 flex items-center gap-3">
            <div className="text-xl">✅</div>
            <div>
              <div className="font-medium text-sm">No urgent cleaning or maintenance</div>
              <div className="text-xs text-muted-foreground mt-0.5">Check Task Centre for guest IDs, payments and upcoming work.</div>
            </div>
            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{format(now, "EEEE, MMM d")}</span>
          </div>
        );
      })()}

      {/* ── Hero Banner ─────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0f2a3f] via-[#0d3d4f] to-[#0a5c5c] text-white p-5 relative overflow-hidden shadow-lg">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute -bottom-10 -right-2 w-28 h-28 rounded-full bg-teal-400/10" />
        <img src={logoPath} alt="" aria-hidden className="absolute right-5 bottom-3 w-24 h-24 opacity-[0.06] select-none pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <img src={logoPath} alt={BRAND} className="h-6 w-6 hidden sm:block" />
              <p className="text-teal-300 text-xs font-medium">{dateStr}</p>
            </div>
            <h1 className="text-xl font-bold mt-0.5">{greeting}, {firstName} 👋</h1>
            <p className="text-white/55 text-sm mt-0.5">Here's your portfolio at a glance.</p>
          </div>
          <div className="flex flex-row sm:flex-col gap-2 sm:items-end">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 text-center">
              <div className="text-[10px] text-white/55 uppercase tracking-wide font-medium">Month Revenue</div>
              <div className="text-lg font-bold text-teal-300">{aed(isLoading ? 0 : (data?.monthRevenue ?? 0))}</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 text-center">
              <div className="text-[10px] text-white/55 uppercase tracking-wide font-medium">Portfolio Total</div>
              <div className="text-lg font-bold text-white">{aed(isLoading ? 0 : (data?.totalRevenue ?? 0))}</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-4 grid grid-cols-4 sm:grid-cols-6 gap-2">
          {[
            { label: "Occupied",   value: isLoading ? null : (data?.occupiedUnits  ?? 0), icon: BedDouble,     hi: true },
            { label: "Available",  value: isLoading ? null : (data?.availableUnits ?? 0), icon: Building2,     hi: false },
            { label: "Check-ins",  value: isLoading ? null : (data?.todayCheckIns  ?? 0), icon: DoorOpen,      hi: (data?.todayCheckIns ?? 0) > 0 },
            { label: "Check-outs", value: isLoading ? null : (data?.todayCheckOuts ?? 0), icon: DoorClosed,    hi: false },
            { label: "Properties", value: isLoading ? null : (data?.totalProperties ?? 0), icon: TrendingUp,  hi: false },
            { label: "Active units",value: isLoading ? null : (data?.totalProperties ?? 0), icon: Shield,        hi: false },
          ].map(({ label, value, icon: Icon, hi }) => (
            <div key={label} className="bg-white/10 rounded-xl px-2 py-2 text-center">
              <Icon className={`h-3.5 w-3.5 mx-auto mb-1 ${hi ? "text-teal-300" : "text-white/50"}`} />
              {isLoading ? <div className="h-5 w-6 bg-white/10 rounded animate-pulse mx-auto" /> :
                <div className={`text-lg font-bold ${hi ? "text-teal-300" : "text-white"}`}>{value ?? 0}</div>}
              <div className="text-[10px] text-white/45 uppercase tracking-wide leading-none mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Zero-state: setup wizard CTA ── */}
      {!isLoading && (data?.totalProperties ?? 0) === 0 && (
        <div className="space-y-4">
          {/* Primary wizard CTA */}
          <Link href="/setup">
            <div className="bg-gradient-to-r from-teal-600 to-emerald-600 rounded-2xl p-6 cursor-pointer hover:opacity-95 transition-opacity group">
              <div className="flex items-center justify-between gap-4">
                <div className="text-white">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider opacity-80">First-time setup</span>
                  </div>
                  <h3 className="text-lg font-bold mb-1">Set up your workspace in 6 steps</h3>
                  <p className="text-sm opacity-80 max-w-md leading-snug">
                    Add your company details, first property owner, a property, and connect your booking channels.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-white/20 hover:bg-white/30 transition-colors text-white rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap group-hover:gap-3">
                  Start Setup <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          </Link>

          {/* Or jump directly to a module */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">Or go directly to a module:</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Building2, label: "Add a Property", desc: "Add it, then connect its calendars", href: "/properties", color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/40", border: "border-teal-200 dark:border-teal-800" },
                { icon: PlusCircle, label: "Add a Reservation", desc: "Log a booking or block a date", href: "/reservations", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/40", border: "border-blue-200 dark:border-blue-800" },
                { icon: Users, label: "Invite Your Team", desc: "Add cleaners, managers and staff", href: "/staff", color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-violet-200 dark:border-violet-800" },
                { icon: Link2, label: "Connect Channels", desc: "Sync Airbnb & Booking.com", href: "/platforms", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800" },
              ].map(({ icon: Icon, label, desc, href, color, bg, border }) => (
                <Link key={label} href={href}>
                  <div className={`${bg} ${border} border rounded-xl p-4 cursor-pointer hover:opacity-80 transition-opacity group h-full`}>
                    <Icon className={`h-5 w-5 ${color} mb-2`} />
                    <div className="font-semibold text-sm leading-tight">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1 leading-snug">{desc}</div>
                    <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${color}`}>
                      Go <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Today's Arrivals */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                  <DoorOpen className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <span className="font-semibold text-sm">Arrivals Today</span>
              </div>
              <Badge variant="secondary" className="text-xs">{apiArrivals.length}</Badge>
            </div>
            {isLoading ? (
              <div className="space-y-3">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : !apiArrivals.length ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <DoorOpen className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
                No arrivals today
              </div>
            ) : (
              apiArrivals.map((g: any) => <GuestRow key={g.id} guest={g} type="in" />)
            )}
          </CardContent>
        </Card>

        {/* Today's Departures */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-950 flex items-center justify-center">
                  <DoorClosed className="h-3.5 w-3.5 text-orange-600" />
                </div>
                <span className="font-semibold text-sm">Departures Today</span>
              </div>
              <Badge variant="secondary" className="text-xs">{apiDepartures.length}</Badge>
            </div>
            {isLoading ? (
              <div className="space-y-3">{Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : !apiDepartures.length ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <DoorClosed className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
                No departures today
              </div>
            ) : (
              apiDepartures.map((g: any) => <GuestRow key={g.id} guest={g} type="out" />)
            )}
          </CardContent>
        </Card>

        {/* Upcoming 7 days */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-950 flex items-center justify-center">
                  <CalendarRange className="h-3.5 w-3.5 text-violet-600" />
                </div>
                <span className="font-semibold text-sm">Next 7 Days</span>
              </div>
              <Link href="/reservations" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
                All <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {isLoading ? (
              <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : (
              <div className="space-y-1.5">
                {apiUpcoming.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: channelColor(r).bg }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight truncate">{r.guestName}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.propertyName}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {format(new Date(r.checkIn), "MMM d")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Property grid + Alerts ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Property occupancy grid */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-100 dark:bg-teal-950 flex items-center justify-center">
                    <Building2 className="h-3.5 w-3.5 text-teal-600" />
                  </div>
                  <span className="font-semibold text-sm">Property Status</span>
                  <Badge variant="outline" className="text-[10px]">{propGrid.length} units</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted border inline-block" />Available</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {propGrid.map((p: any) => (
                  <div key={p.id} className={`rounded-xl border-2 p-3 transition-colors ${p.occupied ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800" : "border-muted bg-muted/20"}`}>
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="font-semibold text-xs leading-tight truncate">{p.name}</span>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${p.occupied ? "bg-emerald-500" : "bg-slate-300"}`} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">{p.unitNumber} · {p.area ?? p.bedroomType}</div>
                    {p.occupied ? (
                      <div className="mt-1.5">
                        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">{p.currentGuest}</div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Moon className="h-2.5 w-2.5" />
                          until {p.checkOut ? format(new Date(p.checkOut), "MMM d") : "—"}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 text-[10px] text-muted-foreground">Available</div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ops strip + alerts */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Cleaning", value: data?.cleaningPending ?? 0, icon: Sparkles, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", href: "/cleaning" },
              { label: "Maintenance", value: data?.maintenanceOpen ?? 0, icon: Wrench, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30", href: "/maintenance" },
              { label: "Payments", value: data?.paymentsPending ?? 0, icon: CreditCard, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30", href: "/payments" },
            ].map(({ label, value, icon: Icon, color, bg, href }) => (
              <Link key={label} href={href}>
                <div className={`${bg} rounded-xl p-3 text-center cursor-pointer hover:opacity-80 transition-opacity border border-transparent hover:border-muted`}>
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
                </div>
              </Link>
            ))}
          </div>

          <Card>
            <CardContent className="pt-4 pb-4">
              {(() => {
                const alerts = [
                  ...(data?.urgentMaintenance ?? []).map((m: any) => ({
                    id: `m-${m.id}`, href: "/maintenance",
                    icon: Wrench, cls: "text-red-500 bg-red-50 dark:bg-red-950/20",
                    title: m.issue ?? "Maintenance issue",
                    desc: m.propertyName ?? "",
                  })),
                  ...(data?.urgentCleaning ?? []).map((c: any) => ({
                    id: `c-${c.id}`, href: "/cleaning",
                    icon: Sparkles, cls: "text-amber-500 bg-amber-50 dark:bg-amber-950/20",
                    title: "Cleaning overdue",
                    desc: c.propertyName ?? "",
                  })),
                ];
                return (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-100 dark:bg-red-950">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                      </div>
                      <span className="font-semibold text-sm">Urgent Alerts</span>
                      {alerts.length > 0 && (
                        <Badge variant="destructive" className="text-xs ml-auto">{alerts.length}</Badge>
                      )}
                    </div>
                    {alerts.length === 0 ? (
                      <div className="text-center py-3 text-muted-foreground">
                        <AlertTriangle className="h-6 w-6 mx-auto text-muted-foreground/20 mb-1.5" />
                        <p className="text-xs">No urgent alerts</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {alerts.map(a => (
                          <Link key={a.id} href={a.href}>
                            <div className={`flex items-start gap-2 ${a.cls} rounded-lg px-3 py-2 cursor-pointer hover:opacity-80`}>
                              <a.icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium leading-tight">{a.title}</div>
                                <div className="text-[11px] text-muted-foreground">{a.desc}</div>
                              </div>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Revenue spotlight */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <span className="font-semibold text-sm">Top Performers</span>
              </div>
              {(data?.topProperties?.length ?? 0) === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <TrendingUp className="h-6 w-6 mx-auto text-muted-foreground/20 mb-1.5" />
                  <p className="text-xs">Add properties to see performance</p>
                </div>
              ) : (data!.topProperties!.map((p: any, i: number) => (
                <div key={p.id} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-bold text-muted-foreground w-4">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{p.occupancy ?? 0}% occupancy</div>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-600 flex-shrink-0">{aed(p.monthlyRevenue ?? 0)}</span>
                </div>
              )))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
