import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  CheckCircle2, XCircle, Link2, Copy, ExternalLink, AlertTriangle,
  Pencil, TrendingUp, RefreshCw, Activity, Clock, ShieldCheck,
  Wifi, WifiOff, Image, DollarSign, CalendarDays, BarChart3,
  ChevronRight, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { platformColor } from "@/lib/channel-colors";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fj = async (url: string, opts?: RequestInit) => {
  const res = await apiFetch(`${API_BASE}${url}`, opts);
  if (!res.ok) throw new Error("API error");
  return res.json();
};

// Channel colours come from the shared map in lib/channel-colors.ts.
const PLATFORM_CONFIG: Record<string, {
  label: string; logoSvg?: string; icalField?: string; listingField?: string;
  icalFieldLabel?: string; listingFieldLabel?: string;
}> = {
  airbnb: {
    label: "Airbnb",
    icalField: "airbnbIcalUrl", listingField: "airbnbListingId",
    icalFieldLabel: "Airbnb iCal Export URL", listingFieldLabel: "Listing ID",
  },
  booking_com: {
    label: "Booking.com",
    icalField: "bookingComIcalUrl", listingField: "bookingComPropertyId",
    icalFieldLabel: "Booking.com iCal URL", listingFieldLabel: "Property ID",
  },
  vrbo: {
    label: "Vrbo",
    icalField: "vrboIcalUrl", listingField: "vrboListingId",
    icalFieldLabel: "Vrbo iCal URL", listingFieldLabel: "Listing ID",
  },
  direct: {
    label: "Direct",
  },
};

function aed(n: number) {
  return `AED ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function isConnected(prop: any, platformKey: string) {
  if (platformKey === "direct") return true;
  const cfg = PLATFORM_CONFIG[platformKey];
  return !!(prop[cfg.icalField!] || prop[cfg.listingField!]);
}

function relativeTime(ts: string | null) {
  if (!ts) return null;
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); } catch { return null; }
}

// ── Airbnb logo ───────────────────────────────────────────────────────────────
function AirbnbLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.003 0C5.374 0 0 5.373 0 12.003 0 18.63 5.374 24 12.003 24 18.63 24 24 18.63 24 12.003 24 5.373 18.63 0 12.003 0zm0 1.604a10.4 10.4 0 0 1 10.4 10.4 10.4 10.4 0 0 1-10.4 10.396 10.4 10.4 0 0 1-10.4-10.397 10.4 10.4 0 0 1 10.4-10.4zm0 3.797a2.604 2.604 0 1 0 0 5.208 2.604 2.604 0 0 0 0-5.208zm-4.56 7.148c-.54 0-.978.438-.978.978v.325c0 2.7 2.43 4.884 5.538 4.884 3.107 0 5.537-2.183 5.537-4.884v-.325c0-.54-.438-.978-.978-.978H7.443z"/>
    </svg>
  );
}

// ── Connection editor dialog ─────────────────────────────────────────────────
function ConnectionDialog({ open, onClose, property, platformKey }: {
  open: boolean; onClose: () => void; property: any; platformKey: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cfg = PLATFORM_CONFIG[platformKey];
  const [icalUrl, setIcalUrl] = useState(property?.[cfg?.icalField!] ?? "");
  const [listingId, setListingId] = useState(property?.[cfg?.listingField!] ?? "");

  const saveMutation = useMutation({
    mutationFn: () => fj(`/api/platforms/property/${property.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [cfg.icalField!]: icalUrl.trim() || null,
        [cfg.listingField!]: listingId.trim() || null,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
      queryClient.invalidateQueries({ queryKey: ["channels-health"] });
      toast({ title: `${cfg.label} settings saved` });
      onClose();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => fj(`/api/platforms/property/${property.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [cfg.icalField!]: null, [cfg.listingField!]: null }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
      queryClient.invalidateQueries({ queryKey: ["channels-health"] });
      toast({ title: `${cfg.label} disconnected` });
      onClose();
    },
  });

  if (!cfg || !property) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-bold" style={{ color: platformColor(platformKey).ink }}>{cfg.label}</span>
            <span className="text-muted-foreground font-normal">·</span>
            <span className="font-normal text-muted-foreground text-sm">{property.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5 text-blue-500" />
            <div>
              <p className="font-medium text-foreground mb-0.5">iCal Calendar Sync</p>
              Paste the iCal URL from your {cfg.label} listing. Syncs automatically every 15 minutes.
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">{cfg.icalFieldLabel}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={`https://www.${platformKey === "airbnb" ? "airbnb.com" : platformKey === "booking_com" ? "booking.com" : "vrbo.com"}/ical/...`}
                value={icalUrl}
                onChange={e => setIcalUrl(e.target.value)}
                className="font-mono text-xs"
              />
              {icalUrl && (
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(icalUrl); toast({ title: "Copied" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">{cfg.listingFieldLabel}</Label>
            <Input
              placeholder={platformKey === "booking_com" ? "e.g. 1234567" : "e.g. 123456789"}
              value={listingId}
              onChange={e => setListingId(e.target.value)}
            />
          </div>

          {(property[cfg.icalField!] || property[cfg.listingField!]) && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4" />
              Currently connected — iCal syncs every 15 minutes
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(property[cfg.icalField!] || property[cfg.listingField!]) && (
            <Button
              variant="outline"
              className="text-red-500 border-red-200 hover:bg-red-50 mr-auto"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Connect Airbnb modal ─────────────────────────────────────────────────────
function ConnectAirbnbModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#DC2626] flex items-center justify-center">
              <AirbnbLogo className="w-4 h-4 text-white" />
            </div>
            Connect Airbnb
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Status note */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-amber-800 dark:text-amber-200">
              <p className="font-medium mb-0.5">Airbnb API access is invite-only</p>
              <p className="text-xs">Airbnb's official sync API is restricted to approved channel partners (Guesty, Hostaway, etc.). Co-Host Pro syncs via iCal — the same reliable method used across the industry.</p>
            </div>
          </div>

          {/* Option 1 */}
          <div className="rounded-xl border p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <div className="w-6 h-6 rounded-full bg-[#DC2626] flex items-center justify-center text-white text-xs font-bold">1</div>
              Add the property
            </div>
            <p className="text-xs text-muted-foreground ml-8">Create it on the Properties page (name, unit, owner). Co-Host Pro doesn't read Airbnb listing pages.</p>
            <div className="ml-8 mt-2">
              <Button
                className="h-8 text-xs"
                style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}
                onClick={() => { onClose(); window.location.href = window.location.origin + window.location.pathname.split("/platforms")[0] + "/properties"; }}
              >
                Go to Properties
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Option 2 */}
          <div className="rounded-xl border p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">2</div>
              Connect iCal Calendar Sync
            </div>
            <p className="text-xs text-muted-foreground ml-8">Add your Airbnb iCal export URL to an existing property. Bookings and blocked dates sync every 15 minutes.</p>
            <div className="ml-8 mt-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2 font-mono">
              Airbnb → Listing → Calendar → Availability Settings → Export Calendar
            </div>
          </div>

          {/* Sync method badge */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Wifi className="h-3.5 w-3.5 text-teal-500" />
            Active sync method: <span className="font-semibold text-foreground">iCal — every 15 minutes</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── System Health grid ────────────────────────────────────────────────────────
function SystemHealthTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["channels-health"],
    queryFn: () => fj("/api/channels/health"),
    refetchInterval: 60_000,
  });

  const resyncMutation = useMutation({
    // The property's calendar sync (Airbnb, Booking.com, Vrbo iCal links), the same as Sync now on Calendar sync.
    mutationFn: (propertyId: number) => fj(`/api/properties/${propertyId}/sync-ical`, { method: "POST" }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["channels-health"] });
      const failed = Object.values(r ?? {}).map((x: any) => x?.error).filter((e: any) => e && !/No .* iCal URL configured/.test(e));
      if (failed.length) toast({ title: "Sync failed", description: String(failed[0]), variant: "destructive" });
      else toast({ title: "iCal synced successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err?.message ?? "No iCal URL configured", variant: "destructive" });
    },
  });

  const health: any[] = data?.health ?? [];

  const totalConnected = health.filter(h => h.airbnbConnected).length;
  const totalIcal = health.filter(h => h.iCalConnected).length;
  const totalMissingPhotos = health.filter(h => h.missingPhotos).length;
  const totalNoIcal = health.filter(h => h.airbnbConnected && !h.iCalConnected).length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <div className="space-y-2">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Airbnb Connected", value: totalConnected, total: health.length, icon: AirbnbLogo, color: platformColor("airbnb").bg, good: totalConnected > 0 },
          { label: "iCal Syncing", value: totalIcal, total: health.length, icon: Wifi, color: "#0d9488", good: totalIcal > 0 },
          { label: "Missing iCal", value: totalNoIcal, total: health.length, icon: WifiOff, color: "#f59e0b", good: totalNoIcal === 0 },
          { label: "Missing Photos", value: totalMissingPhotos, total: health.length, icon: Image, color: "#6b7280", good: totalMissingPhotos === 0 },
        ].map(({ label, value, total, icon: Icon, color, good }) => (
          <Card key={label} className="border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <div className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${good ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" : "text-amber-600 bg-amber-50 dark:bg-amber-950/30"}`}>
                  {good ? "Good" : "Action needed"}
                </div>
              </div>
              <div className="text-2xl font-bold">{value}<span className="text-sm text-muted-foreground font-normal">/{total}</span></div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-property health table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="bg-muted/30 border-b px-4 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-teal-500" />
            Property Sync Status
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Auto-refreshes every 15 min
          </div>
        </div>

        <div className="divide-y">
          {health.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No properties found</div>
          ) : (
            health.map((h: any) => {
              const lastSyncRel = relativeTime(h.lastSync);
              const isSyncing = resyncMutation.isPending;
              return (
                <div key={h.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/10 transition-colors">
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{h.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {h.airbnbListingId && (
                        <span className="text-[11px] text-muted-foreground font-mono">Airbnb #{h.airbnbListingId}</span>
                      )}
                    </div>
                  </div>

                  {/* Airbnb status */}
                  <div className="text-center w-28 hidden sm:block">
                    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${h.airbnbConnected ? "" : "bg-muted text-muted-foreground"}`} style={h.airbnbConnected ? { background: platformColor("airbnb").softBg, color: platformColor("airbnb").softText } : undefined}>
                      <AirbnbLogo className="w-3 h-3" />
                      {h.airbnbConnected ? "Connected" : "Not set"}
                    </div>
                  </div>

                  {/* iCal status */}
                  <div className="text-center w-32 hidden md:block">
                    {h.iCalConnected ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="inline-flex items-center gap-1 text-xs text-teal-600">
                          <Wifi className="h-3 w-3" />
                          <span className="font-medium">iCal Active</span>
                        </div>
                        {lastSyncRel && (
                          <div className="text-[10px] text-muted-foreground">{lastSyncRel}</div>
                        )}
                        {h.syncCreated !== null && (
                          <div className="text-[10px] text-muted-foreground">{h.syncCreated} new bookings</div>
                        )}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1 text-xs text-amber-500">
                        <WifiOff className="h-3 w-3" />
                        <span>No iCal</span>
                      </div>
                    )}
                  </div>

                  {/* Photos */}
                  <div className="text-center w-20 hidden lg:block">
                    <div className={`text-xs font-medium ${h.photoCount > 0 ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                      {h.photoCount > 0 ? `${h.photoCount} photos` : "No photos"}
                    </div>
                  </div>

                  {/* Import status */}
                  <div className="w-28 hidden xl:block">
                    {h.importStatus === "imported_successfully" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                        <CheckCircle2 className="h-3 w-3" />Imported
                      </span>
                    ) : h.importStatus === "partially_imported" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                        <AlertTriangle className="h-3 w-3" />Partial
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50">—</span>
                    )}
                  </div>

                  {/* Re-sync button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 flex-shrink-0"
                    disabled={!h.iCalConnected || isSyncing}
                    onClick={() => resyncMutation.mutate(h.id)}
                    title={!h.iCalConnected ? "Connect an iCal URL first" : "Sync now"}
                  >
                    <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                    Sync Now
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* iCal guide */}
      <div className="rounded-xl border p-4 bg-muted/20">
        <div className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-teal-500" />
          How to get your Airbnb iCal URL
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          {[
            { n: 1, text: 'Open your Airbnb listing' },
            { n: 2, text: 'Go to Calendar → Availability Settings' },
            { n: 3, text: 'Click "Export Calendar" → Copy link' },
          ].map(({ n, text }) => (
            <div key={n} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#DC2626] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{n}</div>
              <span className="text-muted-foreground">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Import Audit Log tab ──────────────────────────────────────────────────────
function ImportLogTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["import-logs"],
    queryFn: () => fj("/api/channels/import-logs"),
  });

  const logs: any[] = data?.logs ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border bg-card py-16 text-center text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
        <div className="font-medium">No import attempts yet</div>
        <div className="text-sm mt-1">Airbnb link imports are switched off. Past imports would be listed here.</div>
      </div>
    );
  }

  function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
      imported_successfully: { label: "Success", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30" },
      partially_imported: { label: "Partial", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30" },
      failed_import: { label: "Failed", cls: "bg-red-50 text-red-600 dark:bg-red-950/30" },
    };
    const c = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
    return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}>{c.label}</span>;
  }

  function FieldCheck({ ok, label }: { ok: boolean; label: string }) {
    return (
      <div className={`flex items-center gap-1 text-[11px] ${ok ? "text-emerald-600" : "text-muted-foreground/40"}`}>
        {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        {label}
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="bg-muted/30 border-b px-4 py-3 text-sm font-semibold flex items-center gap-2">
        <Activity className="h-4 w-4 text-teal-500" />
        Import Audit Log
        <Badge variant="outline" className="ml-auto text-xs">{logs.length} entries</Badge>
      </div>
      <div className="divide-y">
        {logs.map((log: any) => (
          <div key={log.id} className="px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={log.status} />
                  <span className="text-xs text-muted-foreground">
                    {log.attemptedAt ? relativeTime(log.attemptedAt) : "—"}
                  </span>
                  {log.listingId && (
                    <span className="text-[11px] font-mono text-muted-foreground">#{log.listingId}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate max-w-sm">
                  {log.listingUrl}
                </div>
                {log.errorMessage && (
                  <div className="text-[11px] text-red-500 mt-1">{log.errorMessage}</div>
                )}
              </div>
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <FieldCheck ok={log.photosImported === "yes"} label="Photos" />
                <FieldCheck ok={log.pricesImported === "yes"} label="Price" />
                <FieldCheck ok={log.amenitiesImported === "yes"} label="Amenities" />
                <FieldCheck ok={log.calendarConnected === "yes"} label="Calendar" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Platforms() {
  const { data, isLoading } = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fj("/api/platforms"),
  });

  const [tab, setTab] = useState<"channels" | "health" | "logs">("channels");
  const [editing, setEditing] = useState<{ property: any; platformKey: string } | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const { toast } = useToast();

  const platforms: any[] = data?.platforms ?? [];
  const properties: any[] = data?.properties ?? [];

  const airbnbPlatform = platforms.find(p => p.key === "airbnb");
  const airbnbConnectedCount = airbnbPlatform?.connectedCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage distribution channels, sync calendars, and monitor connection health</p>
        </div>
        <Button
          onClick={() => setShowConnect(true)}
          className="gap-2 flex-shrink-0"
          style={{ background: "#DC2626", border: "none" }}
        >
          <AirbnbLogo className="w-4 h-4 text-white" />
          Connect Airbnb
        </Button>
      </div>

      {/* Airbnb connection status banner */}
      <div className="rounded-xl border p-4 flex items-center gap-4"
        style={{ background: airbnbConnectedCount > 0 ? "rgba(220,38,38,0.05)" : "rgba(0,0,0,0.02)", borderColor: airbnbConnectedCount > 0 ? "rgba(220,38,38,0.2)" : undefined }}>
        <div className="w-10 h-10 rounded-xl bg-[#DC2626] flex items-center justify-center flex-shrink-0">
          <AirbnbLogo className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Airbnb</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {airbnbConnectedCount > 0
              ? `${airbnbConnectedCount} ${airbnbConnectedCount === 1 ? "property" : "properties"} connected · iCal sync active · every 15 minutes`
              : "No properties connected yet — add the property, then its Airbnb iCal URL"}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {airbnbConnectedCount > 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Syncing
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowConnect(true)}>
              Set up
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: "channels", label: "Channels", icon: BarChart3 },
          { key: "health", label: "System Health", icon: Activity },
          { key: "logs", label: "Import Log", icon: Clock },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === key
              ? "border-teal-500 text-teal-600 dark:text-teal-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Channels tab ── */}
      {tab === "channels" && (
        <div className="space-y-8">
          {/* Platform Cards */}
          <section>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Channel Performance</div>
            {isLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {platforms.map(p => {
                  const cfg = PLATFORM_CONFIG[p.key];
                  if (!cfg) return null;
                  const connected = p.connectedCount > 0 || p.key === "direct";
                  return (
                    <Card key={p.key} className={`overflow-hidden border ${connected ? "" : "opacity-60"}`}>
                      <div className="h-1 w-full" style={{ background: platformColor(p.key).bg }} />
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="font-semibold text-sm">{cfg.label}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {connected
                                ? <><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span className="text-[11px] text-emerald-600 font-medium">Active</span></>
                                : <><XCircle className="h-3 w-3 text-muted-foreground" /><span className="text-[11px] text-muted-foreground">Not connected</span></>}
                            </div>
                          </div>
                          {p.key !== "direct" && (
                            <Badge variant="outline" className="text-[11px]">{p.connectedCount}/{p.totalProperties}</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center">
                          <div>
                            <div className="text-lg font-bold">{p.bookings}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Bookings</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold">{p.nights}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Nights</div>
                          </div>
                          <div>
                            <div className="text-xs font-bold">{aed(p.revenue)}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide" title="Net accommodation revenue from bookings with a verified breakdown (excludes VAT and Tourism Dirham)">Verified revenue</div>
                            {(p as any).unverifiedBookings > 0 && <div className="text-[10px] text-amber-600">{(p as any).unverifiedBookings} not verified</div>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* Revenue chart */}
          {!isLoading && platforms.some(p => p.revenue > 0) && (
            <section>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Revenue by Channel</div>
              <Card>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={platforms.filter(p => p.revenue > 0)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => aed(Number(v))} />
                      <Bar dataKey="revenue" radius={[6, 6, 0, 0]} name="Revenue">
                        {platforms.filter(p => p.revenue > 0).map((p, i) => (
                          <Cell key={i} fill={platformColor(p.key).bg} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Property Connection Grid */}
          <section>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Property Channel Connections</div>
            <div className="rounded-xl border overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Property</th>
                    {["airbnb", "booking_com", "vrbo"].map(key => {
                      const cfg = PLATFORM_CONFIG[key];
                      return (
                        <th key={key} className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: platformColor(key).bg }} />
                            <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{cfg.label}</span>
                          </div>
                        </th>
                      );
                    })}
                    <th className="px-4 py-3 text-center">
                      <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Direct</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array(4).fill(0).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                        {Array(4).fill(0).map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-6 w-20 mx-auto" /></td>)}
                      </tr>
                    ))
                  ) : properties.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">No properties found</td></tr>
                  ) : (
                    properties.map(prop => (
                      <tr key={prop.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{prop.name}</div>
                          <div className="text-xs text-muted-foreground">{prop.unitNumber}{prop.building ? ` · ${prop.building}` : ""}</div>
                        </td>
                        {["airbnb", "booking_com", "vrbo"].map(key => {
                          const cfg = PLATFORM_CONFIG[key];
                          const connected = isConnected(prop, key);
                          const icalUrl = prop[cfg.icalField!];
                          const listingId = prop[cfg.listingField!];
                          return (
                            <td key={key} className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-1.5">
                                {connected ? (
                                  <>
                                    <div className="flex items-center gap-1 text-emerald-600">
                                      <CheckCircle2 className="h-4 w-4" />
                                      <span className="text-xs font-medium">Connected</span>
                                    </div>
                                    {listingId && <span className="text-[10px] text-muted-foreground font-mono">#{listingId}</span>}
                                    {icalUrl && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-teal-600 flex items-center gap-0.5">
                                          <Wifi className="h-2.5 w-2.5" />iCal
                                        </span>
                                        <button onClick={() => { navigator.clipboard.writeText(icalUrl); toast({ title: "Copied" }); }} title="Copy">
                                          <Copy className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <XCircle className="h-4 w-4" />
                                    <span className="text-xs">Not set</span>
                                  </div>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[11px] px-2"
                                  onClick={() => setEditing({ property: prop, platformKey: key })}
                                >
                                  <Pencil className="h-2.5 w-2.5 mr-1" />
                                  {connected ? "Edit" : "Connect"}
                                </Button>
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1 text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-xs font-medium">Always On</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── System Health tab ── */}
      {tab === "health" && <SystemHealthTab />}

      {/* ── Import Log tab ── */}
      {tab === "logs" && <ImportLogTab />}

      {/* Dialogs */}
      {editing && (
        <ConnectionDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          property={editing.property}
          platformKey={editing.platformKey}
        />
      )}
      <ConnectAirbnbModal open={showConnect} onClose={() => setShowConnect(false)} />
    </div>
  );
}
