import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  X, ChevronRight, Sparkles, Loader2, Info, TrendingUp, AlertTriangle,
  CheckCircle2, Layers, ChevronLeft, Mail, DollarSign, Building2,
  ClipboardList, Wifi, Key,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportReport {
  photosImported: boolean;
  pricesImported: boolean;
  amenitiesImported: boolean;
  calendarConnected: boolean;
  bookingsImported: boolean;
  importedFields: string[];
  failedFields: string[];
  errors: string[];
  importStatus: "imported_successfully" | "partially_imported" | "failed_import";
}

interface ImportedData {
  listingId: string;
  name: string;
  location: string;
  area: string;
  city?: string;
  country?: string;
  building: string;
  description: string;
  photos: string[];
  amenities: string[];
  bedrooms: number;
  bathrooms: number;
  guestCapacity: number;
  bedroomType: string;
  listingUrl: string;
  baseNightlyPrice?: string | null;
  houseRules?: string | null;
  propertyType?: string | null;
}

type Step = "choose" | "url" | "fetching" | "bulk-review" | "success";

interface BulkItem {
  key: string;
  url: string;
  status: "pending" | "fetching" | "done" | "error";
  data?: ImportedData;
  importReport?: ImportReport;
  error?: string;
  removed: boolean;
  isDuplicate: boolean;
  name: string;
  unitNumber: string;
  ownerName: string;
  ownerEmail: string;
  cleaningFee: string;
  managementFee: string;
  checkInInstructions: string;
  wifiDetails: string;
  accessDetails: string;
  expanded: boolean;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-3 h-3 text-white/30 hover:text-teal-400 cursor-help transition-colors flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-center leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FormField({ icon, label, value, onChange, placeholder, type = "text", tip }: {
  icon: React.ReactNode; label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string; type?: string; tip?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
        {icon}{label}{tip && <InfoTip text={tip} />}
      </Label>
      <Input value={value} onChange={onChange} placeholder={placeholder} type={type}
        className="h-9 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm" />
    </div>
  );
}

function TextareaField({ icon, label, value, onChange, placeholder, tip }: {
  icon: React.ReactNode; label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder: string; tip?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
        {icon}{label}{tip && <InfoTip text={tip} />}
      </Label>
      <Textarea value={value} onChange={onChange} placeholder={placeholder} rows={2}
        className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm resize-none" />
    </div>
  );
}

// Suppress unused-variable warnings for helpers that may be used in future steps
void FormField;
void TextareaField;

// ─── BulkImportWizard (formerly AirbnbImportModal) ───────────────────────────

export function BulkImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>("choose");
  const [urlsText, setUrlsText] = useState("");
  const [urlError, setUrlError] = useState("");
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [reservationsImported, setReservationsImported] = useState(0);
  const [defaults, setDefaults] = useState({ ownerEmail: "", ownerName: "", cleaningFee: "", managementFee: "", checkInInstructions: "", wifiDetails: "", accessDetails: "" });
  const [savedReports, setSavedReports] = useState<Array<{ name: string; report: ImportReport }>>([]);

  function parseUrls(text: string): string[] {
    return text.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
  }

  async function handleImport() {
    const urls = parseUrls(urlsText);
    if (urls.length === 0) { setUrlError("Paste at least one Airbnb listing URL"); return; }
    const invalid = urls.filter(u => !u.includes("airbnb") && !u.includes("abnb.me"));
    if (invalid.length > 0) {
      setUrlError(`These don't look like Airbnb URLs: ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? ` (+${invalid.length - 2} more)` : ""}`);
      return;
    }
    setUrlError("");
    const items: BulkItem[] = urls.map((url, i) => ({
      key: `${i}-${url}`,
      url,
      status: "pending",
      removed: false,
      isDuplicate: false,
      name: "",
      unitNumber: "",
      ownerName: defaults.ownerName,
      ownerEmail: defaults.ownerEmail,
      cleaningFee: defaults.cleaningFee,
      managementFee: defaults.managementFee,
      checkInInstructions: defaults.checkInInstructions,
      wifiDetails: defaults.wifiDetails,
      accessDetails: defaults.accessDetails,
      expanded: false,
    }));
    setBulkItems(items);
    setStep("fetching");

    for (let i = 0; i < items.length; i++) {
      setBulkItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "fetching" } : it));
      try {
        const res = await apiFetch(`${API_BASE}/api/airbnb/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: items[i].url }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Import failed");
        const d: ImportedData = json.data;
        const report: ImportReport | undefined = json.report;
        setBulkItems(prev => prev.map((it, idx) => idx === i
          ? { ...it, status: "done", data: d, importReport: report, name: d.name, unitNumber: "" }
          : it));
      } catch (err) {
        setBulkItems(prev => prev.map((it, idx) => idx === i
          ? { ...it, status: "error", error: err instanceof Error ? err.message : "Import failed" }
          : it));
      }
    }
    try {
      const finalItems = await new Promise<BulkItem[]>(resolve => {
        setBulkItems(current => { resolve(current); return current; });
      });
      const listingIds = finalItems
        .filter(it => it.status === "done" && it.data)
        .map(it => it.data!.listingId);
      if (listingIds.length > 0) {
        const dupRes = await apiFetch(`${API_BASE}/api/airbnb/check-duplicates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingIds }),
        });
        if (dupRes.ok) {
          const dupJson = await dupRes.json();
          const existingSet = new Set<string>((dupJson as { existingIds: string[] }).existingIds ?? []);
          if (existingSet.size > 0) {
            setBulkItems(prev => prev.map(it =>
              it.data && existingSet.has(it.data.listingId)
                ? { ...it, isDuplicate: true }
                : it
            ));
          }
        }
      }
    } catch {
      // non-fatal — proceed without duplicate markers
    }

    setStep("bulk-review");
  }

  function toggleRemove(key: string) {
    setBulkItems(prev => prev.map(it => it.key === key ? { ...it, removed: !it.removed } : it));
  }

  function toggleExpand(key: string) {
    setBulkItems(prev => prev.map(it => it.key === key ? { ...it, expanded: !it.expanded } : it));
  }

  async function retryItem(key: string) {
    const item = bulkItems.find(it => it.key === key);
    if (!item) return;
    setBulkItems(prev => prev.map(it => it.key === key ? { ...it, status: "fetching", error: undefined } : it));
    try {
      const res = await apiFetch(`${API_BASE}/api/airbnb/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      const d: ImportedData = json.data;
      const report: ImportReport | undefined = json.report;
      setBulkItems(prev => prev.map(it => it.key === key
        ? { ...it, status: "done", data: d, importReport: report, name: d.name, unitNumber: "", isDuplicate: false }
        : it));
      try {
        const dupRes = await apiFetch(`${API_BASE}/api/airbnb/check-duplicates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingIds: [d.listingId] }),
        });
        if (dupRes.ok) {
          const dupJson = await dupRes.json();
          const existingSet = new Set<string>((dupJson as { existingIds: string[] }).existingIds ?? []);
          if (existingSet.has(d.listingId)) {
            setBulkItems(prev => prev.map(it => it.key === key ? { ...it, isDuplicate: true } : it));
          }
        }
      } catch {
        // non-fatal
      }
    } catch (err) {
      setBulkItems(prev => prev.map(it => it.key === key
        ? { ...it, status: "error", error: err instanceof Error ? err.message : "Import failed" }
        : it));
    }
  }

  function updateItem(key: string, field: "name" | "unitNumber" | "ownerName" | "ownerEmail" | "cleaningFee" | "managementFee" | "checkInInstructions" | "wifiDetails" | "accessDetails", value: string) {
    setBulkItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value } : it));
  }

  function applyDefaultsToAll() {
    setBulkItems(prev => prev.map(it => ({
      ...it,
      ownerName: defaults.ownerName,
      ownerEmail: defaults.ownerEmail,
      cleaningFee: defaults.cleaningFee,
      managementFee: defaults.managementFee,
      checkInInstructions: defaults.checkInInstructions,
      wifiDetails: defaults.wifiDetails,
      accessDetails: defaults.accessDetails,
    })));
  }

  function advanceOnboardingStep() {
    if (!localStorage.getItem("ys_onboarded")) {
      const cur = parseInt(localStorage.getItem("ys_onboarding_step") ?? "0", 10);
      if (cur <= 1) localStorage.setItem("ys_onboarding_step", "2");
    }
  }

  async function handleBulkSave() {
    const toSave = bulkItems.filter(it => !it.removed && it.status === "done" && it.data);
    if (toSave.length === 0) return;
    setSaving(true);
    setUrlError("");
    try {
      const properties = toSave.map(it => ({
        name: it.name || it.data!.name,
        unitNumber: it.unitNumber || "TBC",
        building: it.data!.building || null,
        area: it.data!.area || null,
        city: it.data!.city || null,
        country: it.data!.country || null,
        bedroomType: it.data!.bedroomType || null,
        status: "active",
        airbnbListingId: it.data!.listingId,
        airbnbChannelStatus: "connected",
        listingUrl: it.data!.listingUrl,
        ...((it.data as unknown as Record<string, unknown>).airbnbIcalUrl ? { airbnbIcalUrl: (it.data as unknown as Record<string, unknown>).airbnbIcalUrl } : {}),
        description: it.data!.description || null,
        photos: JSON.stringify(it.data!.photos),
        amenities: JSON.stringify(it.data!.amenities),
        bedrooms: it.data!.bedrooms || null,
        bathrooms: it.data!.bathrooms || null,
        guestCapacity: it.data!.guestCapacity || null,
        baseNightlyPrice: it.data!.baseNightlyPrice || null,
        propertyType: it.data!.propertyType || null,
        importStatus: it.importReport?.importStatus || "partially_imported",
        ...(it.ownerName ? { importedOwnerName: it.ownerName } : {}),
        ...(it.ownerEmail ? { importedOwnerEmail: it.ownerEmail } : {}),
        ...(it.cleaningFee ? { cleaningFee: it.cleaningFee } : {}),
        ...(it.managementFee ? { managementFee: it.managementFee } : {}),
        ...(it.checkInInstructions ? { checkInInstructions: it.checkInInstructions } : {}),
        ...(it.wifiDetails ? { wifiDetails: it.wifiDetails } : {}),
        ...(it.accessDetails ? { accessDetails: it.accessDetails } : {}),
      }));
      const res = await apiFetch(`${API_BASE}/api/properties/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("ys_auth")
            ? { Authorization: `Bearer ${JSON.parse(localStorage.getItem("ys_auth")!).token}` }
            : {}),
        },
        body: JSON.stringify({ properties }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.propertyLimitReached) {
          setUrlError(`__LIMIT__:${json.limit}:${json.plan}`);
          setSaving(false);
          return;
        }
        throw new Error((json as { error?: string }).error || `Save failed (${res.status})`);
      }
      const json = await res.json();
      setSavedCount((json.created as unknown[])?.length ?? toSave.length);
      setReservationsImported((json.reservationsImported as number) ?? 0);
      setSavedReports(toSave
        .filter(it => it.importReport)
        .map(it => ({ name: it.name || it.data!.name, report: it.importReport! }))
      );
      advanceOnboardingStep();
      setStep("success");
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const confirmedCount = bulkItems.filter(it => !it.removed && it.status === "done").length;
  const isBulkStep = step === "fetching" || step === "bulk-review";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl"
        style={{
          maxWidth: isBulkStep ? 860 : 520,
          background: "linear-gradient(135deg, #06101a 0%, #071524 100%)",
          border: "1px solid rgba(45,212,191,0.18)",
          boxShadow: "0 0 60px rgba(13,148,136,0.15), 0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "rgba(45,212,191,0.12)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(45,212,191,0.15)" }}>
              <img src="https://a0.muscache.com/airbnb/static/icons/android-icon-192x192-c0465f9f0380893768972a31a614-192x192-f93942f236e52b1096d6a28fa2dbed1f.png"
                alt="Airbnb" className="w-5 h-5 rounded" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
            <div>
              <div className="font-bold text-sm text-white">Connect Airbnb</div>
              <div className="text-[11px] text-teal-400/70">
                {isBulkStep && bulkItems.length > 1 ? `Importing ${bulkItems.length} listings` : "Import listing to YallaPMS"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step: Choose ── */}
          {step === "choose" && (
            <motion.div key="choose" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Import your Airbnb listings</h2>
                <p className="text-sm text-white/50">No manual entry needed — paste one or more URLs and we handle the rest.</p>
              </div>
              <button
                onClick={() => setStep("url")}
                className="w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all hover:border-teal-400/50 hover:bg-teal-400/5 group"
                style={{ background: "rgba(45,212,191,0.04)", borderColor: "rgba(45,212,191,0.2)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(45,212,191,0.15)" }}>
                  <Layers className="w-5 h-5 text-teal-400" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white text-sm">Paste Airbnb Listing URLs</div>
                  <div className="text-xs text-white/50 mt-0.5">One URL per line — import a single listing or dozens at once</div>
                </div>
                <ChevronRight className="w-4 h-4 text-teal-400 group-hover:translate-x-1 transition-transform" />
              </button>
              <div className="w-full flex items-center gap-4 p-4 rounded-xl border opacity-50 cursor-not-allowed"
                style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.1)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/10">
                  <Sparkles className="w-5 h-5 text-white/40" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white/60 text-sm">Connect Airbnb Account</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>COMING SOON</span>
                  </div>
                  <div className="text-xs text-white/30 mt-0.5">Official Airbnb integration — sync bookings &amp; calendar automatically</div>
                </div>
              </div>
              <p className="text-[11px] text-white/30 text-center px-4">
                Airbnb account connection is coming soon. For now, paste your listing URLs and YallaPMS will create property profiles automatically.
              </p>
            </motion.div>
          )}

          {/* ── Step: URL input ── */}
          {step === "url" && (
            <motion.div key="url" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Paste listing URLs</h2>
                <p className="text-sm text-white/50">One URL per line. Mix and match — short links and full URLs both work.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider">Airbnb URLs</Label>
                <textarea
                  value={urlsText}
                  onChange={e => setUrlsText(e.target.value)}
                  rows={5}
                  placeholder={"https://www.airbnb.com/rooms/12345678\nhttps://abnb.me/abc123\nhttps://www.airbnb.com/rooms/87654321"}
                  className="w-full rounded-xl px-3 py-2.5 text-sm resize-none bg-white/5 border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:border-teal-400/50"
                />
              </div>

              {/* Defaults */}
              <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Default values (optional)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5 text-teal-400/50" />Owner Email
                    </label>
                    <Input value={defaults.ownerEmail} onChange={e => setDefaults(d => ({ ...d, ownerEmail: e.target.value }))}
                      placeholder="owner@email.com"
                      className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Building2 className="w-2.5 h-2.5 text-teal-400/50" />Owner Name
                    </label>
                    <Input value={defaults.ownerName} onChange={e => setDefaults(d => ({ ...d, ownerName: e.target.value }))}
                      placeholder="John Smith"
                      className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <DollarSign className="w-2.5 h-2.5 text-teal-400/50" />Cleaning Fee AED
                    </label>
                    <Input value={defaults.cleaningFee} onChange={e => setDefaults(d => ({ ...d, cleaningFee: e.target.value }))}
                      placeholder="e.g. 150" type="number" min="0"
                      className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <TrendingUp className="w-2.5 h-2.5 text-teal-400/50" />Management Fee %
                    </label>
                    <Input value={defaults.managementFee} onChange={e => setDefaults(d => ({ ...d, managementFee: e.target.value }))}
                      placeholder="e.g. 20" type="number" min="0" max="100"
                      className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <ClipboardList className="w-2.5 h-2.5 text-teal-400/50" />Check-in Instructions
                    </label>
                    <Textarea value={defaults.checkInInstructions} onChange={e => setDefaults(d => ({ ...d, checkInInstructions: e.target.value }))}
                      placeholder="e.g. Key in lockbox on front door. Code: 1234. Check-in from 3pm." rows={2}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Wifi className="w-2.5 h-2.5 text-teal-400/50" />WiFi Details
                    </label>
                    <Textarea value={defaults.wifiDetails} onChange={e => setDefaults(d => ({ ...d, wifiDetails: e.target.value }))}
                      placeholder="e.g. Network: BuildingWifi_5G  Password: MyPass123" rows={2}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <Key className="w-2.5 h-2.5 text-teal-400/50" />Access Details
                    </label>
                    <Textarea value={defaults.accessDetails} onChange={e => setDefaults(d => ({ ...d, accessDetails: e.target.value }))}
                      placeholder="e.g. Building access code: 5678. Parking: Level B2, Bay 14." rows={2}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                  </div>
                </div>
              </div>

              {urlError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{urlError}</p>}
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep("choose")} className="text-white/50 hover:text-white border border-white/10 hover:border-white/20">
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" />Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!urlsText.trim()}
                  className="flex-1 h-11 font-bold text-base gap-2"
                  style={{ background: urlsText.trim() ? "linear-gradient(135deg, #0d9488, #0891b2)" : undefined, border: "none" }}
                >
                  Import {parseUrls(urlsText).length > 0 ? `${parseUrls(urlsText).length} listing${parseUrls(urlsText).length !== 1 ? "s" : ""}` : "listings"} →
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step: Fetching / Bulk Review ── */}
          {(step === "fetching" || step === "bulk-review") && (
            <motion.div key="bulk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col" style={{ maxHeight: "82vh" }}>
              {/* Defaults bar */}
              <div className="px-6 py-3 border-b flex items-center gap-3 flex-wrap flex-shrink-0" style={{ borderColor: "rgba(45,212,191,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex-shrink-0">Apply defaults to all</div>
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  <Input value={defaults.ownerEmail} onChange={e => setDefaults(d => ({ ...d, ownerEmail: e.target.value }))} placeholder="Owner email"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-40" />
                  <Input value={defaults.ownerName} onChange={e => setDefaults(d => ({ ...d, ownerName: e.target.value }))} placeholder="Owner name"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-32" />
                  <Input value={defaults.cleaningFee} onChange={e => setDefaults(d => ({ ...d, cleaningFee: e.target.value }))} placeholder="Cleaning AED" type="number"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-28" />
                  <Input value={defaults.managementFee} onChange={e => setDefaults(d => ({ ...d, managementFee: e.target.value }))} placeholder="Mgmt %" type="number"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-20" />
                  <Input value={defaults.checkInInstructions} onChange={e => setDefaults(d => ({ ...d, checkInInstructions: e.target.value }))} placeholder="Check-in instructions"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-44" />
                  <Input value={defaults.wifiDetails} onChange={e => setDefaults(d => ({ ...d, wifiDetails: e.target.value }))} placeholder="WiFi details"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-36" />
                  <Input value={defaults.accessDetails} onChange={e => setDefaults(d => ({ ...d, accessDetails: e.target.value }))} placeholder="Access details"
                    className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 w-36" />
                  <button onClick={applyDefaultsToAll}
                    className="h-7 px-3 rounded-lg text-xs font-semibold text-teal-300 border border-teal-400/30 hover:bg-teal-400/10 transition-colors flex-shrink-0">
                    Apply to all
                  </button>
                </div>
              </div>

              {/* Item list */}
              <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                {bulkItems.map((item) => {
                  const isRemoved = item.removed;
                  const hasDetails = !!(item.ownerName || item.ownerEmail || item.cleaningFee || item.managementFee || item.checkInInstructions || item.wifiDetails || item.accessDetails);
                  return (
                    <div key={item.key} className={`transition-all ${isRemoved ? "opacity-40" : ""}`}>
                      {/* Row */}
                      <div className="px-4 py-3 flex items-center gap-3">
                        {/* Status */}
                        <div className="flex-shrink-0 w-5 flex items-center justify-center">
                          {item.status === "fetching" && <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />}
                          {item.status === "done" && !item.isDuplicate && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                          {item.status === "done" && item.isDuplicate && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                          {item.status === "error" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                          {item.status === "pending" && <div className="w-3 h-3 rounded-full border border-white/20" />}
                        </div>

                        {/* Thumbnail */}
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex-shrink-0 border border-white/10">
                          {item.data?.photos?.[0]
                            ? <img src={item.data.photos[0]} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            : <div className="w-full h-full flex items-center justify-center text-white/10"><Building2 className="w-4 h-4" /></div>}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          {item.status === "fetching" && <div className="text-xs text-white/50 truncate">Fetching {item.url.slice(0, 40)}…</div>}
                          {item.status === "done" && (
                            <>
                              <div className="flex items-center gap-2">
                                <input value={item.name} onChange={e => updateItem(item.key, "name", e.target.value)} disabled={isRemoved}
                                  className="flex-1 min-w-0 h-6 bg-transparent border-b border-white/10 text-white text-xs font-semibold focus:outline-none focus:border-teal-400/50 truncate"
                                  placeholder="Property name" />
                                {item.isDuplicate && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(245,158,11,0.2)", color: "#fbbf24" }}>DUPLICATE</span>}
                              </div>
                              <div className="text-[10px] text-white/35 truncate mt-0.5">
                                {[item.data?.area, item.data?.bedroomType].filter(Boolean).join(" · ")} · {item.data?.listingId}
                              </div>
                            </>
                          )}
                          {item.status === "error" && (
                            <div className="text-xs text-red-400 truncate">{item.error}</div>
                          )}
                          {item.status === "pending" && (
                            <div className="text-xs text-white/30 truncate">{item.url.slice(0, 50)}</div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.status === "done" && (
                            <button onClick={() => toggleExpand(item.key)} disabled={isRemoved}
                              className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors">
                              <ChevronRight className={`w-3 h-3 transition-transform ${item.expanded ? "rotate-90" : ""}`} />
                            </button>
                          )}
                          {item.status === "error" && (
                            <button onClick={() => retryItem(item.key)}
                              className="text-[10px] px-2 py-1 rounded-lg border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors">
                              Retry
                            </button>
                          )}
                          <button onClick={() => toggleRemove(item.key)}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${isRemoved ? "text-teal-400 hover:bg-teal-400/10" : "text-white/20 hover:text-red-400 hover:bg-red-400/10"}`}>
                            {isRemoved ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {item.expanded && item.status === "done" && (
                        <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <Building2 className="w-2.5 h-2.5 text-teal-400/50" />Unit #
                            </label>
                            <Input value={item.unitNumber} onChange={e => updateItem(item.key, "unitNumber", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. 301" className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5 text-teal-400/50" />Owner Email
                            </label>
                            <Input value={item.ownerEmail} onChange={e => updateItem(item.key, "ownerEmail", e.target.value)} disabled={isRemoved}
                              placeholder="owner@email.com" className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <DollarSign className="w-2.5 h-2.5 text-teal-400/50" />Cleaning Fee AED
                            </label>
                            <Input value={item.cleaningFee} onChange={e => updateItem(item.key, "cleaningFee", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. 150" type="number" min="0"
                              className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <TrendingUp className="w-2.5 h-2.5 text-teal-400/50" />Management Fee %
                            </label>
                            <Input value={item.managementFee} onChange={e => updateItem(item.key, "managementFee", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. 20" type="number" min="0" max="100"
                              className="h-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2" />
                          </div>
                          <div className="col-span-2 sm:col-span-4 space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <ClipboardList className="w-2.5 h-2.5 text-teal-400/50" />Check-in Instructions
                            </label>
                            <Textarea value={item.checkInInstructions} onChange={e => updateItem(item.key, "checkInInstructions", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. Key in lockbox on front door. Code: 1234." rows={2}
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <Wifi className="w-2.5 h-2.5 text-teal-400/50" />WiFi Details
                            </label>
                            <Textarea value={item.wifiDetails} onChange={e => updateItem(item.key, "wifiDetails", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. Network: MyWifi  Password: Pass123" rows={2}
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/35 font-semibold uppercase tracking-wider flex items-center gap-1">
                              <Key className="w-2.5 h-2.5 text-teal-400/50" />Access Details
                            </label>
                            <Textarea value={item.accessDetails} onChange={e => updateItem(item.key, "accessDetails", e.target.value)} disabled={isRemoved}
                              placeholder="e.g. Building code: 5678. Parking: Level B2, Bay 14." rows={2}
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-xs px-2 py-1.5 resize-none" />
                          </div>
                          {hasDetails && (
                            <div className="col-span-2 sm:col-span-4 flex items-center gap-1 text-[10px] text-teal-400/60">
                              <CheckCircle2 className="w-3 h-3" />Override set for this property
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t space-y-3 flex-shrink-0" style={{ borderColor: "rgba(45,212,191,0.1)" }}>
                {urlError && !urlError.startsWith("__LIMIT__") && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{urlError}</p>
                )}
                {urlError?.startsWith("__LIMIT__") && (() => {
                  const [,limit] = urlError.split(":");
                  return (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                      <p className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />Property limit reached
                      </p>
                      <p className="text-xs text-amber-200/70">
                        You've reached your {limit}-property limit on the current plan. Upgrade to add unlimited properties.
                      </p>
                      <a href="/subscriptions" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-semibold hover:bg-teal-500/30 transition-colors">
                        Upgrade plan →
                      </a>
                    </div>
                  );
                })()}
                <div className="flex gap-3">
                  <Button variant="ghost"
                    onClick={() => {
                      const failedUrls = bulkItems.filter(i => i.status === "error").map(i => i.url);
                      setUrlsText(failedUrls.join("\n"));
                      setStep("url");
                    }}
                    className="text-white/50 hover:text-white border border-white/10 hover:border-white/20">
                    {bulkItems.some(i => i.status === "error") ? (
                      <><ChevronLeft className="w-3.5 h-3.5 mr-1" />Retry {bulkItems.filter(i => i.status === "error").length} Failed</>
                    ) : (
                      <><ChevronLeft className="w-3.5 h-3.5 mr-1" />Back</>
                    )}
                  </Button>
                  <Button onClick={handleBulkSave} disabled={saving || confirmedCount === 0} className="flex-1 h-11 font-bold text-base gap-2"
                    style={{ background: confirmedCount > 0 ? "linear-gradient(135deg, #0d9488, #0891b2)" : undefined, border: "none", boxShadow: confirmedCount > 0 ? "0 4px 20px rgba(13,148,136,0.35)" : undefined }}>
                    {saving
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
                      : <><CheckCircle2 className="w-4 h-4" />Add {confirmedCount} {confirmedCount === 1 ? "Property" : "Properties"} to PMS</>}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Step: Success ── */}
          {step === "success" && (() => {
            const allImported = savedReports.every(r => r.report.importStatus === "imported_successfully");
            const anyFailed = savedReports.some(r => r.report.importStatus === "failed_import");
            const overallStatus = anyFailed ? "failed_import" : allImported ? "imported_successfully" : "partially_imported";
            const statusConfig = {
              imported_successfully: { color: "#34d399", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.3)", label: "Imported successfully", Icon: CheckCircle2 },
              partially_imported: { color: "#fbbf24", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", label: "Partially imported", Icon: AlertTriangle },
              failed_import: { color: "#f87171", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", label: "Failed import", Icon: AlertTriangle },
            }[overallStatus];
            const totalErrors: string[] = [];
            savedReports.forEach(r => r.report.errors.forEach(e => { if (!totalErrors.includes(e)) totalErrors.push(e); }));
            const photosOk = savedReports.every(r => r.report.photosImported);
            const pricesOk = savedReports.every(r => r.report.pricesImported);
            const amenitiesOk = savedReports.every(r => r.report.amenitiesImported);
            const calendarOk = savedReports.every(r => r.report.calendarConnected);

            return (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col overflow-y-auto" style={{ maxHeight: "82vh" }}>
                <div className="p-7 flex flex-col items-center gap-3 text-center border-b" style={{ borderColor: "rgba(45,212,191,0.1)" }}>
                  <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ background: statusConfig.bg, border: `1px solid ${statusConfig.border}` }}>
                    <statusConfig.Icon className="w-8 h-8" style={{ color: statusConfig.color }} />
                  </motion.div>
                  <div>
                    <div className="text-xl font-bold text-white mb-1">
                      {savedCount === 1 ? "Property added" : `${savedCount} properties added`} to YallaPMS
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                      style={{ background: statusConfig.bg, border: `1px solid ${statusConfig.border}`, color: statusConfig.color }}>
                      {statusConfig.label}
                    </div>
                  </div>
                  {reservationsImported > 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold"
                      style={{ background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.25)", color: "#2dd4bf" }}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {reservationsImported} {reservationsImported === 1 ? "reservation" : "reservations"} imported
                    </div>
                  )}
                </div>

                <div className="px-6 py-4 space-y-4">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Import Validation Report</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Photos", ok: photosOk, failMsg: "Not imported — upload manually" },
                      { label: "Bookings / Calendar", ok: calendarOk, failMsg: "Connect iCal to sync bookings" },
                      { label: "Base Nightly Price", ok: pricesOk, failMsg: "Not detected — set in Pricing" },
                      { label: "Amenities", ok: amenitiesOk, failMsg: "Not detected — add manually" },
                    ].map(({ label, ok, failMsg }) => (
                      <div key={label} className="rounded-xl p-3 flex items-start gap-2.5"
                        style={{ background: ok ? "rgba(16,185,129,0.07)" : "rgba(245,158,11,0.07)", border: `1px solid ${ok ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                        {ok
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />}
                        <div>
                          <div className="text-xs font-semibold text-white">{label}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: ok ? "#34d399" : "#fbbf24" }}>{ok ? "Imported" : failMsg}</div>
                        </div>
                      </div>
                    ))}
                    <div className="rounded-xl p-3 flex items-start gap-2.5"
                      style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-white">Airbnb Calendar</div>
                        <div className="text-[11px] text-amber-400 mt-0.5">Connect iCal or Airbnb API</div>
                      </div>
                    </div>
                    <div className="rounded-xl p-3 flex items-start gap-2.5"
                      style={{ background: "rgba(45,212,191,0.07)", border: "1px solid rgba(45,212,191,0.2)" }}>
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-white">Channel</div>
                        <div className="text-[11px] text-teal-400 mt-0.5">Airbnb — Connected</div>
                      </div>
                    </div>
                  </div>

                  {totalErrors.length > 0 && (
                    <div className="rounded-xl p-3 space-y-1.5"
                      style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <div className="text-[10px] font-bold text-red-400/80 uppercase tracking-widest">Errors Found</div>
                      {totalErrors.map((e, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-red-300/80">
                          <span className="flex-shrink-0 text-red-400">·</span>{e}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl p-3 space-y-1"
                    style={{ background: "rgba(45,212,191,0.05)", border: "1px solid rgba(45,212,191,0.15)" }}>
                    <div className="text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">Next step: Connect iCal</div>
                    <p className="text-xs text-white/55">To import bookings and keep the calendar in sync, open each property and paste your Airbnb iCal URL (Settings → Availability → Export Calendar).</p>
                  </div>
                </div>

                <div className="px-6 pb-6 pt-2">
                  <Button onClick={() => { onDone(); onClose(); }} className="w-full h-11 font-semibold text-base"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}>
                    View Properties
                  </Button>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
