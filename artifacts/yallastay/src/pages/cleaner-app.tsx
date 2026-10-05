import { dubaiToday } from "@/lib/today-model";
import { CleaningProof } from "@/components/CleaningProof";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useGetCleaningTasks } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  Sparkles, 
  Clock, 
  CheckCircle2, 
  MapPin, 
  Loader2, 
  Camera, 
  ChevronRight,
  Plus,
  ArrowLeft,
  Calendar,
  User,
  MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: any }> = {
  completed:   { label: "Completed",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2 },
  in_progress: { label: "In Progress", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", icon: Loader2 },
  scheduled:   { label: "Scheduled",   cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", icon: Clock },
  pending:     { label: "Pending",     cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: Clock },
  dirty:       { label: "Dirty",       cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: Clock },
};

function TaskCard({ task, onUpdate }: { task: any; onUpdate: () => void }) {
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(task.notes || "");

  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  async function updateStatus(newStatus: string) {
    setUpdating(true);
    try {
      const body: any = { status: newStatus };
      if (newStatus === "completed") {
        body.completedAt = new Date().toISOString();
      }
      
      const res = await apiFetch(`${API_BASE}/api/cleaning/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: newStatus === "completed" ? "Cleaning complete ✓" : `Task marked as ${newStatus.replace("_", " ")}`, description: newStatus === "completed" ? "Ready for the operator’s inspection." : undefined });
      onUpdate();
    } catch {
      toast({ title: "Error updating task", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }

  async function saveNote() {
    setUpdating(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/cleaning/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Note saved" });
      setShowNote(false);
      onUpdate();
    } catch {
      toast({ title: "Error saving note", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="bg-card border rounded-2xl shadow-sm overflow-hidden mb-4">
      <div className={`h-1.5 ${task.status === "completed" ? "bg-emerald-500" : task.status === "in_progress" ? "bg-blue-500" : "bg-amber-500"}`} />
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate">{task.propertyName}</h3>
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm mt-0.5">
              <MapPin className="h-3.5 w-3.5" />
              <span>Unit {task.unitNumber || "N/A"}</span>
            </div>
          </div>
          <Badge className={`rounded-full px-2.5 py-0.5 whitespace-nowrap ${cfg.cls}`}>
            <Icon className={`h-3 w-3 mr-1 ${task.status === "in_progress" ? "animate-spin" : ""}`} />
            {cfg.label}
          </Badge>
        </div>

        {/* Schedule */}
        <div className="flex items-center gap-4 py-3 border-y bg-muted/20 -mx-4 px-4">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Scheduled</span>
            <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              {format(new Date(task.scheduledDate), "EEE, MMM d")} · {task.scheduledTime || "Time not set"}
            </span>
          </div>
          {task.completedAt && (
            <div className="flex flex-col border-l pl-4">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Completed</span>
              <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {format(new Date(task.completedAt), "h:mm a")}
              </span>
            </div>
          )}
        </div>

        {/* Guest Info */}
        {task.reservationId && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-primary/5 p-2 rounded-lg">
            <User className="h-4 w-4 text-primary" />
            <span>Next arrival time is not recorded</span>
          </div>
        )}

        {/* Notes */}
        {(task.notes || showNote) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Notes
              </span>
              {task.notes && !showNote && (
                <button onClick={() => setShowNote(true)} className="text-xs text-primary font-medium">Edit</button>
              )}
            </div>
            {showNote ? (
              <div className="space-y-2">
                <Textarea 
                  value={note} 
                  onChange={(e) => setNote(e.target.value)} 
                  placeholder="Add details about the cleaning..."
                  className="text-sm min-h-[80px]"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveNote} disabled={updating} className="flex-1">Save Note</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNote(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-xl leading-relaxed italic">
                "{task.notes}"
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 flex flex-col gap-2">
          {task.status === "pending" || task.status === "dirty" || task.status === "scheduled" ? (
            <Button 
              className="w-full h-12 text-base font-bold rounded-xl gap-2 shadow-sm shadow-blue-500/20" 
              onClick={() => updateStatus("in_progress")}
              disabled={updating}
            >
              <Loader2 className={`h-5 w-5 ${updating ? "animate-spin" : ""}`} />
              Start Cleaning
            </Button>
          ) : task.status === "in_progress" ? (
            <Button 
              className="w-full h-12 text-base font-bold rounded-xl gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-500/20" 
              onClick={() => updateStatus("completed")}
              disabled={updating}
            >
              <CheckCircle2 className={`h-5 w-5 ${updating ? "animate-spin" : ""}`} />
              Mark Complete
            </Button>
          ) : null}
          
          <div className="flex gap-2">
            {!showNote && !task.notes && (
              <Button 
                variant="outline" 
                className="flex-1 h-10 text-sm font-semibold rounded-xl gap-2" 
                onClick={() => setShowNote(true)}
              >
                <Plus className="h-4 w-4" /> Add Note
              </Button>
            )}
            <CleaningProof task={task} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CleanerApp() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: allTasks, isLoading, refetch } = useGetCleaningTasks();
  
  // Filter for tasks assigned to the current user
  const tasks = (allTasks ?? []).filter((t: any) => t.status !== "cancelled");
  const todayTasks=tasks.filter(t=>t.scheduledDate===dubaiToday());
  const doneToday=todayTasks.filter(t=>["completed","approved"].includes(t.status)).length;
  const pendingCount = tasks.filter((t: any) => !["completed","approved"].includes(t.status)).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-medium">Loading your tasks...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-10">
      {/* Mobile Top Bar */}
      <header className="bg-background border-b sticky top-0 z-30 px-4 py-4 safe-top">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Hi, {user?.name.split(" ")[0]}</h1>
              <p className="text-xs text-muted-foreground font-medium">
                {format(new Date(), "EEEE, MMMM do")}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard")} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto">
        <section className="today-panel mb-6"><p className="today-eyebrow">TODAY</p><div className="flex justify-between mt-3"><span className="text-3xl font-semibold">{todayTasks.length} jobs</span><span className="text-sm text-muted-foreground self-end">{doneToday} completed</span></div><div className="h-2 bg-muted rounded mt-4 overflow-hidden"><div className="bg-emerald-600 h-full transition-all" style={{width:`${todayTasks.length?doneToday/todayTasks.length*100:0}%`}}/></div><p className="text-xs text-muted-foreground mt-3">{todayTasks.length-doneToday} remaining today · Cleaner pay is not recorded in this system.</p></section>
        {/* Welcome Card */}
        <div className="mb-8">
          <h2 className="text-2xl font-extrabold tracking-tight mb-1">
            {pendingCount > 0 ? `You have ${pendingCount} tasks` : "All caught up!"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {pendingCount > 0 ? "Let's get these properties ready for guests." : "Great job! Check back later for new assignments."}
          </p>
        </div>

        {/* Task List */}
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <div className="text-center py-20 bg-card border border-dashed rounded-3xl">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <h3 className="font-bold text-lg">No Tasks Assigned</h3>
              <p className="text-muted-foreground text-sm max-w-[200px] mx-auto mt-2">
                When you are assigned a cleaning task, it will appear here.
              </p>
            </div>
          ) : (
            tasks.map((task: any) => (
              <TaskCard key={task.id} task={task} onUpdate={() => refetch()} />
            ))
          )}
        </div>
      </main>

      {/* Stats Quick View */}
      {tasks.length > 0 && (
        <div className="mt-6 bg-background/80 backdrop-blur-md border-t px-6 py-4 flex justify-around items-center safe-bottom z-20">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{tasks.length}</div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Total</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-lg font-bold text-amber-500">{pendingCount}</div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Pending</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-500">{tasks.length - pendingCount}</div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Done</div>
          </div>
        </div>
      )}
    </div>
  );
}
