import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api-json";

/** DTCM guest registration status on a booking page (Dubai bookings only; Airbnb is never "pending"). */
export function DtcmRegistration({ reservationId }: { reservationId: number }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const q = useQuery<any>({ queryKey: ["dtcm-registration", reservationId], retry: false, queryFn: () => apiJson(`/api/compliance/registrations/${reservationId}`) });
  const d = q.data;
  if (!d || !d.status || (!d.dubai && !d.setByHand)) return null;
  async function set(status: string) {
    try { await apiJson(`/api/compliance/registrations/${reservationId}`, "PATCH", { status }); qc.invalidateQueries({ queryKey: ["dtcm-registration", reservationId] }); qc.invalidateQueries({ queryKey: ["task-centre"] }); toast({ title: "Registration status saved" }); }
    catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
  }
  return (
    <div data-testid="dtcm-registration" className="space-y-1.5">
      <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><ShieldCheck className="h-3 w-3" /> DTCM guest registration</label>
      <Select value={d.status} onValueChange={set}>
        <SelectTrigger className={`h-9 sm:w-60 ${d.status === "pending" ? "border-amber-400 bg-amber-50" : d.status === "registered" ? "border-emerald-300 bg-emerald-50" : ""}`} data-testid="dtcm-select"><SelectValue /></SelectTrigger>
        <SelectContent>{d.options.map((o: any) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
