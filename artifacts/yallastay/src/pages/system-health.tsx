import { apiFetch } from "@/lib/api-fetch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, XCircle, Info, RefreshCw, Trash2,
  Building, Image, Link2, DollarSign, FileText, Calendar,
  Database, Wifi, WifiOff, Clock, ArrowRight, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

interface Issue {
  severity: "critical" | "warning" | "info";
  rule: string;
  propertyId?: number;
  propertyName?: string;
  detail: string;
}

interface PropAudit {
  id: number;
  name: string;
  status: string;
  importStatus: string | null;
  hasListingId: boolean;
  hasIcal: boolean;
  hasPhotos: boolean;
  hasPrice: boolean;
  hasDescription: boolean;
  hasHtmlEntities: boolean;
  unitIsPlaceholder: boolean;
  photoCount: number;
  airbnbListingId: string | null;
  airbnbIcalUrl: string | null;
  building: string | null;
  unitNumber: string | null;
  bedroomType: string | null;
  area: string | null;
  createdAt: string;
}

interface ImportLog {
  id: number;
  listingUrl: string;
  listingId: string | null;
  propertyId: number | null;
  status: string;
  photosImported: string;
  pricesImported: string;
  amenitiesImported: string;
  calendarConnected: string;
  errorMessage: string | null;
  attemptedAt: string | null;
}

interface HealthData {
  healthScore: number;
  db: { status: string; propertyCount: number; reservationCount: number };
  issues: Issue[];
  propAudit: PropAudit[];
  importSummary: { total: number; successful: number; partial: number; failed: number; lastAttemptAt: string | null };
  importLogs: ImportLog[];
}

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    cls: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800",
    badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    cls: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    label: "Warning",
  },
  info: {
    icon: Info,
    cls: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    label: "Info",
  },
};

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800"
    : score >= 50 ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800"
    : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800";
  const label = score >= 80 ? "Healthy" : score >= 50 ? "Needs Attention" : "Not Ready";
  return (
    <div className={`flex items-center gap-3 px-5 py-3 rounded-xl border font-semibold ${color}`}>
      <Zap className="w-5 h-5" />
      <span className="text-2xl">{score}%</span>
      <span className="text-base font-medium opacity-80">{label}</span>
    </div>
  );
}

export default function SystemHealth() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery<HealthData>({
    queryKey: ["system-health"],
    queryFn: async () => {
      const r = await apiFetch("/api/system-health");
      if (!r.ok) throw new Error("Failed to load system health");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const deleteProperty = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiFetch(`/api/properties/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Property deleted" });
      qc.invalidateQueries({ queryKey: ["system-health"] });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Failed to load system health. Check API server logs.
      </div>
    );
  }

  const critical = data.issues.filter(i => i.severity === "critical");
  const warnings = data.issues.filter(i => i.severity === "warning");
  const info = data.issues.filter(i => i.severity === "info");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            System Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time QA audit — data integrity, channel connections, and launch readiness.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall Status */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <ScoreBadge score={data.healthScore} />
        </div>
        <StatCard icon={Database} label="Properties" value={data.db.propertyCount} ok={data.db.propertyCount > 0} />
        <StatCard icon={Calendar} label="Reservations" value={data.db.reservationCount} ok={data.db.reservationCount > 0} />
        <StatCard icon={FileText} label="Import logs" value={data.importSummary.total} ok={data.importSummary.total > 0} neutral />
      </div>

      {/* Issues */}
      {data.issues.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-medium">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          All checks passed. System is healthy.
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Issues Detected
            {critical.length > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">{critical.length} critical</span>}
            {warnings.length > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 text-xs">{warnings.length} warnings</span>}
          </h2>
          <div className="space-y-2">
            {[...critical, ...warnings, ...info].map((issue, i) => {
              const cfg = SEVERITY_CONFIG[issue.severity];
              const Icon = cfg.icon;
              return (
                <div key={i} className={`flex items-start gap-3 p-3.5 rounded-lg border ${cfg.bg}`}>
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${cfg.cls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
                      {issue.propertyName && (
                        <a href={`/properties`} className="text-xs text-muted-foreground hover:underline truncate max-w-xs">
                          {issue.propertyName.slice(0, 50)}{issue.propertyName.length > 50 ? "…" : ""}
                        </a>
                      )}
                      <code className="text-xs text-muted-foreground font-mono opacity-60">{issue.rule}</code>
                    </div>
                    <p className="text-sm mt-1">{issue.detail}</p>
                  </div>
                  {issue.propertyId && issue.severity === "critical" && issue.rule === "HTML_ENTITIES" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="shrink-0 text-xs h-7"
                      onClick={() => {
                        if (confirm("Delete this property and re-import it fresh?")) {
                          deleteProperty.mutate(issue.propertyId!);
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Delete & Re-import
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-Property Audit Grid */}
      {data.propAudit.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Property Audit</h2>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 font-medium">Property</th>
                  <th className="text-center px-3 py-2.5 font-medium">
                    <span title="Airbnb Listing ID"><Link2 className="w-3.5 h-3.5 mx-auto" /></span>
                  </th>
                  <th className="text-center px-3 py-2.5 font-medium">
                    <span title="iCal / Calendar Sync"><Calendar className="w-3.5 h-3.5 mx-auto" /></span>
                  </th>
                  <th className="text-center px-3 py-2.5 font-medium">
                    <span title="Photos"><Image className="w-3.5 h-3.5 mx-auto" /></span>
                  </th>
                  <th className="text-center px-3 py-2.5 font-medium">
                    <span title="Base Nightly Price"><DollarSign className="w-3.5 h-3.5 mx-auto" /></span>
                  </th>
                  <th className="text-center px-3 py-2.5 font-medium">
                    <span title="Description"><FileText className="w-3.5 h-3.5 mx-auto" /></span>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium hidden md:table-cell">Unit / Building</th>
                  <th className="text-center px-3 py-2.5 font-medium hidden md:table-cell">Import</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {data.propAudit.map(p => {
                  const hasBug = p.hasHtmlEntities;
                  return (
                    <tr key={p.id} className={`border-b last:border-0 ${hasBug ? "bg-red-50/50 dark:bg-red-950/20" : "hover:bg-muted/30"}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-sm leading-tight max-w-xs truncate" title={p.name}>
                          {p.name.slice(0, 45)}{p.name.length > 45 ? "…" : ""}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          {p.area || "no area"}
                          {hasBug && <span className="text-red-500 font-semibold">· HTML entity bug</span>}
                        </div>
                      </td>
                      <td className="text-center px-3 py-3">
                        {p.hasListingId
                          ? <span title={p.airbnbListingId ?? ""}><CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" /></span>
                          : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                      </td>
                      <td className="text-center px-3 py-3">
                        {p.hasIcal
                          ? <Wifi className="w-4 h-4 text-emerald-500 mx-auto" />
                          : <WifiOff className="w-4 h-4 text-red-400 mx-auto" />}
                      </td>
                      <td className="text-center px-3 py-3">
                        {p.hasPhotos
                          ? <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">{p.photoCount}</span>
                          : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                      </td>
                      <td className="text-center px-3 py-3">
                        {p.hasPrice
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                      </td>
                      <td className="text-center px-3 py-3">
                        {p.hasDescription
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          : <XCircle className="w-4 h-4 text-amber-400 mx-auto" />}
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        <div className="text-xs text-muted-foreground">
                          <div>{p.building || <span className="opacity-50">no building</span>}</div>
                          <div className={p.unitIsPlaceholder ? "text-amber-500" : ""}>{p.unitNumber || "—"}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center hidden md:table-cell">
                        <ImportStatusBadge status={p.importStatus} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <a href="/properties">
                            <Button size="sm" variant="ghost" className="h-7 text-xs">
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          </a>
                          {hasBug && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                if (confirm(`Delete "${p.name.slice(0, 40)}…" and re-import it?\n\nThis removes the corrupt data so you can re-import with the fixed scraper.`)) {
                                  deleteProperty.mutate(p.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <ImportStat label="Total Imports" value={data.importSummary.total} />
        <ImportStat label="Successful" value={data.importSummary.successful} color="text-emerald-600 dark:text-emerald-400" />
        <ImportStat label="Partial" value={data.importSummary.partial} color="text-amber-600 dark:text-amber-400" />
        <ImportStat label="Failed" value={data.importSummary.failed} color="text-red-600 dark:text-red-400" />
      </div>

      {/* Import Log */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Import Audit Log</h2>
        {data.importLogs.length === 0 ? (
          <div className="p-4 rounded-xl border bg-muted/30 text-sm text-muted-foreground">
            No import logs recorded yet.
            {data.db.propertyCount > 0 && (
              <span className="ml-1">
                The existing {data.db.propertyCount > 1 ? "properties were" : "property was"} imported before the audit log table was created — re-import to start tracking.
              </span>
            )}
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2 font-medium">Listing URL</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                  <th className="text-center px-3 py-2 font-medium hidden sm:table-cell">Photos</th>
                  <th className="text-center px-3 py-2 font-medium hidden sm:table-cell">Price</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Error</th>
                  <th className="text-right px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.importLogs.map(log => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <a href={log.listingUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-mono text-primary hover:underline truncate block max-w-xs">
                        {log.listingId ? `airbnb.com/rooms/${log.listingId}` : log.listingUrl?.slice(0, 40)}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ImportStatusBadge status={log.status} />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      {log.photosImported === "yes"
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        : <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                    </td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      {log.pricesImported === "yes"
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        : <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto" />}
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {log.errorMessage ? (
                        <span className="text-xs text-red-500 truncate block max-w-sm" title={log.errorMessage}>
                          {log.errorMessage.slice(0, 80)}{log.errorMessage.length > 80 ? "…" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3" />
                        {log.attemptedAt ? format(parseISO(log.attemptedAt), "MMM d, HH:mm") : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Validation Rules Reference */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Validation Rules</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { rule: "NO_CHANNEL", label: "Active property must have a channel", desc: "Every active property needs either an Airbnb listing ID or an iCal URL." },
            { rule: "NO_ICAL", label: "iCal URL required for reservation sync", desc: "Without an iCal feed, new bookings won't appear in the calendar." },
            { rule: "NO_PHOTOS", label: "At least 1 photo per property", desc: "Properties without photos will display as blank in all listings." },
            { rule: "NO_PRICE", label: "Base nightly price must be set", desc: "Dynamic Pricing requires a base rate to generate suggestions." },
            { rule: "HTML_ENTITIES", label: "No HTML entities in stored data", desc: "&amp; in descriptions or photo URLs means the scraper decoded incorrectly. Re-import." },
            { rule: "PLACEHOLDER_UNIT", label: "Real unit number required", desc: "Unit number 'TBC' is a placeholder — update before assigning to cleaning staff." },
          ].map(r => (
            <div key={r.rule} className="flex gap-3 p-3 rounded-lg border bg-muted/20">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
                <code className="text-xs font-mono opacity-50">{r.rule}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function StatCard({ icon: Icon, label, value, ok, neutral }: {
  icon: React.ElementType; label: string; value: number; ok: boolean; neutral?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${neutral ? "bg-muted/20" : ok ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"}`}>
      <Icon className={`w-5 h-5 ${neutral ? "text-muted-foreground" : ok ? "text-emerald-500" : "text-red-500"}`} />
      <div>
        <div className={`text-xl font-bold ${neutral ? "" : ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function ImportStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="p-4 rounded-xl border bg-muted/20">
      <div className={`text-2xl font-bold ${color ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function ImportStatusBadge({ status }: { status: string | null }) {
  if (!status || status === "not_imported") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">none</span>;
  }
  if (status === "imported_successfully") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">✓ success</span>;
  }
  if (status === "partially_imported") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">⚠ partial</span>;
  }
  if (status === "failed_import") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">✗ failed</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{status}</span>;
}
