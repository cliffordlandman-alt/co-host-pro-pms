/**
 * Staff Audit Log / Activity Tracking
 * ─────────────────────────────────────────────
 * Permanent, role-filtered record of every change made in the PMS.
 * - Admin / Super Admin: full access to all logs
 * - Manager: all staff logs (not owners)
 * - Reservations / Cleaner / Maintenance / Accountant: own actions only
 * - Owner: blocked
 *
 * Logs are read-only — no staff member can edit or delete them.
 */

import { useState, useMemo } from "react";
import {
  Shield, AlertTriangle, Clock, User, Filter, Download,
  ChevronDown, ChevronUp, Search, ArrowRight, Eye, EyeOff,
  Lock, Trash2, DollarSign, Calendar, MessageCircle,
  Sparkles, Wrench, Building, CreditCard, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth, ROLE_LABELS, ROLE_COLORS } from "@/contexts/auth-context";
import { format, formatDistanceToNow, subDays, subHours, subMinutes } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
type AuditSection =
  | "Pricing" | "Booking" | "Cleaning" | "Maintenance"
  | "Owner" | "Payment" | "Calendar" | "Property"
  | "Message" | "Price Lock" | "Staff" | "Settings";

interface AuditEntry {
  id: number;
  timestamp: Date;
  staffName: string;
  staffEmail: string;
  staffRole: string;
  property: string;
  section: AuditSection;
  action: string;
  field: string;
  oldValue: string;
  newValue: string;
  isHighRisk: boolean;
  riskReason?: string;
  reason?: string;
  device: string;
  ipAddress: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION CONFIG — colours and icons
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_CFG: Record<AuditSection, { color: string; border: string; icon: any; bg: string }> = {
  Pricing:      { color: "text-teal-600",   border: "border-l-teal-500",   icon: DollarSign,     bg: "bg-teal-50 dark:bg-teal-950/20" },
  Booking:      { color: "text-blue-600",   border: "border-l-blue-500",   icon: Calendar,       bg: "bg-blue-50 dark:bg-blue-950/20" },
  Cleaning:     { color: "text-amber-600",  border: "border-l-amber-500",  icon: Sparkles,       bg: "bg-amber-50 dark:bg-amber-950/20" },
  Maintenance:  { color: "text-orange-600", border: "border-l-orange-500", icon: Wrench,         bg: "bg-orange-50 dark:bg-orange-950/20" },
  Owner:        { color: "text-pink-600",   border: "border-l-pink-500",   icon: Users,          bg: "bg-pink-50 dark:bg-pink-950/20" },
  Payment:      { color: "text-emerald-600",border: "border-l-emerald-500",icon: CreditCard,     bg: "bg-emerald-50 dark:bg-emerald-950/20" },
  Calendar:     { color: "text-violet-600", border: "border-l-violet-500", icon: Calendar,       bg: "bg-violet-50 dark:bg-violet-950/20" },
  Property:     { color: "text-slate-600",  border: "border-l-slate-500",  icon: Building,       bg: "bg-slate-50 dark:bg-slate-950/20" },
  Message:      { color: "text-sky-600",    border: "border-l-sky-500",    icon: MessageCircle,  bg: "bg-sky-50 dark:bg-sky-950/20" },
  "Price Lock": { color: "text-indigo-600", border: "border-l-indigo-500", icon: Lock,           bg: "bg-indigo-50 dark:bg-indigo-950/20" },
  Staff:        { color: "text-purple-600", border: "border-l-purple-500", icon: User,           bg: "bg-purple-50 dark:bg-purple-950/20" },
  Settings:     { color: "text-gray-600",   border: "border-l-gray-500",   icon: Shield,         bg: "bg-gray-50 dark:bg-gray-950/20" },
};

const now = new Date();
const AUDIT_LOGS: AuditEntry[] = [];

// Which roles can see all logs vs own only
const CAN_SEE_ALL = ["super_admin", "admin"];
const CAN_SEE_STAFF = ["manager"];
// Everyone else sees own only

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ENTRY CARD
// ─────────────────────────────────────────────────────────────────────────────
function AuditCard({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SECTION_CFG[entry.section];
  const SectionIcon = cfg.icon;

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${entry.isHighRisk ? "border-red-300 dark:border-red-800" : "border-border"}`}>
      <div className={`border-l-4 ${cfg.border}`}>
        {/* Main row */}
        <div
          className={`flex items-start gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${expanded ? "border-b" : ""}`}
          onClick={() => setExpanded(e => !e)}
        >
          {/* Icon */}
          <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.bg} flex-shrink-0`}>
            <SectionIcon className={`h-3.5 w-3.5 ${cfg.color}`} />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {/* Staff */}
              <span className="text-sm font-semibold">{entry.staffName}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[entry.staffRole] ?? "bg-muted text-muted-foreground"}`}>
                {ROLE_LABELS[entry.staffRole] ?? entry.staffRole}
              </span>
              {/* High risk */}
              {entry.isHighRisk && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-100 dark:bg-red-950/40 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                  <AlertTriangle className="h-2.5 w-2.5" />High Risk
                </span>
              )}
            </div>

            {/* Action summary */}
            <div className="text-sm text-muted-foreground leading-snug">
              <span className={`font-medium ${cfg.color}`}>{entry.action}</span>
              {" "}<span className="font-medium text-foreground">{entry.field}</span>
              {" "}on <span className="font-medium text-foreground">{entry.property}</span>
              <span className="ml-2 text-xs">· {entry.section}</span>
            </div>

            {/* Before → After inline */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 px-2 py-0.5 rounded font-mono line-through">
                {entry.oldValue}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-mono">
                {entry.newValue}
              </span>
            </div>
          </div>

          {/* Right: time + expand */}
          <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {format(entry.timestamp, "MMM d, HH:mm")}
            </span>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground mt-1" /> : <ChevronDown className="h-4 w-4 text-muted-foreground mt-1" />}
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="px-4 py-3 bg-muted/20 space-y-3">
            {/* Before / After blocks */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
                <div className="text-[10px] text-red-600 font-semibold uppercase tracking-wide mb-1">Before</div>
                <div className="text-sm font-mono text-red-700 dark:text-red-300 break-words">{entry.oldValue}</div>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg p-3">
                <div className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-1">After</div>
                <div className="text-sm font-mono text-emerald-700 dark:text-emerald-300 break-words">{entry.newValue}</div>
              </div>
            </div>

            {/* High-risk reason */}
            {entry.isHighRisk && entry.riskReason && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">{entry.riskReason}</p>
              </div>
            )}

            {/* Staff reason */}
            {entry.reason && (
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0 mt-0.5">Reason:</span>
                <span className="text-xs text-muted-foreground">{entry.reason}</span>
              </div>
            )}

            {/* Metadata row */}
            <div className="flex flex-wrap gap-4 pt-2 border-t text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />{entry.staffEmail}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />{format(entry.timestamp, "EEEE, MMM d yyyy, HH:mm:ss")}
              </span>
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3" />{entry.ipAddress}
              </span>
              <span>{entry.device}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function AuditLog() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStaff, setFilterStaff] = useState("all");
  const [filterProperty, setFilterProperty] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [filterDays, setFilterDays] = useState("30");
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [riskBannerOpen, setRiskBannerOpen] = useState(true);

  // ── Role-based visibility ──────────────────────────────────────────────────
  const role = user?.role ?? "";
  const visibleLogs = useMemo(() => {
    if (CAN_SEE_ALL.includes(role)) return AUDIT_LOGS;
    if (CAN_SEE_STAFF.includes(role)) return AUDIT_LOGS.filter(l => l.staffRole !== "owner");
    return AUDIT_LOGS.filter(l => l.staffEmail === user?.email);
  }, [role, user]);

  // ── Apply filters ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const cutoff = subDays(now, parseInt(filterDays));
    return visibleLogs.filter(l => {
      if (l.timestamp < cutoff) return false;
      if (highRiskOnly && !l.isHighRisk) return false;
      if (filterStaff !== "all" && l.staffName !== filterStaff) return false;
      if (filterProperty !== "all" && l.property !== filterProperty) return false;
      if (filterSection !== "all" && l.section !== filterSection) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.staffName.toLowerCase().includes(q) ||
          l.property.toLowerCase().includes(q) ||
          l.field.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.newValue.toLowerCase().includes(q) ||
          l.oldValue.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [visibleLogs, search, filterStaff, filterProperty, filterSection, filterDays, highRiskOnly]);

  // ── Derived filter options ─────────────────────────────────────────────────
  const staffOptions = [...new Set(visibleLogs.map(l => l.staffName))].sort();
  const propertyOptions = [...new Set(visibleLogs.map(l => l.property))].sort();
  const sectionOptions = [...new Set(visibleLogs.map(l => l.section))].sort();

  // ── Stats ──────────────────────────────────────────────────────────────────
  const todayLogs = visibleLogs.filter(l => l.timestamp >= subHours(now, 24));
  const highRiskLogs = filtered.filter(l => l.isHighRisk);
  const activeStaff = new Set(todayLogs.map(l => l.staffName)).size;

  // ── CSV Export ─────────────────────────────────────────────────────────────
  function exportCSV() {
    const header = "ID,Timestamp,Staff,Role,Property,Section,Action,Field,Old Value,New Value,High Risk,Risk Reason,Reason,Device,IP\n";
    const rows = filtered.map(l =>
      `${l.id},"${format(l.timestamp, "yyyy-MM-dd HH:mm:ss")}","${l.staffName}","${l.staffRole}","${l.property}","${l.section}","${l.action}","${l.field}","${l.oldValue}","${l.newValue}",${l.isHighRisk},"${l.riskReason ?? ""}","${l.reason ?? ""}","${l.device}","${l.ipAddress}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "co-host-pro-audit-log.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Owner blocked ──────────────────────────────────────────────────────────
  if (role === "owner") {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px] text-center gap-3">
        <EyeOff className="h-12 w-12 text-muted-foreground/40" />
        <div className="font-semibold text-muted-foreground">Audit logs are not available for owner accounts.</div>
        <p className="text-xs text-muted-foreground/60 max-w-xs">Internal staff activity is confidential. Please contact your property manager for reporting queries.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-violet-500" />Activity Log
            <Badge className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 ml-1">Read-only</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {CAN_SEE_ALL.includes(role) ? "Full audit trail — all staff, all changes" :
             CAN_SEE_STAFF.includes(role) ? "Staff activity log — your team's changes" :
             "Your personal activity log"}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-9 gap-2 text-xs" onClick={exportCSV}>
          <Download className="h-3.5 w-3.5" />Export CSV
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Changes Today", val: todayLogs.length, cls: "text-foreground", sub: "last 24 hours" },
          { label: "High-Risk Alerts", val: highRiskLogs.length, cls: highRiskLogs.length > 0 ? "text-red-600" : "text-emerald-600", sub: "require review" },
          { label: "Active Staff", val: activeStaff, cls: "text-blue-600", sub: "in last 24h" },
          { label: "Showing", val: filtered.length, cls: "text-muted-foreground", sub: `of ${visibleLogs.length} total` },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className={`text-2xl font-bold ${s.cls}`}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            <div className="text-[10px] text-muted-foreground/60">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* High-risk alert banner */}
      {highRiskLogs.length > 0 && riskBannerOpen && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4" />
              {highRiskLogs.length} High-Risk Change{highRiskLogs.length > 1 ? "s" : ""} Detected
            </div>
            <button onClick={() => setRiskBannerOpen(false)} className="text-red-400 hover:text-red-600">
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1">
            {highRiskLogs.slice(0, 4).map(l => (
              <div key={l.id} className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                <span className="font-bold flex-shrink-0">·</span>
                <span>
                  <strong>{l.staffName}</strong> {l.action.toLowerCase()} {l.field} on <strong>{l.property}</strong>
                  {l.riskReason && <span className="text-red-500 ml-1">— {l.riskReason}</span>}
                </span>
              </div>
            ))}
            {highRiskLogs.length > 4 && (
              <button className="text-xs text-red-600 font-medium mt-1" onClick={() => setHighRiskOnly(true)}>
                + {highRiskLogs.length - 4} more — show high-risk only
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="h-3.5 w-3.5" />Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search staff, property, field, value…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          {/* Staff filter */}
          {(CAN_SEE_ALL.includes(role) || CAN_SEE_STAFF.includes(role)) && (
            <Select value={filterStaff} onValueChange={setFilterStaff}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Staff" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {staffOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {/* Property filter */}
          <Select value={filterProperty} onValueChange={setFilterProperty}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Properties" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              {propertyOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Section filter */}
          <Select value={filterSection} onValueChange={setFilterSection}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Sections" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {sectionOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Date range */}
          <Select value={filterDays} onValueChange={setFilterDays}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          {/* High-risk toggle */}
          <div className="flex items-center gap-2 col-span-1">
            <Switch id="high-risk" checked={highRiskOnly} onCheckedChange={setHighRiskOnly} />
            <Label htmlFor="high-risk" className="text-sm cursor-pointer">High-risk only</Label>
          </div>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} log{filtered.length !== 1 ? "s" : ""} found</span>
        {(search || filterStaff !== "all" || filterProperty !== "all" || filterSection !== "all" || highRiskOnly) && (
          <button className="text-violet-600 hover:text-violet-700 font-medium" onClick={() => { setSearch(""); setFilterStaff("all"); setFilterProperty("all"); setFilterSection("all"); setHighRiskOnly(false); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 bg-card border rounded-xl">
          <Eye className="h-10 w-10 text-muted-foreground/30" />
          <div className="text-sm font-medium text-muted-foreground">No activity logs match your filters</div>
          <p className="text-xs text-muted-foreground/60">Try adjusting the date range or clearing filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => <AuditCard key={entry.id} entry={entry} />)}
        </div>
      )}

      {/* Footer note */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60 pb-2">
        <Lock className="h-3 w-3" />
        Audit logs are permanent and cannot be edited or deleted by any staff member.
      </div>
    </div>
  );
}
