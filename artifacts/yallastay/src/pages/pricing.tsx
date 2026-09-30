import { apiFetch } from "@/lib/api-fetch";
/**
 * Dynamic Pricing Command Center
 * ─────────────────────────────────────────────
 * A PriceLabs-style revenue manager cockpit for YallaStay PMS.
 * Generates AI price suggestions using occupancy, lead time,
 * day-of-week, UAE events, and property data — all client-side.
 */

import { useState, useMemo, useEffect } from "react";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Zap,
  Calendar, Settings, Users2, Bell, ChevronLeft, ChevronRight,
  DollarSign, BarChart2, Clock, Lock, Unlock, Plus, Sparkles,
  ArrowRight, Info, Eye, Check, X, Filter, Loader2, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  addDays, addMonths, subMonths, format, getDaysInMonth,
  startOfMonth, getDay, isSaturday, isSunday, parseISO, isWithinInterval,
} from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// API CLIENT
// ─────────────────────────────────────────────────────────────────────────────
const fetchRules = async () => {
  const res = await apiFetch("/api/pricing/rules");
  if (!res.ok) throw new Error("Failed to fetch rules");
  return res.json() as Promise<{ propertyId: number; rules: PricingRuleSet }[]>;
};

const saveRules = async ({ propertyId, rules }: { propertyId: number; rules: PricingRuleSet }) => {
  const res = await apiFetch(`/api/pricing/rules/${propertyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error("Failed to save rules");
  return res.json();
};

// ─────────────────────────────────────────────────────────────────────────────
// UAE DEMAND EVENTS — drives markup/markdown logic
// ─────────────────────────────────────────────────────────────────────────────
const UAE_EVENTS = [
  { name: "New Year's Eve / New Year",  start: "2025-12-31", end: "2026-01-02", markup: 0.45, demand: "extreme" as const, color: "text-rose-500" },
  { name: "Dubai Shopping Festival",    start: "2025-12-26", end: "2026-02-08", markup: 0.22, demand: "high" as const,   color: "text-blue-500" },
  { name: "Eid Al Fitr",                start: "2026-03-30", end: "2026-04-03", markup: 0.38, demand: "extreme" as const, color: "text-emerald-500" },
  { name: "F1 Abu Dhabi Grand Prix",    start: "2025-12-05", end: "2025-12-08", markup: 0.32, demand: "high" as const,   color: "text-red-500" },
  { name: "GITEX Global",               start: "2026-10-12", end: "2026-10-16", markup: 0.28, demand: "high" as const,   color: "text-violet-500" },
  { name: "Eid Al Adha",                start: "2026-06-06", end: "2026-06-11", markup: 0.35, demand: "extreme" as const, color: "text-emerald-500" },
  { name: "Gulf Food",                  start: "2026-02-16", end: "2026-02-20", markup: 0.15, demand: "medium" as const, color: "text-amber-500" },
  { name: "Dubai Marathon",             start: "2026-01-11", end: "2026-01-11", markup: 0.12, demand: "medium" as const, color: "text-sky-500" },
  { name: "Ramadan",                    start: "2026-02-18", end: "2026-03-19", markup: -0.20, demand: "low" as const,   color: "text-slate-400" },
  { name: "National Day UAE",           start: "2025-12-02", end: "2025-12-03", markup: 0.20, demand: "high" as const,   color: "text-green-500" },
];

function getEventForDate(date: Date) {
  return UAE_EVENTS.find(e =>
    isWithinInterval(date, { start: parseISO(e.start), end: parseISO(e.end) })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PRICE ENGINE
// Given a property and a date, calculate a suggested nightly price.
// ─────────────────────────────────────────────────────────────────────────────
function suggestPrice(property: PricingProperty, date: Date, rules: PricingRuleSet): number {
  let price = rules.baseRate;

  // Weekend markup (Fri/Sat nights in UAE = high demand)
  if (isFriday(date) || isSaturday(date)) {
    price *= 1 + rules.weekendMarkup / 100;
  }

  // UAE event markup/markdown
  const event = getEventForDate(date);
  if (event) {
    price *= 1 + event.markup;
  }

  // Occupancy-based adjustments
  if (property.occupancy30d >= 85) {
    price *= 1 + rules.highDemandMarkup / 100;   // high demand, push price up
  } else if (property.occupancy30d < 55) {
    price *= 1 - rules.lowOccDiscount / 100;     // low occupancy, discount
  }

  // Lead time: last-minute discount (within 3 days)
  const daysOut = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (daysOut >= 0 && daysOut <= 3) {
    price *= 1 - rules.lastMinuteDiscount / 100;
  }

  // Gap night discount (isolated 1-night gap)
  if (daysOut >= 0 && daysOut <= 1) {
    price *= 0.88;
  }

  // Clamp to min/max
  return Math.round(Math.max(rules.minRate, Math.min(rules.maxRate, price)));
}

function isFriday(d: Date) { return getDay(d) === 5; }

interface PricingProperty {
  id: number; name: string; area: string; type: string; bedrooms: number;
  currentRate: number; minRate: number; maxRate: number;
  suggestedRate: number; confidence: number;
  status: "good" | "too_low" | "too_high" | "needs_action";
  occupancy30d: number; occupancy7d: number; adr: number; revpar: number;
  availability7d: number; availability30d: number;
  lastBookingDaysAgo: number; aiExplanation: string;
  platforms: string[];
}

interface PricingRuleSet {
  baseRate: number; minRate: number; maxRate: number;
  weekendMarkup: number; lastMinuteDiscount: number;
  highDemandMarkup: number; lowOccDiscount: number; minStay: number;
}


const PRICING_PROPERTIES: PricingProperty[] = [];

const DEFAULT_RULES: Record<number, PricingRuleSet> = {};

const SMART_ALERTS: { id: number; severity: "critical"|"high"|"medium"|"low"; property: string; area: string; icon: string; impact: string; message: string; reason: string; action: string|null; applied: boolean }[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  good:         { label: "Good",         cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2, bar: "bg-emerald-500" },
  too_low:      { label: "Too Low",      cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: TrendingDown, bar: "bg-red-500" },
  too_high:     { label: "Too High",     cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: TrendingUp, bar: "bg-amber-500" },
  needs_action: { label: "Needs Action", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", icon: AlertTriangle, bar: "bg-violet-500" },
};

function aed(n: number) { return `AED ${n.toLocaleString()}`; }

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE IMPACT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function RevenueImpactModal({ property, onClose, onApply }: {
  property: PricingProperty; onClose: () => void; onApply: () => void;
}) {
  const nights = property.availability30d;
  const currentRev = nights * property.currentRate;
  const suggestedRev = nights * property.suggestedRate;
  const diff = suggestedRev - currentRev;
  const pct = property.suggestedRate > property.currentRate
    ? Math.round((property.suggestedRate / property.currentRate - 1) * 100)
    : Math.round((1 - property.suggestedRate / property.currentRate) * 100);
  const isIncrease = property.suggestedRate > property.currentRate;
  const risk = isIncrease ? (pct > 20 ? "Medium" : "Low") : "Low";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />Revenue Impact Preview
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-sm font-medium">{property.name}</div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/60 rounded-xl p-4">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current Expected</div>
              <div className="text-lg font-bold">{aed(currentRev)}</div>
              <div className="text-xs text-muted-foreground">{nights} nights × {aed(property.currentRate)}</div>
            </div>
            <div className={`rounded-xl p-4 ${isIncrease ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-blue-50 dark:bg-blue-950/30"}`}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">AI Suggested</div>
              <div className={`text-lg font-bold ${isIncrease ? "text-emerald-600" : "text-blue-600"}`}>{aed(suggestedRev)}</div>
              <div className="text-xs text-muted-foreground">{nights} nights × {aed(property.suggestedRate)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Difference</div>
              <div className={`text-xl font-bold ${diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {diff >= 0 ? "+" : ""}{aed(diff)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Risk Level</div>
              <Badge className={risk === "Low" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{risk}</Badge>
            </div>
          </div>

          <div className="bg-violet-50 dark:bg-violet-950/20 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-violet-700 dark:text-violet-300 leading-relaxed">{property.aiExplanation}</p>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Every price change is logged to the audit trail. You can revert at any time from the calendar view.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onApply} className="gap-2">
            <Check className="h-4 w-4" />Apply {isIncrease ? "Increase" : "Discount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY PRICING CARD
// ─────────────────────────────────────────────────────────────────────────────
function PropertyPricingCard({ property, onReview }: {
  property: PricingProperty; onReview: (p: PricingProperty) => void;
}) {
  const { toast } = useToast();
  const [aiOpen, setAiOpen] = useState(false);
  const cfg = STATUS_CONFIG[property.status];
  const StatusIcon = cfg.icon;
  const isIncrease = property.suggestedRate > property.currentRate;
  const delta = Math.abs(property.suggestedRate - property.currentRate);
  const deltaPct = Math.round(delta / property.currentRate * 100);

  return (
    <div className={`bg-card border rounded-2xl overflow-hidden hover:shadow-lg transition-all group ${property.status === "needs_action" ? "border-violet-300 dark:border-violet-800" : property.status === "too_low" ? "border-red-200 dark:border-red-900" : ""}`}>
      <div className={`h-1 ${cfg.bar}`} />
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">{property.name}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${cfg.cls}`}>
                <StatusIcon className="h-2.5 w-2.5" />{cfg.label}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{property.area} · {property.type}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Confidence</div>
            <div className={`text-sm font-bold ${property.confidence >= 85 ? "text-emerald-600" : property.confidence >= 70 ? "text-amber-600" : "text-red-500"}`}>
              {property.confidence}%
            </div>
          </div>
        </div>

        {/* Rate comparison */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-muted/50 rounded-xl px-3 py-2.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Current</div>
            <div className="text-base font-bold">{aed(property.currentRate)}</div>
          </div>
          <div className={`rounded-xl px-3 py-2.5 ${property.suggestedRate !== property.currentRate ? (isIncrease ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-blue-50 dark:bg-blue-950/30") : "bg-muted/50"}`}>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">AI Suggests</div>
            <div className={`text-base font-bold ${isIncrease ? "text-emerald-600" : "text-blue-600"}`}>
              {aed(property.suggestedRate)}
            </div>
          </div>
          <div className="bg-muted/50 rounded-xl px-3 py-2.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Delta</div>
            <div className={`text-base font-bold ${isIncrease ? "text-emerald-600" : "text-blue-600"}`}>
              {isIncrease ? "+" : "-"}{deltaPct}%
            </div>
          </div>
        </div>

        {/* Range bar */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Min {aed(property.minRate)}</span><span>Max {aed(property.maxRate)}</span>
          </div>
          <div className="relative h-2 bg-muted rounded-full">
            <div
              className="absolute top-0 h-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-500 rounded-full opacity-40"
              style={{ width: "100%" }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-background shadow"
              style={{ left: `${Math.round((property.currentRate - property.minRate) / (property.maxRate - property.minRate) * 100)}%` }}
              title={`Current: ${aed(property.currentRate)}`}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-500 border-2 border-background"
              style={{ left: `${Math.round((property.suggestedRate - property.minRate) / (property.maxRate - property.minRate) * 100)}%` }}
              title={`Suggested: ${aed(property.suggestedRate)}`}
            />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-1.5 mb-3 text-center">
          {[
            { label: "Occ 30d", val: `${property.occupancy30d}%`, hi: property.occupancy30d >= 80 },
            { label: "ADR", val: `${(property.adr / 100).toFixed(1)}k`, hi: false },
            { label: "RevPAR", val: `${(property.revpar / 100).toFixed(1)}k`, hi: false },
            { label: "Avail 30d", val: `${property.availability30d}n`, hi: property.availability30d <= 5 },
          ].map(k => (
            <div key={k.label} className="bg-muted/40 rounded-lg py-1.5 px-1">
              <div className="text-[9px] text-muted-foreground uppercase">{k.label}</div>
              <div className={`text-xs font-bold ${k.hi ? "text-amber-500" : ""}`}>{k.val}</div>
            </div>
          ))}
        </div>

        {/* Last booking */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last booking: {property.lastBookingDaysAgo === 0 ? "Today" : `${property.lastBookingDaysAgo}d ago`}
          </span>
          <button onClick={() => setAiOpen(a => !a)} className="flex items-center gap-1 text-violet-500 hover:text-violet-600 font-medium">
            <Sparkles className="h-3 w-3" />AI Reason
          </button>
        </div>

        {/* AI explanation */}
        {aiOpen && (
          <div className="mb-3 bg-violet-50 dark:bg-violet-950/20 rounded-xl px-3 py-2.5 border border-violet-200 dark:border-violet-800">
            <p className="text-xs text-violet-700 dark:text-violet-300 leading-relaxed">{property.aiExplanation}</p>
          </div>
        )}

        {/* Platforms */}
        <div className="flex gap-1.5 mb-3">
          {property.platforms.map(p => (
            <span key={p} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p === "airbnb" ? "bg-red-100 text-red-700" : p === "booking_com" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
              {p === "airbnb" ? "Airbnb" : p === "booking_com" ? "Booking.com" : "Direct"}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t">
          {property.status !== "good" ? (
            <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={() => onReview(property)}>
              <Zap className="h-3 w-3" />Apply AI Price
            </Button>
          ) : (
            <div className="flex-1 h-8 text-xs flex items-center gap-1 text-emerald-600">
              <Lock className="h-3 w-3" />Rate looks right
            </div>
          )}
          <Button asChild size="sm" variant="outline" className="h-8 px-3 text-xs gap-1">
            <a href="/multi-calendar"><Calendar className="h-3 w-3" />Calendar</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR PRICING VIEW
// ─────────────────────────────────────────────────────────────────────────────
function CalendarPricing({ properties, rules }: { properties: PricingProperty[]; rules: Record<number, PricingRuleSet> }) {
  const { toast } = useToast();
  const [selectedPropId, setSelectedPropId] = useState(properties[0]?.id ?? 0);
  if (!properties.length) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3 bg-card border rounded-xl">
      <Calendar className="h-10 w-10 text-muted-foreground/30" />
      <div className="text-sm font-medium text-muted-foreground">No properties yet</div>
      <p className="text-xs text-muted-foreground/60">Add a property to use the pricing calendar</p>
    </div>
  );
  const [viewDate, setViewDate] = useState(new Date());
  const [lockedDates, setLockedDates] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const property = properties.find(p => p.id === selectedPropId)!;
  const propRules = rules[selectedPropId] ?? DEFAULT_RULES[selectedPropId];

  const daysInMonth = getDaysInMonth(viewDate);
  const firstDay = startOfMonth(viewDate);
  const startOffset = (getDay(firstDay) + 6) % 7; // Mon=0

  const calendarDays = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), i + 1);
      const key = format(date, "yyyy-MM-dd");
      const isLocked = lockedDates.has(key);
      const isWknd = isSaturday(date) || isFriday(date);
      const event = getEventForDate(date);
      const suggested = overrides[key] ?? suggestPrice(property, date, propRules);
      const current = isLocked ? suggested : (overrides[key] ?? propRules.baseRate);
      const diff = suggested - current;
      const diffPct = Math.round(Math.abs(diff) / current * 100);

      // Signal color
      let signal: "green" | "yellow" | "red" | "blue" = "green";
      if (isLocked) signal = "blue";
      else if (Math.abs(diffPct) <= 5) signal = "green";
      else if (diffPct <= 15) signal = "yellow";
      else signal = "red";

      return { date, key, current, suggested, diff, diffPct, signal, isLocked, isWknd, event };
    });
  }, [viewDate, property, propRules, lockedDates, overrides]);

  const SIGNAL_CLASSES = {
    green: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    yellow: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    red: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    blue: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  };

  function applyAll() {
    const newOverrides: Record<string, number> = {};
    calendarDays.forEach(d => { if (!d.isLocked) newOverrides[d.key] = d.suggested; });
    setOverrides(prev => ({ ...prev, ...newOverrides }));
    toast({ title: "All AI prices applied for " + format(viewDate, "MMMM") });
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Select value={String(selectedPropId)} onValueChange={v => setSelectedPropId(Number(v))}>
          <SelectTrigger className="w-64 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewDate(d => subMonths(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold w-32 text-center">{format(viewDate, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewDate(d => addMonths(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1 ml-2" onClick={applyAll}>
            <Sparkles className="h-3 w-3" />Apply All AI Prices
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-xs">
        {[
          { sig: "green", label: "Well priced" },
          { sig: "yellow", label: "Watch (5-15% off)" },
          { sig: "red", label: "Urgent (>15% off)" },
          { sig: "blue", label: "Locked" },
        ].map(({ sig, label }) => (
          <span key={sig} className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${SIGNAL_CLASSES[sig as keyof typeof SIGNAL_CLASSES]}`}>
            <span className={`w-2 h-2 rounded-full ${sig === "green" ? "bg-emerald-500" : sig === "yellow" ? "bg-amber-400" : sig === "red" ? "bg-red-500" : "bg-blue-500"}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="border rounded-xl overflow-hidden bg-card">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
            <div key={d} className={`text-center text-[11px] font-semibold py-2 ${d === "Fri" || d === "Sat" ? "text-amber-600" : "text-muted-foreground"}`}>{d}</div>
          ))}
        </div>
        {/* Cells */}
        <div className="grid grid-cols-7">
          {Array(startOffset).fill(null).map((_, i) => <div key={`e${i}`} className="border-b border-r p-1.5 min-h-[80px] bg-muted/20" />)}
          {calendarDays.map(day => (
            <div
              key={day.key}
              className={`border-b border-r p-1.5 min-h-[80px] cursor-pointer hover:opacity-90 transition-opacity ${SIGNAL_CLASSES[day.signal]} ${day.isWknd ? "ring-inset ring-1 ring-amber-200 dark:ring-amber-900" : ""}`}
              onClick={() => {
                if (day.signal !== "blue" && day.diff !== 0) {
                  setOverrides(prev => ({ ...prev, [day.key]: day.suggested }));
                  toast({ title: `${format(day.date, "MMM d")} → ${aed(day.suggested)}`, description: "AI price applied" });
                }
              }}
            >
              <div className="flex items-start justify-between mb-1">
                <span className={`text-[11px] font-bold ${day.isWknd ? "text-amber-600" : "text-muted-foreground"}`}>
                  {format(day.date, "d")}
                </span>
                {day.isLocked && <Lock className="h-2.5 w-2.5 text-blue-500" />}
                {day.event && <span className="text-[8px] text-violet-500 font-bold leading-none">EVENT</span>}
              </div>
              <div className="text-[11px] font-bold leading-tight">{aed(day.current)}</div>
              {day.diff !== 0 && (
                <div className={`text-[9px] font-semibold ${day.diff > 0 ? "text-emerald-600" : "text-blue-600"}`}>
                  AI: {aed(day.suggested)}
                </div>
              )}
              {day.event && <div className="text-[8px] text-violet-600 dark:text-violet-400 font-medium truncate mt-0.5">{day.event.name.split(" ").slice(0, 2).join(" ")}</div>}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Click any cell to apply the AI suggested price. Blue cells are owner-locked and cannot be modified.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING RULES
// ─────────────────────────────────────────────────────────────────────────────
function PricingRulesEditor({ properties, rules, onSave }: { properties: PricingProperty[]; rules: Record<number, PricingRuleSet>; onSave: (propertyId: number, rules: PricingRuleSet) => void }) {
  const { toast } = useToast();
  const [localRules, setLocalRules] = useState<Record<number, PricingRuleSet>>({ ...rules });
  const [selectedId, setSelectedId] = useState(properties[0]?.id ?? 0);
  if (!properties.length) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3 bg-card border rounded-xl">
      <Settings className="h-10 w-10 text-muted-foreground/30" />
      <div className="text-sm font-medium text-muted-foreground">No properties yet</div>
      <p className="text-xs text-muted-foreground/60">Add a property to configure pricing rules</p>
    </div>
  );
  const [isDirty, setIsDirty] = useState(false);

  // Sync local rules when props rules change (from API)
  useEffect(() => {
    setLocalRules(prev => ({ ...prev, ...rules }));
  }, [rules]);

  const property = properties.find(p => p.id === selectedId)!;
  const r = localRules[selectedId] ?? DEFAULT_RULES[selectedId];

  function update(key: keyof PricingRuleSet, val: number) {
    setLocalRules(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], [key]: val } }));
    setIsDirty(true);
  }

  const handleSave = () => {
    onSave(selectedId, r);
    setIsDirty(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Select value={String(selectedId)} onValueChange={v => setSelectedId(Number(v))}>
          <SelectTrigger className="w-72 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isDirty && (
          <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
            Unsaved Changes
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Rate bounds */}
        <div className="bg-card border rounded-xl p-5 space-y-4">
          <div className="font-semibold text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-teal-500" />Rate Bounds</div>
          {[
            { key: "baseRate" as const, label: "Base Rate (AED/night)", min: 100, max: 5000 },
            { key: "minRate" as const, label: "Minimum Rate (AED/night)", min: 50, max: 3000 },
            { key: "maxRate" as const, label: "Maximum Rate (AED/night)", min: 200, max: 10000 },
          ].map(({ key, label, min, max }) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <span className="text-sm font-bold">{aed(r[key])}</span>
              </div>
              <Slider min={min} max={max} step={50} value={[r[key]]}
                onValueChange={([v]) => update(key, v)}
                className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4" />
            </div>
          ))}
        </div>

        {/* Dynamic adjustments */}
        <div className="bg-card border rounded-xl p-5 space-y-4">
          <div className="font-semibold text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />Dynamic Adjustments</div>
          {[
            { key: "weekendMarkup" as const, label: "Weekend Markup (%)", min: 0, max: 60, suffix: "%" },
            { key: "lastMinuteDiscount" as const, label: "Last-Minute Discount (%)", min: 0, max: 40, suffix: "%" },
            { key: "highDemandMarkup" as const, label: "High Demand Markup (%)", min: 0, max: 50, suffix: "%" },
            { key: "lowOccDiscount" as const, label: "Low Occupancy Discount (%)", min: 0, max: 30, suffix: "%" },
          ].map(({ key, label, min, max, suffix }) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <span className="text-sm font-bold">{r[key]}{suffix}</span>
              </div>
              <Slider min={min} max={max} step={1} value={[r[key]]}
                onValueChange={([v]) => update(key, v)}
                className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4" />
            </div>
          ))}
        </div>

        {/* Stay settings */}
        <div className="bg-card border rounded-xl p-5 space-y-4">
          <div className="font-semibold text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-blue-500" />Stay Settings</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Minimum Stay (nights)</Label>
              <span className="text-sm font-bold">{r.minStay}</span>
            </div>
            <Slider min={1} max={14} step={1} value={[r.minStay]}
              onValueChange={([v]) => update("minStay", v)}
              className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4" />
          </div>
        </div>

        {/* Live preview */}
        <div className="bg-gradient-to-br from-[#0f2a3f] to-[#0a5c5c] rounded-xl p-5 text-white">
          <div className="font-semibold text-sm text-white/70 mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4" />Live Price Preview (Tonight)
          </div>
          {[
            { label: "Weekday", date: new Date() },
            { label: "Friday night", date: (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return d; })() },
            { label: "Last-minute (tomorrow)", date: addDays(new Date(), 1) },
          ].map(({ label, date }) => {
            const price = suggestPrice(property, date, r);
            return (
              <div key={label} className="flex items-center justify-between py-1.5 border-b border-white/10 last:border-0">
                <span className="text-xs text-white/60">{label}</span>
                <span className="text-sm font-bold text-teal-300">{aed(price)}</span>
              </div>
            );
          })}
          <Button className="w-full mt-4 bg-white/10 hover:bg-white/20 text-white border-0 text-xs h-8 gap-2"
            onClick={handleSave}>
            <Save className="h-3.5 w-3.5" />Save Rules
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITOR RATES
// ─────────────────────────────────────────────────────────────────────────────
type Competitor = { id: number; name: string; area: string; bedrooms: number; rate: number; signal: string; link: string; notes: string };

const SIGNAL_DOTS: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-emerald-500" };

function CompetitorRatesTab() {
  const { toast } = useToast();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", area: "", bedrooms: "1", rate: "", notes: "" });

  function addCompetitor() {
    if (!form.name || !form.rate) return;
    setCompetitors(prev => [...prev, { id: Date.now(), name: form.name, area: form.area, bedrooms: Number(form.bedrooms), rate: Number(form.rate), signal: "medium", link: "#", notes: form.notes }]);
    setForm({ name: "", area: "", bedrooms: "1", rate: "", notes: "" });
    setShowAdd(false);
    toast({ title: "Competitor added" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Track competing properties to benchmark your pricing.</p>
        <Button size="sm" className="gap-2 h-8" onClick={() => setShowAdd(s => !s)}>
          <Plus className="h-3.5 w-3.5" />Add Competitor
        </Button>
      </div>

      {showAdd && (
        <div className="bg-card border rounded-xl p-5 space-y-3">
          <div className="font-medium text-sm mb-2">Add Competitor Property</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Property Name</Label><Input placeholder="Marina Bliss 1BR" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs">Area</Label><Input placeholder="Dubai Marina" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs">Bedrooms</Label>
              <Select value={form.bedrooms} onValueChange={v => setForm(f => ({ ...f, bedrooms: v }))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{[0,1,2,3,4].map(n => <SelectItem key={n} value={String(n)}>{n === 0 ? "Studio" : `${n} BR`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Nightly Rate (AED)</Label><Input type="number" placeholder="650" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} className="h-8 text-sm" /></div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Notes</Label><Input placeholder="Superhost, pool view, etc." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="h-8 text-sm" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={addCompetitor}>Save Competitor</Button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              {["Property", "Area", "Beds", "Rate/Night", "Demand Signal", "Notes", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-2xl">🔍</div>
                    <p className="font-medium text-sm">No competitors tracked yet</p>
                    <p className="text-xs max-w-xs">Add competing listings to benchmark your nightly rates against the market.</p>
                  </div>
                </td>
              </tr>
            )}
            {competitors.map(c => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.area}</td>
                <td className="px-4 py-3">{c.bedrooms === 0 ? "Studio" : `${c.bedrooms}BR`}</td>
                <td className="px-4 py-3 font-bold">{aed(c.rate)}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${SIGNAL_DOTS[c.signal] ?? "bg-muted"}`} />
                    <span className="capitalize text-xs">{c.signal}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px] truncate">{c.notes}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setCompetitors(prev => prev.filter(x => x.id !== c.id))}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART ALERTS TAB
// ─────────────────────────────────────────────────────────────────────────────
function SmartAlertsTab() {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState(SMART_ALERTS);

  const SEVERITY_CFG = {
    critical: { bar: "bg-red-500", cls: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20" },
    high:     { bar: "bg-orange-500", cls: "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20" },
    medium:   { bar: "bg-amber-400", cls: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20" },
    low:      { bar: "bg-emerald-400", cls: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">AI-generated pricing alerts. Act on critical and high priority items first.</p>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-red-100 text-red-700">{alerts.filter(a => a.severity === "critical").length} Critical</Badge>
          <Badge className="bg-orange-100 text-orange-700">{alerts.filter(a => a.severity === "high").length} High</Badge>
        </div>
      </div>
      <div className="space-y-3">
        {alerts.map(alert => {
          const cfg = SEVERITY_CFG[alert.severity];
          return (
            <div key={alert.id} className={`border rounded-xl overflow-hidden ${cfg.cls} ${alert.applied ? "opacity-50" : ""}`}>
              <div className={`h-1 ${cfg.bar}`} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-xl flex-shrink-0">{alert.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-sm">{alert.property}</span>
                        <Badge variant="outline" className="text-[10px]">{alert.area}</Badge>
                        {alert.applied && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Applied ✓</Badge>}
                      </div>
                      <p className="text-sm font-medium mb-1">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">{alert.reason}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Impact</div>
                    <div className="text-sm font-bold text-emerald-600">{alert.impact}</div>
                  </div>
                </div>
                {alert.action && !alert.applied && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-current/10">
                    <Button size="sm" className="h-7 text-xs gap-1 flex-1"
                      onClick={() => {
                        setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, applied: true } : a));
                        toast({ title: "Action applied", description: alert.action! });
                      }}>
                      <Check className="h-3 w-3" />{alert.action}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}>
                      <X className="h-3 w-3" />Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UAE EVENTS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function UAEEventsBanner() {
  const upcoming = UAE_EVENTS.filter(e => new Date(e.start) > new Date()).slice(0, 3);
  if (!upcoming.length) return null;
  return (
    <div className="bg-gradient-to-r from-[#0f2a3f] to-[#0a4a4a] rounded-xl px-5 py-3 flex items-center gap-4 overflow-x-auto">
      <div className="text-white/50 text-xs font-semibold uppercase tracking-widest flex-shrink-0">Upcoming Events</div>
      {upcoming.map(e => (
        <div key={e.name} className="flex items-center gap-2 flex-shrink-0 bg-white/5 rounded-lg px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <div>
            <div className="text-white text-xs font-semibold">{e.name}</div>
            <div className="text-white/40 text-[10px]">{format(parseISO(e.start), "MMM d")} · {e.markup > 0 ? `+${Math.round(e.markup * 100)}%` : `${Math.round(e.markup * 100)}%`} demand</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
type Tab = "dashboard" | "calendar" | "rules" | "competitors" | "alerts";

export default function Pricing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [filterStatus, setFilterStatus] = useState("all");
  const [reviewProp, setReviewProp] = useState<PricingProperty | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set());

  // API Integration
  const { data: serverRules, isLoading: isLoadingRules } = useQuery({
    queryKey: ["pricing-rules"],
    queryFn: fetchRules,
  });

  const rulesMutation = useMutation({
    mutationFn: saveRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing-rules"] });
      toast({ title: "Rules saved", description: "Pricing rules updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save pricing rules.", variant: "destructive" });
    },
  });

  const rules = useMemo(() => {
    const merged = { ...DEFAULT_RULES };
    if (serverRules) {
      serverRules.forEach(item => {
        merged[item.propertyId] = item.rules;
      });
    }
    return merged;
  }, [serverRules]);

  const filtered = filterStatus === "all"
    ? PRICING_PROPERTIES
    : PRICING_PROPERTIES.filter(p => p.status === filterStatus);

  const propCount = PRICING_PROPERTIES.length || 1;
  const stats = {
    avgRate: Math.round(PRICING_PROPERTIES.reduce((s, p) => s + p.currentRate, 0) / propCount),
    avgRevpar: Math.round(PRICING_PROPERTIES.reduce((s, p) => s + p.revpar, 0) / propCount),
    alerts: SMART_ALERTS.filter(a => a.severity !== "low").length,
    needsAction: PRICING_PROPERTIES.filter(p => p.status !== "good").length,
    portfolioRev: PRICING_PROPERTIES.reduce((s, p) => s + p.adr * (30 - p.availability30d), 0),
  };

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "dashboard",   label: "Dashboard",   icon: BarChart2 },
    { id: "calendar",    label: "Calendar",    icon: Calendar },
    { id: "rules",       label: "Rules",       icon: Settings },
    { id: "competitors", label: "Competitors", icon: Users2 },
    { id: "alerts",      label: `Alerts (${stats.alerts})`, icon: Bell },
  ];

  function handleApplyAll() {
    const ids = new Set(PRICING_PROPERTIES.filter(p => p.status !== "good").map(p => p.id));
    setAppliedIds(ids);
    toast({ title: "AI prices applied", description: `Updated ${ids.size} properties` });
  }

  const handleSaveRules = (propertyId: number, propertyRules: PricingRuleSet) => {
    rulesMutation.mutate({ propertyId, rules: propertyRules });
  };

  if (isLoadingRules) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-teal-500" />Dynamic Pricing
            <Badge className="text-[10px] bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 ml-1">AI-Powered</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Revenue manager cockpit — price every night intelligently</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-9 text-xs gap-2">
            <Lock className="h-3.5 w-3.5" />Lock All Prices
          </Button>
          <Button size="sm" className="h-9 text-xs gap-2 bg-teal-600 hover:bg-teal-700" onClick={handleApplyAll}>
            <Sparkles className="h-3.5 w-3.5" />Apply All AI Prices
          </Button>
        </div>
      </div>

      {/* UAE Events banner */}
      <UAEEventsBanner />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Avg Nightly Rate", val: aed(stats.avgRate), cls: "text-foreground", sub: "portfolio avg" },
          { label: "Avg RevPAR", val: aed(stats.avgRevpar), cls: "text-blue-600", sub: "last 30 days" },
          { label: "Needs Action", val: stats.needsAction, cls: stats.needsAction > 0 ? "text-red-600" : "text-emerald-600", sub: "properties" },
          { label: "Active Alerts", val: stats.alerts, cls: stats.alerts > 0 ? "text-amber-600" : "text-muted-foreground", sub: "urgent items" },
          { label: "Month Revenue", val: `AED ${(stats.portfolioRev / 1000).toFixed(0)}k`, cls: "text-emerald-600", sub: "projected" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-xl font-bold ${s.cls}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            <div className="text-[10px] text-muted-foreground/60">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted/50 rounded-xl p-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "dashboard" && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2 flex-wrap items-center">
            {[
              { val: "all", label: `All (${PRICING_PROPERTIES.length})` },
              { val: "needs_action", label: `Needs Action (${PRICING_PROPERTIES.filter(p => p.status === "needs_action").length})` },
              { val: "too_low", label: `Too Low (${PRICING_PROPERTIES.filter(p => p.status === "too_low").length})` },
              { val: "good", label: `Good (${PRICING_PROPERTIES.filter(p => p.status === "good").length})` },
            ].map(f => (
              <button key={f.val} onClick={() => setFilterStatus(f.val)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterStatus === f.val ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3 bg-card border rounded-xl">
              <TrendingUp className="h-10 w-10 text-muted-foreground/30" />
              <div className="text-sm font-medium text-muted-foreground">No properties to price yet</div>
              <p className="text-xs text-muted-foreground/60">Add properties to start using the AI pricing engine</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(p => (
                <PropertyPricingCard key={p.id} property={{ ...p, status: appliedIds.has(p.id) ? "good" : p.status }} onReview={setReviewProp} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "calendar" && <CalendarPricing properties={PRICING_PROPERTIES} rules={rules} />}
      {tab === "rules" && <PricingRulesEditor properties={PRICING_PROPERTIES} rules={rules} onSave={handleSaveRules} />}
      {tab === "competitors" && <CompetitorRatesTab />}
      {tab === "alerts" && <SmartAlertsTab />}

      {/* Revenue Impact Modal */}
      {reviewProp && (
        <RevenueImpactModal
          property={reviewProp}
          onClose={() => setReviewProp(null)}
          onApply={() => {
            setAppliedIds(prev => new Set([...prev, reviewProp.id]));
            toast({ title: "AI price applied", description: `${reviewProp.name} → ${aed(reviewProp.suggestedRate)}/night` });
            setReviewProp(null);
          }}
        />
      )}
    </div>
  );
}
