import { ReservationMoney, ServerBookingTotals } from "@/components/ReservationMoney";
import { Pager, usePagedList } from "@/components/Pager";
import { guestIdComplete, idVerifiedByChannel } from "../../../../lib/guest-id.mjs";
import { paymentLabel } from "../../../../lib/booking-labels.mjs";
import { useLocation } from "wouter";
import { DirectBookingDialog } from "@/components/DirectBookingDialog";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Search, Filter, MessageCircle, Sparkles, Eye,
  CreditCard, MapPin, Calendar, Users, Globe,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { entryBadgeLabel, entryBadgeStyle } from "@/lib/channel-colors";


const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  confirmed:   { label: "Confirmed",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  checked_in:  { label: "Checked In",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  checked_out: { label: "Checked Out", cls: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400" },
  cancelled:   { label: "Cancelled",   cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

const PAYMENT_STYLES: Record<string, { label: string; cls: string }> = {
  unknown: {label:"Not supplied by channel",cls:"bg-slate-100 text-slate-600"},
  channel: {label:"Collected by Airbnb",cls:"bg-emerald-50 text-emerald-700"},
  paid:    { label: "Paid",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  partial: { label: "Partial", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  pending: { label: "Pending", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

const CLEANING_STYLES: Record<string, { label: string; cls: string }> = {
  completed:   { label: "Done",       cls: "bg-emerald-100 text-emerald-700" },
  scheduled:   { label: "Scheduled",  cls: "bg-blue-100 text-blue-700" },
  pending:     { label: "Pending",    cls: "bg-amber-100 text-amber-700" },
  in_progress: { label: "In Progress",cls: "bg-purple-100 text-purple-700" },
  not_started: { label: "Not Started",cls: "bg-slate-100 text-slate-500" },
  overdue:     { label: "Overdue",    cls: "bg-red-100 text-red-700" },
};

const FLAG: Record<string, string> = {
  GB: "🇬🇧", ES: "🇪🇸", DE: "🇩🇪", JP: "🇯🇵", IT: "🇮🇹", IN: "🇮🇳", IE: "🇮🇪",
  PL: "🇵🇱", MX: "🇲🇽", EG: "🇪🇬", AU: "🇦🇺", US: "🇺🇸",
};

function aed(n: number) {
  return `AED ${n.toLocaleString()}`;
}

function QuickAction({ icon: Icon, label, onClick, variant = "ghost" }: {
  icon: any; label: string; onClick?: () => void; variant?: "ghost" | "outline";
}) {
  return (
    <Button size="sm" variant={variant} className="h-7 px-2 text-xs gap-1" onClick={onClick}>
      <Icon className="h-3 w-3" />{label}
    </Button>
  );
}

export default function Reservations() {
  const { toast } = useToast();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Search is sent to the server after a short pause; filtering, paging and all totals happen server-side.
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const list = usePagedList<any, any>("reservations", "reservations", { q, platform: filterPlatform, status: filterStatus, paymentStatus: filterPayment });
  const filtered = list.data?.items ?? [];
  const summary = list.data?.summary;
  const anyFilter = !!(q || filterPlatform !== "all" || filterStatus !== "all" || filterPayment !== "all");
  const pendingPayments = summary?.pendingPayments ?? 0;

  const [,navigate]=useLocation();
  function handleAction(label: string, res: any) {
    navigate(label === "Assign cleaning" ? "/cleaning" : label === "View payment" ? "/payments" : label === "Message guest" ? "/inbox" : `/reservations/${res.id}`);
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <DirectBookingDialog open={bookingOpen} onOpenChange={setBookingOpen} />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{summary ? `${summary.total} booking${summary.total === 1 ? "" : "s"}${anyFilter ? (summary.total === 1 ? " matches" : " match") : ""}` : "Loading…"}</p>
        </div>
        <Button className="gap-2" onClick={() => setBookingOpen(true)}>
          <Plus className="h-4 w-4" /> Add Reservation
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: anyFilter ? "Matching Bookings" : "Total Bookings", val: summary?.total ?? "…", cls: "text-foreground" },
          { label: "Verified finances (all matching)", val: <ServerBookingTotals finance={summary?.finance}/>, cls: "text-emerald-600" },
          { label: "Pending Payments", val: pendingPayments, cls: pendingPayments > 0 ? "text-amber-600" : "text-muted-foreground" },
          { label: "Platforms", val: summary?.platforms ?? "…", cls: "text-blue-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-xl font-bold ${s.cls}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search guest, property, booking ref…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={filterPlatform} onValueChange={setFilterPlatform}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="airbnb">Airbnb</SelectItem>
            <SelectItem value="booking_com">Booking.com</SelectItem>
            <SelectItem value="direct">Direct</SelectItem>
            <SelectItem value="expedia">Expedia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="checked_in">Checked In</SelectItem>
            <SelectItem value="checked_out">Checked Out</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPayment} onValueChange={setFilterPayment}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Payment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterPlatform !== "all" || filterStatus !== "all" || filterPayment !== "all") && (
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => { setSearch(""); setFilterPlatform("all"); setFilterStatus("all"); setFilterPayment("all"); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Reservations table */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Guest</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Property</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Platform</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Dates</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Cleaning</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Payment</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Booking / channel amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-muted-foreground">
                    {list.isLoading ? "Loading reservations…" : list.isError ? "Could not load reservations. Please refresh." : !anyFilter ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                          <Calendar className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">No reservations yet</p>
                          <p className="text-xs mt-1">Add your first property, then log bookings or connect Airbnb to sync automatically.</p>
                        </div>
                        <Button size="sm" className="gap-2 mt-1" onClick={() => setBookingOpen(true)}>
                          <Plus className="h-4 w-4" /> Add Reservation
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Filter className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                        No reservations match your filters
                      </>
                    )}
                  </td>
                </tr>
              ) : filtered.map(res => {
                const st = STATUS_STYLES[res.status] ?? STATUS_STYLES.confirmed;
                const payKey = paymentLabel(res).key;
                const pay = { ...(PAYMENT_STYLES[payKey] ?? PAYMENT_STYLES.pending), label: paymentLabel(res).label };
                const clean = CLEANING_STYLES[res.cleaningStatus] ?? CLEANING_STYLES.not_started;
                const isHovered = hoveredId === res.id;
                return (
                  <tr
                    key={res.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors group"
                    onMouseEnter={() => setHoveredId(res.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {res.guestName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm flex items-center gap-1.5">
                            {FLAG[res.guestCountry] ?? <Globe className="h-3 w-3" />}
                            {res.guestName}
                            {!guestIdComplete(res) ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">ID PENDING</span>
                            ) : !res.idCollected && idVerifiedByChannel(res) ? (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full whitespace-nowrap">Verified by {idVerifiedByChannel(res)}</span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">{res.externalId}</div>
                          {isHovered && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <QuickAction icon={Eye} label="View" onClick={() => handleAction("View booking", res)} />
                              <QuickAction icon={MessageCircle} label="Message" onClick={() => handleAction("Message guest", res)} />
                              <QuickAction icon={Sparkles} label="Cleaning" onClick={() => handleAction("Assign cleaning", res)} />
                              <QuickAction icon={CreditCard} label="Payment" onClick={() => handleAction("View payment", res)} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="font-medium text-sm leading-tight">{res.propertyName}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />{res.propertyArea}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs font-medium px-2 py-1 rounded-full border whitespace-nowrap" style={entryBadgeStyle(res)}>
                        {entryBadgeLabel(res)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="text-xs font-medium flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(res.checkIn), "MMM d")} – {format(new Date(res.checkOut), "MMM d")}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Users className="h-2.5 w-2.5" />{res.nights}n · {res.guests} guest{res.guests > 1 ? "s" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${clean.cls}`}>{clean.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${pay.cls}`}>{pay.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ReservationMoney booking={res}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {list.data && <Pager page={list.page} pages={list.data.pages} total={list.data.total} pageSize={list.data.pageSize} onPage={list.setPage} noun="bookings" busy={list.isFetching} />}

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <span className="flex items-center gap-1"><span className="font-mono bg-muted px-1.5 py-0.5 rounded">TD</span> = Tourism Dirham collected</span>
        <span>·</span>
        <span className="flex items-center gap-1"><span className="font-mono bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px]">ID PENDING</span> = Passport/ID not yet collected (Airbnb bookings are verified by Airbnb)</span>
      </div>
    </div>
  );
}
