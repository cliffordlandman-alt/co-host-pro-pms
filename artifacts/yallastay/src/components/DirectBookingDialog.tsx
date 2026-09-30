import { apiFetch } from "@/lib/api-fetch";
import { bedroomCount, bookingFinance } from "../../../../lib/booking-finance.mjs";
import { useEffect } from "react";
import {
  useGetProperties,
  useCreateReservation,
  getGetReservationsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, differenceInCalendarDays } from "date-fns";

const directBookingSchema = z
  .object({
    guestName: z.string().trim().min(1, "Guest name is required"),
    propertyId: z.string().min(1, "Property is required"),
    checkIn: z.string().min(1, "Check-in date is required"),
    checkOut: z.string().min(1, "Check-out date is required"),
    revenue: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a non-negative amount with up to 2 decimal places"),
    cleaningFee: z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "Enter a non-negative amount with up to 2 decimal places").optional(),
    managementPercent: z.string().min(1, "Enter the company percentage"),
    tourismRooms: z.string(),
    dubaiCharges: z.boolean(),
    notes: z.string().optional(),
  })
  .refine((data) => data.checkOut > data.checkIn, {
    message: "Check-out must be after check-in",
    path: ["checkOut"],
  });

type DirectBookingForm = z.infer<typeof directBookingSchema>;

interface DirectBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPropertyId?: string;
  defaultCheckIn?: string;
}

export function DirectBookingDialog({
  open,
  onOpenChange,
  defaultPropertyId,
  defaultCheckIn,
}: DirectBookingDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: properties } = useGetProperties();
  const createReservation = useCreateReservation();
  const {data:feeSettings} = useQuery({queryKey:["acc-settings"], queryFn:async()=>{const r=await apiFetch('/api/accounting/settings'); if(!r.ok) return []; return r.json();}});

  function getDefaults() {
    const today = format(new Date(), "yyyy-MM-dd");
    const checkIn = defaultCheckIn ?? today;
    const checkInDate = parseISO(checkIn);
    const checkOut = format(
      new Date(checkInDate.getFullYear(), checkInDate.getMonth(), checkInDate.getDate() + 1),
      "yyyy-MM-dd"
    );
    return { checkIn, checkOut };
  }

  const form = useForm<DirectBookingForm>({
    resolver: zodResolver(directBookingSchema),
    defaultValues: {
      guestName: "",
      propertyId: defaultPropertyId ?? "",
      ...getDefaults(),
      revenue: "",
      cleaningFee: "",
      managementPercent: "", tourismRooms: "", dubaiCharges: false,
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        guestName: "",
        propertyId: defaultPropertyId ?? "",
        ...getDefaults(),
        revenue: "",
        cleaningFee: "",
        managementPercent: "", tourismRooms: "", dubaiCharges: false,
      notes: "",
      });
    }
  }, [open, defaultPropertyId, defaultCheckIn]);

  const watched = form.watch();
  const property = properties?.find(p => String(p.id) === watched.propertyId) as any;
  const knownRooms = bedroomCount(property);
  const rules = feeSettings?.find((s:any)=>s.propertyId===property?.id);
  useEffect(() => {
    form.setValue("dubaiCharges", rules?.tourismEnabled ?? /dubai/i.test(property?.city || ""));
    form.setValue("managementPercent", String(rules?.managementFeePercent ?? property?.managementFee ?? ""));
    form.setValue("cleaningFee", String(property?.cleaningFee ?? ""));
    form.setValue("tourismRooms", knownRooms == null ? "" : String(knownRooms));
  }, [open, watched.propertyId, property?.city, knownRooms, rules?.propertyId, rules?.managementFeePercent]);
  let breakdown: any = null;
  let calculationError = "";
  try {
    breakdown = bookingFinance({ total: watched.revenue, managementPercent: watched.managementPercent,
      cleaningFee: watched.cleaningFee || 0, nights: differenceInCalendarDays(parseISO(watched.checkOut), parseISO(watched.checkIn)),
      rooms: knownRooms ?? Number(watched.tourismRooms), dubai: watched.dubaiCharges,
      vatRate: rules ? (rules.vatEnabled ? rules.vatPercent : 0) : watched.dubaiCharges ? 5 : 0,
      tourismRate: rules?.tourismRate ?? 10, channelPercent: rules?.platformFeeDirect ?? 0 });
  } catch (error) { calculationError = (error as Error).message; }
  const money = (n: number) => `${property?.currency || "AED"} ${n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;

  function onSubmit(values: DirectBookingForm) {
    if (!breakdown) { toast({title: calculationError, variant: "destructive"}); return; }
    const checkIn = parseISO(values.checkIn);
    const checkOut = parseISO(values.checkOut);
    const nights = differenceInCalendarDays(checkOut, checkIn);

    createReservation.mutate(
      {
        data: {
          guestName: values.guestName,
          platform: "direct",
          propertyId: parseInt(values.propertyId),
          checkIn: values.checkIn,
          checkOut: values.checkOut,
          nights: Math.max(nights, 1),
          ...breakdown,
          dubaiCharges: values.dubaiCharges,
          revenue: breakdown.revenue,
          cleaningFee: values.cleaningFee ? parseFloat(values.cleaningFee) : null,
          balanceDue: parseFloat(values.revenue),
          paymentStatus: "pending",
          status: "confirmed",
          notes: values.notes || null,
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          onOpenChange(false);
          toast({ title: "Direct booking created" });
          form.reset();
        },
        onError: (error: any) => {
          toast({ title: "Failed to create booking", description: error?.data?.error || error.message, variant: "destructive" });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Direct Booking</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="guestName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Guest Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. John Smith" data-testid="input-guest-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="propertyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Property</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-booking-property">
                        <SelectValue placeholder="Select property" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {properties?.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} — {p.unitNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="checkIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-in</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-check-in" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="checkOut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-out</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-check-out" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="revenue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Guest total (includes VAT & tourism)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="0.01" placeholder="0" data-testid="input-revenue" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cleaningFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cleaning deduction (AED)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="0.01" placeholder="0" data-testid="input-cleaning-fee" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField control={form.control} name="managementPercent" render={({field}) => (
              <FormItem><FormLabel>Company management fee (%)</FormLabel><FormControl><Input type="number" min="0" max="100" step="0.01" placeholder="e.g. 20" {...field}/></FormControl><FormMessage/></FormItem>
            )}/>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("dubaiCharges")}/>Tourism Dirham enabled</label>
            {watched.dubaiCharges && <div className="text-sm space-y-2">
              {knownRooms == null ? <FormField control={form.control} name="tourismRooms" render={({field}) => (
                <FormItem><FormLabel>Bedrooms (studio = 1)</FormLabel><FormControl><Input type="number" min="1" step="1" {...field}/></FormControl><FormMessage/></FormItem>
              )}/> : <p>{knownRooms} {knownRooms === 1 ? "room" : "rooms"} × AED 10 per night · maximum 30 nights</p>}
              <p className="text-xs text-muted-foreground">Tourism is removed first. VAT is extracted from the remaining total using this property’s fee settings.</p>
            </div>}
            {breakdown ? <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-2" aria-live="polite">
              {[["Guest total", breakdown.grossAmount], ["Tourism fee", breakdown.tourismFee], [`VAT (${breakdown.vatRate}%) included`, breakdown.vatAmount], ["Net booking revenue", breakdown.revenue], [`Company share (${breakdown.managementPercent}%)`, breakdown.managementAmount], ["Channel deduction", breakdown.channelAmount], ["Cleaning deduction", Number(watched.cleaningFee || 0)], ["Owner receives", breakdown.ownerAmount]].map(([label,value]) => <div className="flex justify-between gap-3" key={String(label)}><span>{label}</span><strong>{money(Number(value))}</strong></div>)}
            </div> : watched.revenue && watched.managementPercent ? <p role="alert" className="text-sm text-red-600">{calculationError}</p> : null}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional notes" data-testid="input-notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createReservation.isPending || !breakdown} data-testid="button-submit-booking">
                {createReservation.isPending ? "Saving..." : "Create Booking"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
