import { apiFetch } from "@/lib/api-fetch";
import { useState, useRef } from "react";
import { useGetProperties, useGetStaff } from "@workspace/api-client-react";
import { Pager, usePagedList } from "@/components/Pager";
import { useUpload } from "@workspace/object-storage-web";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus, Wrench, Loader2, Info, Clock, CheckCircle2, AlertTriangle,
  User, MapPin, DollarSign, ThumbsUp, ThumbsDown, Phone, ImagePlus, X, Camera,
} from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-3.5 h-3.5 text-muted-foreground/40 hover:text-primary cursor-help transition-colors flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-center leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; bar: string }> = {
  emergency: { label: "Emergency", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", bar: "bg-red-500" },
  high:      { label: "High",      cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300", bar: "bg-orange-500" },
  medium:    { label: "Medium",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", bar: "bg-amber-400" },
  low:       { label: "Low",       cls: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400", bar: "bg-slate-300" },
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  reported:         { label: "Reported",          cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  in_progress:      { label: "In Progress",       cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  awaiting_approval:{ label: "Awaiting Approval", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  resolved:         { label: "Resolved",          cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  completed:        { label: "Completed",         cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  cancelled:        { label: "Cancelled",         cls: "bg-slate-100 text-slate-500" },
};

const CATEGORY_ICONS: Record<string, string> = {
  ac_heating: "❄️", plumbing: "🚿", access: "🔑", appliances: "🍽️",
  pool: "🏊", electrical: "⚡", wifi: "📶", structural: "🏗️",
};

function NewTicketModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: properties } = useGetProperties();
  const { data: staffList } = useGetStaff();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ propertyId: "", issue: "", priority: "medium", notes: "", assignedToId: "" });

  const maintenanceStaff = ((staffList ?? []) as any[]).filter(
    (s: any) => s.active && (s.role === "maintenance" || s.role === "admin" || s.role === "manager")
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading } = useUpload({
    basePath: `${API_BASE}/api/storage`,
    onSuccess: (response: { objectPath: string }) => {
      const url = `${API_BASE}/api/storage${response.objectPath}`;
      setPhotos(prev => [...prev, url]);
    },
    onError: () => toast({ title: "Photo upload failed", variant: "destructive" }),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
    files.forEach(f => uploadFile(f));
    e.target.value = "";
  }

  function removePhoto(url: string) {
    setPhotos(prev => prev.filter(u => u !== url));
  }

  async function handleSave() {
    if (!form.propertyId) { toast({ title: "Please select a property", variant: "destructive" }); return; }
    if (!form.issue.trim()) { toast({ title: "Please describe the issue", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/maintenance`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: parseInt(form.propertyId),
          issue: form.issue,
          priority: form.priority,
          notes: form.notes || undefined,
          photos: photos.length > 0 ? photos : undefined,
          assignedToId: (form.assignedToId && form.assignedToId !== "unassigned") ? parseInt(form.assignedToId) : undefined,
          status: (form.assignedToId && form.assignedToId !== "unassigned") ? "in_progress" : "reported",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Ticket created" });
      onSaved(); onClose();
    } catch {
      toast({ title: "Error creating ticket", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const activeProperties = (properties ?? []).filter((p: any) => p.status !== "archived");

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-red-500" />New Maintenance Ticket
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">

          {/* Property */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Property <span className="text-destructive">*</span>
              <InfoTip text="The property with the issue." />
            </Label>
            <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder={activeProperties.length === 0 ? "No properties yet…" : "Select property…"} />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {activeProperties.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}{p.unitNumber ? ` · ${p.unitNumber}` : ""}
                  </SelectItem>
                ))}
                {activeProperties.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    Add a property first from the Properties page.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Issue */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Issue Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="Describe the maintenance issue…"
              rows={3}
              value={form.issue}
              onChange={e => setForm(f => ({ ...f, issue: e.target.value }))}
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value="emergency">🚨 Emergency</SelectItem>
                <SelectItem value="high">🔴 High</SelectItem>
                <SelectItem value="medium">🟡 Medium</SelectItem>
                <SelectItem value="low">🟢 Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Assign To */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Assign To
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select value={form.assignedToId} onValueChange={v => setForm(f => ({ ...f, assignedToId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Leave unassigned…" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value="unassigned">— Unassigned</SelectItem>
                {maintenanceStaff.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.role !== "maintenance" ? ` (${s.role})` : ""}
                  </SelectItem>
                ))}
                {maintenanceStaff.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    No maintenance staff added yet.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 text-muted-foreground" />
              Photos
              <span className="text-xs text-muted-foreground font-normal">(up to 3)</span>
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex gap-2 flex-wrap">
              {photos.map((url, i) => (
                <div key={url} className="relative group w-20 h-20 rounded-lg overflow-hidden border">
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(url)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}
              {photos.length < 3 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary hover:bg-muted/30 transition-colors disabled:opacity-50 text-muted-foreground"
                >
                  {isUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="h-5 w-5" />
                      <span className="text-[10px]">Add photo</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Additional Notes</Label>
            <Textarea
              placeholder="Vendor info, access notes…"
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || isUploading}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || isUploading}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Create Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitQuoteModal({ ticket, onClose, onSaved }: { ticket: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ quoteAmount: "", quotedBy: "" });

  async function handleSave() {
    if (!form.quoteAmount) { toast({ title: "Please enter amount", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/maintenance/${ticket.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteAmount: parseFloat(form.quoteAmount),
          quotedBy: form.quotedBy,
          status: "awaiting_approval",
          ownerApproval: "pending"
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Quote submitted" });
      onSaved(); onClose();
    } catch {
      toast({ title: "Error submitting quote", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Submit Quote</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Quote Amount (AED)</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="number"
                className="flex h-10 w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="0.00"
                value={form.quoteAmount}
                onChange={e => setForm(f => ({ ...f, quoteAmount: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Vendor / Quoted By</Label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="e.g. Acme Plumbing"
              value={form.quotedBy}
              onChange={e => setForm(f => ({ ...f, quotedBy: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceCard({ ticket, onUpdate }: { ticket: any; onUpdate: () => void }) {
  const { toast } = useToast();
  const { data: staffList } = useGetStaff();
  const [showQuote, setShowQuote] = useState(false);
  const [updating, setUpdating] = useState(false);

  const maintenanceStaff = ((staffList ?? []) as any[]).filter(
    (s: any) => s.active && (s.role === "maintenance" || s.role === "admin" || s.role === "manager")
  );

  const pri = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.medium;
  const st = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.reported;
  const catIcon = CATEGORY_ICONS[ticket.category] ?? "🔧";
  const needsApproval = ticket.ownerApproval === "pending" && ticket.quoteAmount > 0;
  const photos: string[] = Array.isArray(ticket.photos) ? ticket.photos : [];

  async function updateTicket(data: any) {
    setUpdating(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/maintenance/${ticket.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed");
      onUpdate();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-shadow hover:shadow-md ${needsApproval ? "border-violet-300 dark:border-violet-700" : ticket.priority === "emergency" ? "border-red-300 dark:border-red-700" : ""}`}>
      <div className={`h-1 ${pri.bar}`} />
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="text-xl flex-shrink-0">{catIcon}</div>
            <div className="min-w-0">
              <div className="font-semibold text-sm leading-tight">{ticket.issue}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{ticket.propertyName}</span>
                {ticket.unitNumber && <><span>·</span><span>Unit {ticket.unitNumber}</span></>}
              </div>
            </div>
          </div>
          <span className={`text-[11px] font-medium px-2 py-1 rounded-full flex-shrink-0 ${st.cls}`}>{st.label}</span>
        </div>

        {/* Priority + Time */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${pri.cls}`}>{pri.label}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(typeof ticket.createdAt === 'string' ? parseISO(ticket.createdAt) : new Date(ticket.createdAt), { addSuffix: true })}
          </span>
          {ticket.reportedBy && <span className="text-xs text-muted-foreground">by {ticket.reportedBy}</span>}
        </div>

        {/* Photos */}
        {photos.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {photos.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="block w-14 h-14 rounded-lg overflow-hidden border hover:opacity-80 transition-opacity flex-shrink-0">
                <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}

        {/* Notes */}
        {ticket.notes && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mb-3 leading-relaxed">
            {ticket.notes}
          </div>
        )}

        {/* Quote / Cost */}
        {ticket.quoteAmount > 0 && (
          <div className={`rounded-lg px-3 py-2.5 mb-3 flex items-center justify-between ${needsApproval ? "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800" : "bg-muted/40"}`}>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Quote / Cost</div>
              <div className={`text-base font-bold flex items-center gap-1 ${needsApproval ? "text-violet-700 dark:text-violet-300" : ""}`}>
                <DollarSign className="h-3.5 w-3.5" />AED {ticket.quoteAmount.toLocaleString()}
              </div>
              {ticket.quotedBy && <div className="text-xs text-muted-foreground mt-0.5">{ticket.quotedBy}</div>}
            </div>
            {needsApproval && (
              <div>
                <div className="text-[10px] font-bold text-violet-700 dark:text-violet-300 mb-1 text-right">OWNER APPROVAL</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                    onClick={() => updateTicket({ ownerApproval: "approved" })} disabled={updating}>
                    <ThumbsUp className="h-3 w-3" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => updateTicket({ ownerApproval: "rejected" })} disabled={updating}>
                    <ThumbsDown className="h-3 w-3" />Decline
                  </Button>
                </div>
              </div>
            )}
            {ticket.ownerApproval === "approved" && (
              <div className="flex items-center gap-1 text-xs text-emerald-600 font-medium text-right">
                <CheckCircle2 className="h-3.5 w-3.5" />Approved by {ticket.ownerName || "Owner"}
              </div>
            )}
            {ticket.ownerApproval === "rejected" && (
              <div className="flex items-center gap-1 text-xs text-red-600 font-medium text-right">
                <X className="h-3.5 w-3.5" />Rejected by {ticket.ownerName || "Owner"}
              </div>
            )}
          </div>
        )}

        {/* Vendor / Assignment */}
        <div className="flex items-center justify-between pt-2 border-t gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <User className="h-3 w-3 flex-shrink-0" />
            {!ticket.assignedToId ? (
              <Select onValueChange={v => updateTicket({ assignedToId: parseInt(v), status: "in_progress" })} disabled={updating}>
                <SelectTrigger className="h-7 text-[11px] border-none bg-transparent p-0 shadow-none focus:ring-0 w-auto hover:text-foreground">
                  <SelectValue placeholder="Assign…" />
                </SelectTrigger>
                <SelectContent>
                  {maintenanceStaff.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-medium text-foreground truncate">{ticket.assignedToName}</span>
            )}
          </div>

          <div className="flex gap-1.5 flex-shrink-0">
            {ticket.assignedToPhone && (
              <Button asChild size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1">
                <a href={`tel:${String(ticket.assignedToPhone).replace(/[^\d+]/g, "")}`}><Phone className="h-3 w-3" />Call</a>
              </Button>
            )}

            {ticket.status === "reported" && ticket.assignedToId && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1"
                onClick={() => updateTicket({ status: "in_progress" })} disabled={updating}>
                <Loader2 className={`h-3 w-3 ${updating ? "animate-spin" : ""}`} />Start
              </Button>
            )}

            {(ticket.status === "reported" || ticket.status === "in_progress") && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1"
                onClick={() => setShowQuote(true)} disabled={updating}>
                <DollarSign className="h-3 w-3" />Quote
              </Button>
            )}

            {ticket.status !== "resolved" && ticket.status !== "completed" && ticket.status !== "cancelled" ? (
              <>
                {ticket.status === "in_progress" && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                    onClick={() => updateTicket({ status: "resolved", completedAt: new Date().toISOString() })} disabled={updating}>
                    <CheckCircle2 className="h-3 w-3" />Resolve
                  </Button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />Resolved
              </div>
            )}
          </div>
        </div>
      </div>
      {showQuote && <SubmitQuoteModal ticket={ticket} onClose={() => setShowQuote(false)} onSaved={onUpdate} />}
    </div>
  );
}

export default function Maintenance() {
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("all");

  const requestedTicket=Number(new URLSearchParams(window.location.search).get("ticket"));
  // Filtering and paging run on the server (newest first); the stat cards are server counts over all tickets.
  const list = usePagedList<any, any>("maintenance", "maintenance", { filter, id: requestedTicket > 0 ? requestedTicket : null }, 24);
  const { isLoading, refetch } = list;
  const filtered = list.data?.items ?? [];
  const counts = list.data?.summary ?? { total: 0, emergency: 0, approval: 0, open: 0, resolved: 0 };

  return (
    <div className="p-4 md:p-6 space-y-5">
      {requestedTicket>0 && <a href="/maintenance" className="text-sm text-primary">← All maintenance jobs</a>}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6 text-red-500" />Maintenance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track repairs, approvals, and vendor assignments</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" />New Ticket
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Open Tickets", val: counts.open, cls: "text-foreground" },
          { label: "Emergency", val: counts.emergency, cls: counts.emergency > 0 ? "text-red-600" : "text-muted-foreground" },
          { label: "Awaiting Approval", val: counts.approval, cls: counts.approval > 0 ? "text-violet-600" : "text-muted-foreground" },
          { label: "Resolved", val: counts.resolved, cls: "text-emerald-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-2xl font-bold ${s.cls}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { val: "all", label: "All Tickets" },
          { val: "emergency", label: "🚨 Emergency" },
          { val: "awaiting_approval", label: "⏳ Awaiting Approval" },
          { val: "reported", label: "Reported" },
          { val: "in_progress", label: "In Progress" },
          { val: "resolved", label: "Resolved" },
        ].map(f => (
          <button key={f.val} onClick={() => setFilter(f.val)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.val ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl text-muted-foreground space-y-3">
          <Wrench className="h-10 w-10 mx-auto text-muted-foreground/30" />
          {list.isError ? (
            <p className="font-medium">Could not load maintenance tickets. Please refresh.</p>
          ) : counts.total === 0 ? (
            <>
              <p className="font-semibold text-sm text-foreground">No maintenance tickets</p>
              <p className="text-xs max-w-xs mx-auto">Report a repair, AC issue, or any property problem to track it through to resolution.</p>
            </>
          ) : (
            <p className="font-medium">No tickets match this filter</p>
          )}
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" />New Ticket</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t: any) => <MaintenanceCard key={t.id} ticket={t} onUpdate={() => refetch()} />)}
        </div>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} total={list.data.total} pageSize={list.data.pageSize} onPage={list.setPage} noun="tickets" busy={list.isFetching} />}

      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onSaved={() => refetch()} />}
    </div>
  );
}
