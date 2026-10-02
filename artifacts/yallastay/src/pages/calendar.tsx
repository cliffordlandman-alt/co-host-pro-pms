import { ReservationMoney } from "@/components/ReservationMoney";
import { CalendarBookingLabel, calendarBookingName } from "@/components/CalendarBookingLabel";
import { CalendarBarsOverlay } from "@/components/CalendarBars";
import { layoutBars } from "@/lib/calendar-bars";
import { CHANNEL_COLORS, LEGEND, barStyle, channelColor, entryLabel } from "@/lib/channel-colors";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetReservations,
  useGetProperties,
  useUpdateReservation,
  getGetReservationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Plus, CalendarPlus, Pencil, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DirectBookingDialog } from "@/components/DirectBookingDialog";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  parseISO,
  differenceInCalendarDays,
} from "date-fns";

// Channel colours (Airbnb coral, Booking.com blue, Vrbo teal, direct green, owner stays purple, blocks grey) come from
// the shared map in lib/channel-colors.ts. Blocks never count as stays.

type Reservation = import("@workspace/api-client-react").Reservation;

export default function Calendar() {
  const [, setLocation] = useLocation();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCheckIn, setDialogCheckIn] = useState<string | undefined>(undefined);
  const [detailRes, setDetailRes] = useState<null | Reservation>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({
    guestName: "",
    checkIn: "",
    checkOut: "",
    revenue: "",
    notes: "",
  });
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateReservation = useUpdateReservation();

  const { data: reservations, isLoading: loadingRes } = useGetReservations();
  const { data: properties, isLoading: loadingProps } = useGetProperties();

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7));
    }
    return result;
  }, [calendarDays]);

  const filteredReservations = useMemo(() => {
    if (!reservations) return [];
    return reservations.filter((r) => {
      if (r.status === "cancelled") return false;
      if (selectedProperty !== "all" && r.propertyId !== parseInt(selectedProperty)) return false;
      return true;
    });
  }, [reservations, selectedProperty]);

  const propRes = (propertyId: number) => (reservations ?? []).filter(r => r.status !== "cancelled" && r.propertyId === propertyId);

  function openNewBooking(day: Date) {
    setDialogCheckIn(format(day, "yyyy-MM-dd"));
    setDialogOpen(true);
  }

  function openDetail(res: Reservation, e: React.MouseEvent) {
    e.stopPropagation();
    setDetailRes(res as any);
    setDetailOpen(true);
    setEditMode(false);
    setCancelConfirm(false);
  }

  function startEdit() {
    if (!detailRes) return;
    setEditValues({
      guestName: (detailRes as any).guestName ?? "",
      checkIn: (detailRes as any).checkIn ?? "",
      checkOut: (detailRes as any).checkOut ?? "",
      revenue: String((detailRes as any).revenue ?? ""),
      notes: (detailRes as any).notes ?? "",
    });
    setEditMode(true);
    setCancelConfirm(false);
  }

  function saveEdit() {
    if (!detailRes) return;
    if (!editValues.guestName.trim()) {
      toast({ title: "Guest name is required", variant: "destructive" });
      return;
    }
    if (editValues.checkOut <= editValues.checkIn) {
      toast({ title: "Check-out must be after check-in", variant: "destructive" });
      return;
    }
    const nights = Math.max(
      differenceInCalendarDays(parseISO(editValues.checkOut), parseISO(editValues.checkIn)),
      1
    );
    updateReservation.mutate(
      {
        id: (detailRes as any).id,
        data: {
          guestName: editValues.guestName,
          checkIn: editValues.checkIn,
          checkOut: editValues.checkOut,
          nights,

          notes: editValues.notes || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetReservationsQueryKey() });
          setDetailOpen(false);
          setEditMode(false);
          toast({ title: "Booking updated" });
        },
        onError: () => {
          toast({ title: "Failed to update booking", variant: "destructive" });
        },
      }
    );
  }

  function cancelBooking() {
    if (!detailRes) return;
    updateReservation.mutate(
      {
        id: (detailRes as any).id,
        data: { status: "cancelled" },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetReservationsQueryKey() });
          setDetailOpen(false);
          setCancelConfirm(false);
          toast({ title: "Booking cancelled" });
        },
        onError: () => {
          toast({ title: "Failed to cancel booking", variant: "destructive" });
        },
      }
    );
  }

  // One continuous bar per booking per week row (see lib/calendar-bars.ts), instead of one pill per day.
  function renderWeekBars(week: Date[], items: Reservation[], top: number, laneHeight: number, barHeight: number) {
    const { bars } = layoutBars(items as any[], week.map(d => format(d, "yyyy-MM-dd")));
    return (
      <CalendarBarsOverlay
        bars={bars}
        top={top}
        laneHeight={laneHeight}
        barHeight={barHeight}
        onOpen={(res: any, e) => openDetail(res, e)}
        look={(res: any) => ({ style: barStyle(res) })}
        label={(res: any) => <CalendarBookingLabel booking={res} />}
        title={(res: any) => `${calendarBookingName(res)} · ${res.propertyName ?? ""} · ${res.checkIn} → ${res.checkOut}`}
        testId={(res: any) => `reservation-bar-${res.id}`}
      />
    );
  }
  const weekLanes = (week: Date[], items: Reservation[]) => layoutBars(items as any[], week.map(d => format(d, "yyyy-MM-dd"))).lanes;

  const hasNoBookingsForProperty =
    !loadingRes &&
    selectedProperty !== "all" &&
    filteredReservations.length === 0;

  const isLoading = loadingRes || loadingProps;
  const isAllProperties = selectedProperty === "all";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Platform legend */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mr-2">
            {LEGEND.map(key => (
              <span key={key} className="flex items-center gap-1 text-xs" data-testid={`legend-${key}`}>
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CHANNEL_COLORS[key].bg }} />
                {CHANNEL_COLORS[key].label}
              </span>
            ))}
          </div>

          {/* Property filter */}
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger className="w-44" data-testid="select-property-filter">
              <SelectValue placeholder="All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties?.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => openNewBooking(new Date())} data-testid="button-new-direct-booking">
            <Plus className="h-4 w-4 mr-1" />
            Direct Booking
          </Button>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between bg-card border rounded-lg px-4 py-2">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} data-testid="button-prev-month">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="font-semibold text-lg" data-testid="text-current-month">
          {format(currentMonth, "MMMM yyyy")}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} data-testid="button-next-month">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Calendar */}
      {isAllProperties ? (
        /* ── Multi-property layout: one section per property ── */
        <div className="bg-card border rounded-lg overflow-hidden">
          {/* Column headers */}
          <div className="grid border-b" style={{ gridTemplateColumns: "88px repeat(7, 1fr)" }}>
            <div className="py-2 px-3 text-xs font-medium text-muted-foreground border-r bg-muted/30">
              Week
            </div>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {isLoading ? (
            <div>
              {Array(3).fill(0).map((_, pi) => (
                <div key={pi}>
                  <div className="px-3 py-2 border-b bg-muted/30">
                    <Skeleton className="h-4 w-32" />
                  </div>
                  {Array(2).fill(0).map((_, wi) => (
                    <div
                      key={wi}
                      className="grid border-b"
                      style={{ gridTemplateColumns: "88px repeat(7, 1fr)" }}
                    >
                      <div className="border-r px-2 py-1">
                        <Skeleton className="h-3 w-14" />
                      </div>
                      {Array(7).fill(0).map((_, di) => (
                        <div key={di} className="border-r last:border-r-0 px-1 py-1 min-h-[56px]">
                          <Skeleton className="h-5 w-full rounded" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            (properties ?? []).map((prop) => (
              <div key={prop.id} className="border-b last:border-b-0">
                {/* Property heading — appears once */}
                <div className="px-3 py-1.5 bg-muted/30 border-b flex items-center gap-2">
                  <span
                    className="text-[11px] font-semibold text-foreground tracking-wide uppercase"
                    title={prop.name}
                  >
                    {prop.name}
                  </span>
                </div>

                {/* One row per week */}
                {weeks.map((week, wi) => (
                  <div
                    key={wi}
                    className="grid border-b last:border-b-0"
                    style={{ gridTemplateColumns: "88px repeat(7, 1fr)" }}
                  >
                    {/* Week date range */}
                    <div className="border-r px-2 py-1 flex flex-col justify-center">
                      <span className="text-[10px] text-muted-foreground font-medium leading-tight">
                        {format(week[0], "MMM d")}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        – {format(week[6], "MMM d")}
                      </span>
                    </div>

                    {/* Day cells with continuous booking bars on top */}
                    {(() => {
                      const items = propRes(prop.id);
                      const minHeight = Math.max(48, 16 + weekLanes(week, items) * 18 + 4);
                      return (
                        <div className="relative col-span-7 grid grid-cols-7">
                          {week.map((day, di) => {
                            const inMonth = isSameMonth(day, currentMonth);
                            const isToday = isSameDay(day, new Date());
                            return (
                              <div
                                key={di}
                                data-testid={`multi-cal-${prop.id}-${format(day, "yyyy-MM-dd")}`}
                                onClick={() => inMonth && openNewBooking(day)}
                                style={{ minHeight }}
                                className={[
                                  "border-r last:border-r-0 px-0.5 py-0.5 transition-colors",
                                  inMonth ? "cursor-pointer hover:bg-muted/40" : "bg-muted/20 text-muted-foreground/40",
                                  isToday ? "ring-1 ring-inset ring-primary/50" : "",
                                ].join(" ")}
                              >
                                <div className="text-[10px] font-medium text-center text-muted-foreground/60">
                                  {format(day, "d")}
                                </div>
                              </div>
                            );
                          })}
                          {renderWeekBars(week, items, 16, 18, 16)}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        /* ── Single-property layout (original) ── */
        <div className="bg-card border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Days */}
          {isLoading ? (
            <div className="grid grid-cols-7">
              {Array(35).fill(0).map((_, i) => (
                <div key={i} className="h-28 border-b border-r p-1">
                  <Skeleton className="h-4 w-6 mb-1" />
                  <Skeleton className="h-5 w-full mb-1 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div>
              {weeks.map((week, wi) => {
                const minHeight = Math.max(112, 32 + weekLanes(week, filteredReservations) * 20 + 6);
                return (
                  <div key={wi} className="relative grid grid-cols-7">
                    {week.map((day, idx) => {
                      const inMonth = isSameMonth(day, currentMonth);
                      const isToday = isSameDay(day, new Date());
                      return (
                        <div
                          key={idx}
                          data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                          onClick={() => inMonth && openNewBooking(day)}
                          style={{ minHeight }}
                          className={[
                            "border-b border-r p-1 transition-colors",
                            inMonth ? "cursor-pointer hover:bg-muted/40" : "bg-muted/20 text-muted-foreground/50",
                            isToday ? "ring-2 ring-inset ring-primary" : "",
                          ].join(" ")}
                        >
                          <div className={[
                            "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                            isToday ? "bg-primary text-primary-foreground" : "",
                          ].join(" ")}>
                            {format(day, "d")}
                          </div>
                        </div>
                      );
                    })}
                    {renderWeekBars(week, filteredReservations, 32, 20, 18)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state: property selected but no bookings */}
      {hasNoBookingsForProperty && (
        <div className="rounded-xl border border-dashed bg-card/50 py-14 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <CalendarPlus className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-base">No bookings yet for this property</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Add a direct or offline booking to start tracking occupancy and revenue.
            </p>
          </div>
          <Button
            onClick={() => { setDialogCheckIn(undefined); setDialogOpen(true); }}
            data-testid="button-empty-state-add-booking"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add First Booking
          </Button>
        </div>
      )}

      {/* Direct Booking Dialog */}
      <DirectBookingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultPropertyId={selectedProperty !== "all" ? selectedProperty : undefined}
        defaultCheckIn={dialogCheckIn}
      />

      {/* Reservation Detail Dialog */}
      {detailRes && (
        <Dialog open={detailOpen} onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) { setEditMode(false); setCancelConfirm(false); }
        }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>
                  {editMode ? "Edit Booking" : calendarBookingName(detailRes as any)}
                </DialogTitle>
                <Badge className="border-0" style={{ background: channelColor(detailRes as any).bg, color: channelColor(detailRes as any).text }}>
                  {entryLabel(detailRes as any)}
                </Badge>
              </div>
            </DialogHeader>

            {editMode ? (
              /* ── Edit form ── */
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-guest-name">Guest Name</Label>
                  <Input
                    id="edit-guest-name"
                    data-testid="input-edit-guest-name"
                    value={editValues.guestName}
                    onChange={(e) => setEditValues((v) => ({ ...v, guestName: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-check-in">Check-in</Label>
                    <Input
                      id="edit-check-in"
                      type="date"
                      data-testid="input-edit-check-in"
                      value={editValues.checkIn}
                      onChange={(e) => setEditValues((v) => ({ ...v, checkIn: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-check-out">Check-out</Label>
                    <Input
                      id="edit-check-out"
                      type="date"
                      data-testid="input-edit-check-out"
                      value={editValues.checkOut}
                      onChange={(e) => setEditValues((v) => ({ ...v, checkOut: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="text-sm"><Button variant="outline" onClick={()=>setLocation(`/reservations/${(detailRes as any).id}`)}>Edit verified booking finances</Button></div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-notes">Notes</Label>
                  <Input
                    id="edit-notes"
                    data-testid="input-edit-notes"
                    placeholder="Optional notes"
                    value={editValues.notes}
                    onChange={(e) => setEditValues((v) => ({ ...v, notes: e.target.value }))}
                  />
                </div>
              </div>
            ) : cancelConfirm ? (
              /* ── Cancel confirmation ── */
              <div className="space-y-3">
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Are you sure you want to cancel this booking for{" "}
                  <strong>{calendarBookingName(detailRes as any)}</strong>? This will remove it from the calendar.
                </div>
              </div>
            ) : (
              /* ── Read-only view ── */
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Property</span>
                  <span className="font-medium">{(detailRes as any).propertyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Check-in</span>
                  <span className="font-medium">{format(parseISO((detailRes as any).checkIn), "EEE, MMM d yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Check-out</span>
                  <span className="font-medium">{format(parseISO((detailRes as any).checkOut), "EEE, MMM d yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nights</span>
                  <span className="font-medium">{(detailRes as any).nights}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revenue</span>
                  <ReservationMoney booking={detailRes}/>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <Badge variant={
                    (detailRes as any).paymentStatus === "paid" ? "default" :
                    (detailRes as any).paymentStatus === "partial" ? "secondary" : "outline"
                  }>
                    {(detailRes as any).paymentStatus}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline">{(detailRes as any).status?.replace("_", " ")}</Badge>
                </div>
                {(detailRes as any).notes && (
                  <div className="pt-1 border-t">
                    <span className="text-muted-foreground block mb-1">Notes</span>
                    <span>{(detailRes as any).notes}</span>
                  </div>
                )}
                {/* Cancel booking link — direct bookings only */}
                {(detailRes as any).platform === "direct" && (
                  <div className="pt-2 border-t">
                    <button
                      data-testid="button-cancel-booking-link"
                      onClick={() => setCancelConfirm(true)}
                      className="flex items-center gap-1.5 text-xs text-destructive hover:underline"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel this booking
                    </button>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 flex-col sm:flex-row">
              {editMode ? (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setEditMode(false)}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    data-testid="button-save-edit"
                    disabled={updateReservation.isPending}
                    onClick={saveEdit}
                  >
                    {updateReservation.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </>
              ) : cancelConfirm ? (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setCancelConfirm(false)}
                  >
                    Keep Booking
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    data-testid="button-confirm-cancel"
                    disabled={updateReservation.isPending}
                    onClick={cancelBooking}
                  >
                    {updateReservation.isPending ? "Cancelling…" : "Yes, Cancel"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setDetailOpen(false)}
                  >
                    Close
                  </Button>
                  {(detailRes as any).platform === "direct" && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      data-testid="button-edit-booking"
                      onClick={startEdit}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                  )}
                  <Button
                    className="flex-1"
                    data-testid="button-view-full-details"
                    onClick={() => {
                      setDetailOpen(false);
                      setLocation(`/reservations/${(detailRes as any).id}`);
                    }}
                  >
                    Full details
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
