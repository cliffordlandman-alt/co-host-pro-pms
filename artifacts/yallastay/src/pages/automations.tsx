import { GuestMessageQueue } from "@/components/GuestMessageQueue";
import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Trash2, Loader2, BookOpen, Sparkles, Wrench,
  CreditCard, CalendarCheck, MessageCircle, ArrowRight, Clock,
  CheckCircle2, TrendingUp, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AutomationRule {
  id: number;
  name: string;
  trigger: string;
  action: string;
  description: string;
  enabled: boolean;
  category: string;
  timeSaved: string;
  lastRun?: string;
  runCount?: number;
}

const DEFAULT_RULES: Omit<AutomationRule, "id" | "enabled">[] = [
  {
    trigger: "booking_created", action: "create_cleaning_task",
    name: "Auto-create cleaning on booking",
    description: "Automatically creates a cleaning task for checkout day when a new booking is confirmed.",
    category: "cleaning", timeSaved: "8 min/booking",
  },
  {
    trigger: "booking_created", action: "send_confirmation",
    name: "Send booking confirmation",
    description: "Sends a confirmation message to the guest immediately when a booking is created.",
    category: "messaging", timeSaved: "5 min/booking",
  },
  {
    trigger: "checkin_minus_24h", action: "send_checkin_instructions",
    name: "Send check-in instructions",
    description: "Sends check-in instructions, lockbox code, and WiFi details 24 hours before guest arrival.",
    category: "messaging", timeSaved: "5 min/booking",
  },
  {
    trigger: "checkout_minus_24h", action: "send_checkout_reminder",
    name: "Send checkout reminder",
    description: "Sends a friendly checkout reminder with instructions the day before departure.",
    category: "messaging", timeSaved: "3 min/booking",
  },
  {
    trigger: "checkout_completed", action: "request_review",
    name: "Request guest review",
    description: "Automatically sends a review request to guests 2 hours after checkout.",
    category: "reviews", timeSaved: "4 min/booking",
  },
  {
    trigger: "payment_received", action: "calculate_owner_payout",
    name: "Calculate owner payout on payment",
    description: "Calculates and logs the owner payout automatically, applying the agreed management fee percentage.",
    category: "finance", timeSaved: "15 min/payment",
  },
  {
    trigger: "maintenance_created", action: "notify_manager",
    name: "Notify manager on new maintenance",
    description: "Sends an in-app notification to the manager when a maintenance ticket is created.",
    category: "maintenance", timeSaved: "2 min/ticket",
  },
  {
    trigger: "cleaning_completed", action: "send_property_ready_alert",
    name: "Property ready alert after cleaning",
    description: "Notifies the manager when a cleaning task is marked complete and the property is guest-ready.",
    category: "cleaning", timeSaved: "3 min/task",
  },
  {
    trigger: "maintenance_cost_gt_500_aed", action: "request_owner_approval",
    name: "Request owner approval for large repairs",
    description: "Notifies the property owner and requests approval when a maintenance cost exceeds AED 500.",
    category: "maintenance", timeSaved: "20 min/ticket",
  },
  {
    trigger: "occupancy_below_50pct", action: "alert_manager",
    name: "Low occupancy revenue alert",
    description: "Creates a priority alert when a property falls below 50% occupancy in the next 30 days.",
    category: "revenue", timeSaved: "10 min/week",
  },
];

const CATEGORY_CONFIG: Record<string, { cls: string; dot: string; label: string }> = {
  cleaning:    { cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", dot: "bg-blue-500", label: "Cleaning" },
  messaging:   { cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", dot: "bg-violet-500", label: "Messaging" },
  reviews:     { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500", label: "Reviews" },
  finance:     { cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500", label: "Finance" },
  maintenance: { cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300", dot: "bg-orange-500", label: "Maintenance" },
  revenue:     { cls: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300", dot: "bg-teal-500", label: "Revenue" },
};

const CATEGORY_ICONS: Record<string, any> = {
  cleaning: Sparkles, messaging: MessageCircle, reviews: BookOpen,
  finance: CreditCard, maintenance: Wrench, revenue: TrendingUp,
};

const TRIGGER_LABELS: Record<string, string> = {
  booking_created:             "New Booking",
  checkin_minus_24h:           "24h Before Check-in",
  checkout_minus_24h:          "24h Before Check-out",
  checkout_completed:          "Guest Checks Out",
  payment_received:            "Payment Received",
  maintenance_created:         "Maintenance Logged",
  cleaning_completed:          "Cleaning Complete",
  maintenance_cost_gt_500_aed: "Repair Cost > AED 500",
  occupancy_below_50pct:       "Occupancy < 50%",
  checkin_today:               "Check-in Today",
  checkout_today:              "Check-out Today",
  low_occupancy:               "Low Occupancy",
  maintenance_high_cost:       "High Maintenance Cost",
};

const ACTION_LABELS: Record<string, string> = {
  create_cleaning_task:       "Create Cleaning Task",
  send_confirmation:          "Send Confirmation",
  send_checkin_instructions:  "Send Check-in Info",
  send_checkout_reminder:     "Send Checkout Reminder",
  request_review:             "Request Review",
  calculate_owner_payout:     "Calculate Owner Payout",
  notify_manager:             "Notify Manager",
  send_property_ready_alert:  "Send Ready Alert",
  request_owner_approval:     "Request Owner Approval",
  alert_manager:              "Create Revenue Alert",
};

async function fetchAutomations() {
  const r = await apiFetch(`${API}/api/automations`);
  return r.json();
}

export default function Automations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState("all");
  const { data: savedRules = [], isLoading } = useQuery({ queryKey: ["automations"], queryFn: fetchAutomations });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const r = await apiFetch(`${API}/api/automations/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiFetch(`${API}/api/automations/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  const rules: AutomationRule[] = savedRules.map((r: any) => ({
    ...r,
    ...DEFAULT_RULES.find(d => d.trigger === r.trigger && d.action === r.action),
  }));

  const filtered = filterCategory === "all" ? rules : rules.filter((r: any) => r.category === filterCategory);
  const enabledCount = rules.filter((r: any) => r.enabled).length;
  const totalTimeSaved = rules.filter((r: any) => r.enabled).length * 8;
  const categories = Array.from(new Set(DEFAULT_RULES.map(r => r.category)));

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <GuestMessageQueue/>


      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />Automations
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Checkout cleaning is automatic. Custom messaging rules require a connected delivery service.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Rules", val: rules.length, cls: "text-foreground" },
          { label: "Connected custom rules", val: 0, cls: "text-emerald-600" },
          { label: "Paused", val: rules.length - enabledCount, cls: rules.length - enabledCount > 0 ? "text-amber-600" : "text-muted-foreground" },
          { label: "Min Saved / Week", val: `~${totalTimeSaved}`, cls: "text-blue-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-xl font-bold ${s.cls}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterCategory("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
          All ({rules.length})
        </button>
        {categories.map(cat => {
          const cfg = CATEGORY_CONFIG[cat];
          const count = rules.filter((r: any) => r.category === cat).length;
          return (
            <button key={cat} onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${filterCategory === cat ? cfg.cls + " ring-1 ring-current" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Rules */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
            <Zap className="h-8 w-8 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-1">No automation rules yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add your first rule to start automating messages, cleaning tasks, and owner payouts.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Use the <strong>Add Rule</strong> button to create your first automation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rule: any, idx: number) => {
            const cat = rule.category ?? "other";
            const cfg = CATEGORY_CONFIG[cat] ?? { cls: "bg-gray-100 text-gray-700", dot: "bg-gray-400", label: cat };
            const CatIcon = CATEGORY_ICONS[cat] ?? Zap;
            const triggerLabel = TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
            const actionLabel = ACTION_LABELS[rule.action] ?? rule.action;

            return (
              <div key={rule.id ?? idx}
                className={`bg-card border rounded-xl p-4 transition-all hover:shadow-sm ${!rule.enabled ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${rule.enabled ? cfg.cls : "bg-muted text-muted-foreground"}`}>
                    <CatIcon className="h-4.5 w-4.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{rule.name}</span>
                        <Badge className={`text-[10px] px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          disabled checked={false}
                          onCheckedChange={checked => rule.id > 0 && toggleMutation.mutate({ id: rule.id, enabled: checked })}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                        <span className={`text-xs font-medium w-12 ${rule.enabled ? "text-emerald-600" : "text-muted-foreground"}`}>
                          Not connected
                        </span>
                        {rule.id > 0 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMutation.mutate(rule.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{rule.description}</p>

                    {/* Visual flow */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[11px] font-semibold text-foreground">{triggerLabel}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${rule.enabled ? cfg.cls : "bg-muted text-muted-foreground"}`}>
                        <CheckCircle2 className="h-3 w-3" />
                        <span className="text-[11px] font-semibold">{actionLabel}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 hidden sm:block" />
                      <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-1.5">
                        <Zap className="h-3 w-3" />
                        <span className="text-[11px] font-semibold">{rule.timeSaved ?? "Time saved"}</span>
                      </div>
                    </div>

                    {/* Metadata */}
                    {(rule.lastRun || rule.runCount) && (
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                        {rule.lastRun && <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />Last run: {rule.lastRun}</span>}
                        {rule.runCount && <span>· {rule.runCount} times triggered</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info banner */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
        <Zap className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800 dark:text-amber-300">
          <strong>Note:</strong> Automation execution requires connecting your messaging channels (WhatsApp Business, email). Rules are triggered in real-time as events occur. Connect channels under <strong>Settings → Integrations</strong>.
        </div>
      </div>
    </div>
  );
}
