import { BookingFinanceEditor } from "@/components/BookingFinanceEditor";
import { ReservationMoney, BookingExpenses } from "@/components/ReservationMoney";
import { guestIdComplete, idVerifiedByChannel, dtcmPassportNeeded } from "../../../../lib/guest-id.mjs";
import { apiFetch } from "@/lib/api-fetch";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useGetReservations, useGetProperties } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Calendar, Users, MapPin, Globe, CreditCard,
  FileText, CheckCircle2, Clock, Tag, Pencil, Save, X,
} from "lucide-react";
import { format, parseISO } from "date-fns";

const PLATFORM_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  airbnb:      { bg: "bg-red-100 dark:bg-red-950",     text: "text-red-700 dark:text-red-300",     label: "Airbnb" },
  booking_com: { bg: "bg-blue-100 dark:bg-blue-950",   text: "text-blue-700 dark:text-blue-300",   label: "Booking.com" },
  direct:      { bg: "bg-emerald-100 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", label: "Direct" },
  expedia:     { bg: "bg-amber-100 dark:bg-amber-950", text: "text-amber-700 dark:text-amber-300", label: "Expedia" },
};

const STATUS_OPTIONS = [
  {value:"blocked",label:"Blocked dates"},
  { value: "confirmed",   label: "Confirmed" },
  { value: "checked_in",  label: "Checked In" },
  { value: "checked_out", label: "Checked Out" },
  { value: "cancelled",   label: "Cancelled" },
];

const PAYMENT_OPTIONS = [
  {value:"unknown",label:"Not supplied by channel"},
  { value: "paid",    label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "pending", label: "Pending" },
];

const STATUS_STYLES: Record<string, string> = {
  confirmed:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  checked_in:  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  checked_out: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
  cancelled:   "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const PAYMENT_STYLES: Record<string, string> = {
  paid:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  pending: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const FLAG: Record<string, string> = {
  GB: "🇬🇧", ES: "🇪🇸", DE: "🇩🇪", JP: "🇯🇵", IT: "🇮🇹", IN: "🇮🇳", IE: "🇮🇪",
  PL: "🇵🇱", MX: "🇲🇽", EG: "🇪🇬", AU: "🇦🇺", US: "🇺🇸",
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <span className="text-sm text-muted-foreground min-w-[140px]">{label}</span>
      <div className="text-sm font-medium text-right flex-1">{children}</div>
    </div>
  );
}

export default function ReservationDetail() {
  const [, params] = useRoute("/reservations/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving,setSaving] = useState(false);

  const { data: reservations, isLoading } = useGetReservations();

  const id = params?.id ? parseInt(params.id) : null;
  const reservation = (reservations as any[])?.find((r: any) => r.id === id);
  const { data: properties } = useGetProperties();
  const property = (properties as any[])?.find((p: any) => p.id === reservation?.propertyId);
  const idChannel = reservation && !reservation.idCollected ? idVerifiedByChannel(reservation) : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  useEffect(() => {
    if (reservation && !draft) {
      setDraft({
        balanceDue: reservation.balanceDue ?? "",
        guestEmail: reservation.guestEmail ?? "",
        guestPhone: reservation.guestPhone ?? "",
        status: reservation.status,
        paymentStatus: reservation.paymentStatus,
        notes: reservation.notes ?? "",
        idCollected: reservation.idCollected ?? false,
      });
    }
  }, [reservation]);

  async function handleSave() {
    setSaving(true);
    try {
      const response = await apiFetch(`/api/reservations/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,balanceDue:draft.paymentStatus === "partial" ? draft.balanceDue : undefined})});
      const result = await response.json(); if(!response.ok) throw new Error(result.error);
      await queryClient.invalidateQueries(); setDraft(null); setEditing(false);
      toast({title:"Reservation updated"});
    } catch(e:any) {toast({title:"Could not save",description:e.message,variant:"destructive"});}
    finally {setSaving(false);}
  }

  function handleCancel() {
    if (reservation) {
      setDraft({
        balanceDue: reservation.balanceDue ?? "",
        guestEmail: reservation.guestEmail ?? "",
        guestPhone: reservation.guestPhone ?? "",
        status: reservation.status,
        paymentStatus: reservation.paymentStatus,
        notes: reservation.notes ?? "",
        idCollected: reservation.idCollected ?? false,
      });
    }
    setEditing(false);
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="space-y-3 mt-6">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 min-h-[40vh]">
        <FileText className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Reservation not found</p>
        <p className="text-sm text-muted-foreground">The booking #{id} doesn't exist or has been removed.</p>
        <Button variant="outline" onClick={() => setLocation("/reservations")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Reservations
        </Button>
      </div>
    );
  }

  const plat = PLATFORM_STYLES[reservation.platform] ?? PLATFORM_STYLES.direct;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/reservations")}
          data-testid="button-back-reservations"
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate" data-testid="reservation-detail-title">
            {reservation.guestName}
          </h1>
          <p className="text-xs text-muted-foreground font-mono">{reservation.bookingRef}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${plat.bg} ${plat.text}`}>
            {plat.label}
          </span>
          {!editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              data-testid="button-edit-reservation"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Stay summary card */}
      <div className="bg-card border rounded-xl p-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1 text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-xs">Check-in</span>
          </div>
          <div className="font-semibold text-sm">{format(parseISO(reservation.checkIn), "EEE, MMM d")}</div>
          <div className="text-xs text-muted-foreground">{format(parseISO(reservation.checkIn), "yyyy")}</div>
        </div>
        <div className="text-center border-x">
          <div className="flex items-center justify-center gap-1 mb-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">Duration</span>
          </div>
          <div className="font-bold text-lg">{reservation.nights}</div>
          <div className="text-xs text-muted-foreground">nights</div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1 text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-xs">Check-out</span>
          </div>
          <div className="font-semibold text-sm">{format(parseISO(reservation.checkOut), "EEE, MMM d")}</div>
          <div className="text-xs text-muted-foreground">{format(parseISO(reservation.checkOut), "yyyy")}</div>
        </div>
      </div>

      {/* Details card */}
      <div className="bg-card border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-1">Booking Details</h2>
        <div>
          <InfoRow label="Property">
            <div className="flex flex-col items-end">
              <span>{reservation.propertyName}</span>
              {reservation.propertyArea && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground font-normal mt-0.5">
                  <MapPin className="h-2.5 w-2.5" />{reservation.propertyArea}
                </span>
              )}
            </div>
          </InfoRow>
          <InfoRow label="Guest">
            <div className="flex items-center justify-end gap-1.5">
              <span>{FLAG[reservation.guestCountry] ?? <Globe className="h-3 w-3" />}</span>
              <span>{reservation.guestName}</span>
              {!guestIdComplete(reservation) ? (
                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full ml-1">
                  ID PENDING
                </span>
              ) : idChannel ? (
                <span className="text-[9px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full ml-1 whitespace-nowrap">
                  Verified by {idChannel}
                </span>
              ) : null}
            </div>
          </InfoRow>
          <InfoRow label="Guests">
            <div className="flex items-center justify-end gap-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{reservation.guests} guest{reservation.guests > 1 ? "s" : ""}</span>
            </div>
          </InfoRow>
          <ReservationMoney booking={reservation} full/>
          <BookingFinanceEditor booking={reservation}/>
          <BookingExpenses booking={reservation}/>
        </div>
      </div>

      {/* Editable fields card */}
      <div className="bg-card border rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold">Status &amp; Notes</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Tag className="h-3 w-3" /> Booking Status
            </label>
            {editing ? (
              <Select
                value={draft?.status}
                onValueChange={(v) => setDraft((d: any) => ({ ...d, status: v }))}
              >
                <SelectTrigger className="h-9" data-testid="select-booking-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[reservation.status] ?? STATUS_STYLES.confirmed}`}>
                  {STATUS_OPTIONS.find(o => o.value === reservation.status)?.label ?? reservation.status}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <CreditCard className="h-3 w-3" /> Payment Status
            </label>
            {editing ? (
              <Select
                value={draft?.paymentStatus}
                onValueChange={(v) => setDraft((d: any) => ({ ...d, paymentStatus: v }))}
              >
                <SelectTrigger className="h-9" data-testid="select-payment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${PAYMENT_STYLES[reservation.paymentStatus] ?? PAYMENT_STYLES.pending}`}>
                  {PAYMENT_OPTIONS.find(o => o.value === reservation.paymentStatus)?.label ?? reservation.paymentStatus}
                </span>
              </div>
            )}
          </div>
        </div>

        {editing && <div className="grid gap-3 sm:grid-cols-2">{["guestEmail","guestPhone"].map(key=><label key={key} className="text-sm">{key === "guestEmail" ? "Guest email" : "Guest phone"}<Input value={draft?.[key] ?? ""} onChange={e=>setDraft((d:any)=>({...d,[key]:e.target.value}))}/></label>)}{draft?.paymentStatus === "partial" && <label className="text-sm">Outstanding balance<Input type="number" min="0" step="0.01" value={draft?.balanceDue ?? ""} onChange={e=>setDraft((d:any)=>({...d,balanceDue:e.target.value}))}/></label>}</div>}
        {idChannel && <p className="text-sm text-emerald-700">Guest ID verified by {idChannel}. No ID copy is stored here.</p>}
        {dtcmPassportNeeded(reservation, property) && <p className="text-xs text-muted-foreground">DTCM registration: {idChannel} does not pass on the guest's passport copy, and Dubai guest registration still needs one. Once you have it, edit the booking and tick "ID / Passport Collected".</p>}
        {editing && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> ID / Passport Collected
            </label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="id-collected"
                checked={draft?.idCollected ?? false}
                onChange={(e) => setDraft((d: any) => ({ ...d, idCollected: e.target.checked }))}
                className="h-4 w-4 accent-primary"
                data-testid="checkbox-id-collected"
              />
              <label htmlFor="id-collected" className="text-sm">
                {draft?.idCollected ? "Collected" : "Not yet collected"}
              </label>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <FileText className="h-3 w-3" /> Notes
          </label>
          {editing ? (
            <Textarea
              value={draft?.notes ?? ""}
              onChange={(e) => setDraft((d: any) => ({ ...d, notes: e.target.value }))}
              placeholder="Add notes about this reservation…"
              rows={3}
              data-testid="textarea-notes"
            />
          ) : (
            <p className="text-sm text-foreground min-h-[2.5rem] leading-relaxed">
              {reservation.notes ? reservation.notes : (
                <span className="text-muted-foreground italic">No notes</span>
              )}
            </p>
          )}
        </div>

        {editing && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button disabled={saving} onClick={handleSave} data-testid="button-save-reservation" className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> Save Changes
            </Button>
            <Button variant="ghost" onClick={handleCancel} data-testid="button-cancel-edit">
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
