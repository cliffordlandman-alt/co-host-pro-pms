import { CleaningProof } from "@/components/CleaningProof";
import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useGetCleaningTasks, useGetProperties, useGetStaff } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus, Loader2, Sparkles, Info, Clock, CheckCircle2, User,
  MapPin, AlertTriangle, Camera, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { dubaiToday } from "@/lib/today-model";

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-3.5 h-3.5 text-muted-foreground/40 hover:text-primary cursor-help transition-colors flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-center leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const isTaskOverdue = (t: any) => !["completed", "approved", "cancelled"].includes(t.status) && t.scheduledDate < dubaiToday();

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: any }> = {
  completed:   { label: "Completed",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2 },
  in_progress: { label: "In Progress", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", icon: Loader2 },
  scheduled:   { label: "Scheduled",   cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", icon: Clock },
  pending:     { label: "Pending",     cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: Clock },
  overdue:     { label: "Overdue",     cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: AlertTriangle },
  dirty:       { label: "Dirty",       cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: AlertTriangle },
  approved:    { label: "Approved",    cls: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: CheckCircle2 },
  cancelled:   { label: "Cancelled",   cls: "bg-muted text-muted-foreground", icon: AlertTriangle },
};

function NewTaskModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: properties } = useGetProperties();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    propertyId: "", scheduledDate: format(new Date(), "yyyy-MM-dd"), notes: "",
  });

  async function handleSave() {
    if (!form.propertyId) { toast({ title: "Please select a property", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/cleaning`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: parseInt(form.propertyId), scheduledDate: form.scheduledDate, notes: form.notes || undefined, status: "pending" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Cleaning task created" });
      onSaved(); onClose();
    } catch {
      toast({ title: "Error creating task", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />New Cleaning Task
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">Property <span className="text-destructive">*</span>
              <InfoTip text="The property that needs cleaning." />
            </Label>
            <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select property…" /></SelectTrigger>
              <SelectContent>
                {properties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} {p.unitNumber ? `· ${p.unitNumber}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduledDate" className="flex items-center gap-1.5">Scheduled Date <span className="text-destructive">*</span></Label>
            <Input id="scheduledDate" type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" placeholder="e.g. Replace all towels, check under beds, guest arrives at 3pm…" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CleaningCard({ task, cleaners }: { task: any; cleaners: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const checklist: string[] = Array.isArray(task.checklist) ? task.checklist.filter((i: unknown) => typeof i === "string") : [];
  const photoCount = Array.isArray(task.photos) ? task.photos.length : 0;
  const isDone = ["completed", "approved"].includes(task.status);
  const isClosed = ["approved", "cancelled"].includes(task.status);

  const isOverdue = !isDone && task.status !== "cancelled" && task.scheduledDate < dubaiToday();
  const isTurnover = !isDone && task.status !== "cancelled" && !!task.nextGuestCheckIn && task.nextGuestCheckIn === task.scheduledDate;
  const isUrgent = isOverdue || isTurnover;

  async function update(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/cleaning/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update the task");
      await qc.invalidateQueries();
      toast({ title: done });
    } catch (e: any) {
      toast({ title: "Could not update the task", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-shadow hover:shadow-md ${isUrgent ? "border-amber-300 dark:border-amber-700" : ""}`}>
      {/* Urgency bar */}
      <div className={`h-1 ${isOverdue ? "bg-red-500" : isUrgent ? "bg-amber-400" : task.status === "completed" ? "bg-emerald-500" : "bg-muted"}`} />
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{task.propertyName}</span>
              {isOverdue && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 rounded-full flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />OVERDUE
                </span>
              )}
              {isTurnover && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 rounded-full flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />SAME-DAY TURNOVER
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {task.area && <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{task.area}</span>}
              {task.area && task.unitNumber && <span>·</span>}
              {task.unitNumber && <span>Unit {task.unitNumber}</span>}
            </div>
          </div>
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0 ${cfg.cls}`}>
            <Icon className="h-3 w-3" />{cfg.label}
          </span>
        </div>

        {/* Schedule */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Clean by</div>
            <div className="text-sm font-semibold flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {format(new Date(task.scheduledDate), "MMM d")} {task.dueTime && `· ${task.dueTime}`}
            </div>
          </div>
          {task.nextGuestCheckIn && (
            <div className={`rounded-lg px-3 py-2 ${isUrgent ? "bg-amber-50 dark:bg-amber-950/30" : "bg-muted/50"}`}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Guest arrives</div>
              <div className={`text-sm font-semibold flex items-center gap-1 ${isUrgent ? "text-amber-700 dark:text-amber-300" : ""}`}>
                <Clock className="h-3 w-3" />
                {format(new Date(task.nextGuestCheckIn), "MMM d")} {task.nextGuestTime && `· ${task.nextGuestTime}`}
              </div>
            </div>
          )}
        </div>

        {/* Assigned */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <User className="h-3 w-3 text-muted-foreground" />
            </div>
            {isClosed ? (
              <span className="text-sm text-muted-foreground truncate">{task.assignedToName || "Unassigned"}</span>
            ) : (
              <Select value={task.assignedToId ? String(task.assignedToId) : ""} disabled={busy}
                onValueChange={v => update({ assignedToId: Number(v) }, "Cleaner assigned")}>
                <SelectTrigger className="h-8 text-sm w-full max-w-[200px]" aria-label="Assign cleaner">
                  <SelectValue placeholder={<span className="text-amber-600">Assign cleaner…</span>} />
                </SelectTrigger>
                <SelectContent>
                  {cleaners.length === 0 && task.assignedToId == null && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No active cleaners. Add one under Staff.</div>
                  )}
                  {task.assignedToId != null && !cleaners.some(c => c.id === task.assignedToId) && (
                    <SelectItem value={String(task.assignedToId)}>{task.assignedToName || `Staff #${task.assignedToId}`}</SelectItem>
                  )}
                  {cleaners.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          {checklist.length > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0"
              onClick={() => setExpanded(e => !e)}
            >
              Checklist {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Notes */}
        {task.notes && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mb-3 leading-relaxed">
            {task.notes}
          </div>
        )}

        {/* Checklist */}
        {expanded && checklist.length > 0 && (
          <ul className="border-t pt-3 mb-3 space-y-1.5 list-disc pl-5">
            {checklist.map((item, i) => <li key={i} className="text-xs">{item}</li>)}
          </ul>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          {!isDone && task.status !== "cancelled" && (
            <>
              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1" disabled={busy}
                onClick={() => update({ status: "completed" }, "Marked completed. Approve it after inspection.")}>
                <CheckCircle2 className="h-3 w-3" />Mark completed
              </Button>
              <CleaningProof task={task} />
            </>
          )}
          {task.status === "completed" && (
            <>
              <div className="w-full text-xs text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />Completed · {photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : "no photos yet"} · awaiting approval
              </div>
              <Button size="sm" className="flex-1 h-8 text-xs gap-1" disabled={busy}
                onClick={() => update({ status: "approved" }, "Clean approved. Unit is ready.")}>
                <CheckCircle2 className="h-3 w-3" />Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" disabled={busy}
                onClick={() => update({ status: "dirty" }, "Sent back for re-cleaning")}>
                Needs re-clean
              </Button>
              <CleaningProof task={task} />
            </>
          )}
          {task.status === "approved" && (
            <>
              <div className="flex-1 text-xs text-teal-700 dark:text-teal-300 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />Approved{photoCount ? ` · ${photoCount} photo${photoCount === 1 ? "" : "s"}` : ""}
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy}
                onClick={() => update({ status: "dirty" }, "Reopened for re-cleaning")}>
                Reopen
              </Button>
              {photoCount > 0 && (
                <div className="w-full flex flex-wrap gap-2">
                  {task.photos.map((src: string, i: number) => (
                    <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Cleaning proof ${i + 1}`} className="h-20 w-20 object-cover rounded" /></a>
                  ))}
                </div>
              )}
            </>
          )}
          {task.status === "cancelled" && (
            <div className="text-xs text-muted-foreground">Cancelled</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Cleaning() {
  const { data: apiTasks, isLoading, refetch } = useGetCleaningTasks();
  const { data: staff } = useGetStaff();
  const cleaners = ((staff ?? []) as any[]).filter(m => m.active !== false && m.role === "cleaner");
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("all");

  const tasks = (apiTasks ?? []) as any[];
  const requestedTask=Number(new URLSearchParams(window.location.search).get("task"));
  const filtered = (filter === "all" ? tasks : filter === "overdue" ? tasks.filter(isTaskOverdue) : filter === "pending" ? tasks.filter((t: any) => t.status === "pending" || t.status === "dirty") : tasks.filter((t: any) => t.status === filter)).filter((t:any)=>!requestedTask || t.id===requestedTask);

  const counts = {
    total: tasks.length,
    pending: tasks.filter((t: any) => t.status === "pending" || t.status === "dirty").length,
    inProgress: tasks.filter((t: any) => t.status === "in_progress").length,
    overdue: tasks.filter(isTaskOverdue).length,
    completed: tasks.filter((t: any) => t.status === "completed").length,
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      {requestedTask>0 && <a href="/cleaning" className="text-sm text-primary">← All cleaning jobs</a>}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />Cleaning Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track and manage all property cleaning schedules</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" />New Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", val: counts.total, cls: "text-foreground" },
          { label: "Pending", val: counts.pending, cls: counts.pending > 0 ? "text-amber-600" : "text-muted-foreground" },
          { label: "In Progress", val: counts.inProgress, cls: counts.inProgress > 0 ? "text-blue-600" : "text-muted-foreground" },
          { label: "Awaiting approval", val: counts.completed, cls: counts.completed > 0 ? "text-emerald-600" : "text-muted-foreground" },
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
          { val: "all", label: "All Tasks" },
          { val: "pending", label: "Pending" },
          { val: "overdue", label: "Overdue" },
          { val: "scheduled", label: "Scheduled" },
          { val: "in_progress", label: "In Progress" },
          { val: "completed", label: "Awaiting approval" },
          { val: "approved", label: "Approved" },
        ].map(f => (
          <button
            key={f.val}
            onClick={() => setFilter(f.val)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.val ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array(4).fill(0).map((_, i) => <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl text-muted-foreground space-y-3">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/30" />
          {tasks.length === 0 ? (
            <>
              <p className="font-semibold text-sm text-foreground">No cleaning tasks yet</p>
              <p className="text-xs max-w-xs mx-auto">Tasks are created automatically when a guest checks out, or you can add one manually.</p>
            </>
          ) : (
            <p className="font-medium">No tasks match this filter</p>
          )}
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" />New Task</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((task: any) => <CleaningCard key={task.id} task={task} cleaners={cleaners} />)}
        </div>
      )}

      {showNew && <NewTaskModal onClose={() => setShowNew(false)} onSaved={() => refetch()} />}
    </div>
  );
}
