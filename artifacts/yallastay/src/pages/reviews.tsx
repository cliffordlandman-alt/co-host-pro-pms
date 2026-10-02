import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProperties } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, MessageSquare, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { badgeStyle } from "@/lib/channel-colors";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchJson(path: string) {
  const res = await apiFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error("API error");
  return res.json();
}

// Channel badge colours come from the shared map in lib/channel-colors.ts.
const PLATFORM_LABELS: Record<string, string> = { airbnb: "Airbnb", booking_com: "Booking.com", direct: "Direct" };

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-4 w-4 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
      ))}
      <span className="ml-1 text-sm font-medium">{rating.toFixed(1)}</span>
    </div>
  );
}

export default function Reviews() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: properties } = useGetProperties();
  const [filterProperty, setFilterProperty] = useState("all");
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newReview, setNewReview] = useState({ guestName: "", propertyId: "", platform: "airbnb", rating: "5", comment: "", reviewDate: format(new Date(), "yyyy-MM-dd") });

  const url = filterProperty !== "all" ? `/api/reviews?propertyId=${filterProperty}` : "/api/reviews";
  const { data: reviews, isLoading } = useQuery({ queryKey: ["reviews", filterProperty], queryFn: () => fetchJson(url) });

  const respondMutation = useMutation({
    mutationFn: async ({ id, response }: { id: number; response: string }) => {
      const res = await apiFetch(`${API_BASE}/api/reviews/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response }) });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reviews"] }); setRespondingId(null); setResponseText(""); toast({ title: "Response saved" }); },
  });

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch(`${API_BASE}/api/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reviews"] }); setAddOpen(false); toast({ title: "Review added" }); },
  });

  const avgRating = reviews?.length ? (reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Guest Reviews</h1>
          {reviews?.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <StarRating rating={parseFloat(avgRating)} />
              <span className="text-sm text-muted-foreground">avg across {reviews.length} reviews</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterProperty} onValueChange={setFilterProperty}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All properties" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Review</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}</div>
      ) : reviews?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No reviews yet.</div>
      ) : (
        <div className="space-y-3">
          {[...reviews].reverse().map((r: any) => (
            <Card key={r.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold">{r.guestName}</span>
                      <Badge className="text-xs border" style={badgeStyle(r.platform)}>{PLATFORM_LABELS[r.platform] ?? r.platform}</Badge>
                      <span className="text-xs text-muted-foreground">{r.propertyName}</span>
                    </div>
                    <StarRating rating={r.rating} />
                    {r.comment && <p className="mt-2 text-sm text-foreground/80">{r.comment}</p>}
                    {r.response && (
                      <div className="mt-2 pl-3 border-l-2 border-primary/40">
                        <p className="text-xs font-medium text-primary mb-0.5">Your response</p>
                        <p className="text-sm text-muted-foreground">{r.response}</p>
                      </div>
                    )}
                    {respondingId === r.id && (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          placeholder="Write your response..."
                          value={responseText}
                          onChange={e => setResponseText(e.target.value)}
                          className="text-sm"
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => respondMutation.mutate({ id: r.id, response: responseText })} disabled={respondMutation.isPending}>
                            {respondMutation.isPending ? "Saving..." : "Save Response"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setRespondingId(null); setResponseText(""); }}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{format(parseISO(r.reviewDate), "MMM d, yyyy")}</span>
                    {!r.response && respondingId !== r.id && (
                      <Button size="sm" variant="outline" onClick={() => { setRespondingId(r.id); setResponseText(r.response ?? ""); }}>
                        <MessageSquare className="h-3.5 w-3.5 mr-1" />Respond
                      </Button>
                    )}
                    {r.response && respondingId !== r.id && (
                      <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setRespondingId(r.id); setResponseText(r.response ?? ""); }}>Edit response</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Review Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Guest name" value={newReview.guestName} onChange={e => setNewReview(p => ({ ...p, guestName: e.target.value }))} />
            <Select value={newReview.propertyId} onValueChange={v => setNewReview(p => ({ ...p, propertyId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
              <SelectContent>{properties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Select value={newReview.platform} onValueChange={v => setNewReview(p => ({ ...p, platform: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="airbnb">Airbnb</SelectItem>
                  <SelectItem value="booking_com">Booking.com</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newReview.rating} onValueChange={v => setNewReview(p => ({ ...p, rating: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["5", "4.5", "4", "3.5", "3", "2", "1"].map(r => <SelectItem key={r} value={r}>{r} stars</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input type="date" value={newReview.reviewDate} onChange={e => setNewReview(p => ({ ...p, reviewDate: e.target.value }))} />
            <Textarea placeholder="Guest comment (optional)" value={newReview.comment} onChange={e => setNewReview(p => ({ ...p, comment: e.target.value }))} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate({ ...newReview, propertyId: parseInt(newReview.propertyId), rating: parseFloat(newReview.rating) })} disabled={addMutation.isPending || !newReview.guestName || !newReview.propertyId}>
              {addMutation.isPending ? "Saving..." : "Add Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
