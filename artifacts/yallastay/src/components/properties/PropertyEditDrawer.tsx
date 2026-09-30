import { useGetOwners } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/api-fetch";
import { AirbnbSourceDetails } from "./AirbnbSourceDetails";
import { useState, useEffect, useRef } from "react";
import { useUpload } from "@workspace/object-storage-web";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, X, Link2, Wifi, Key, ClipboardList, CheckCircle2,
  BedDouble, Bath, Users, MapPin, ExternalLink, ChevronRight,
  Layers, Loader2, Building2, Mail, DollarSign, AlertTriangle,
  Pencil, ImagePlus, Trash2, Save, ChevronLeft, RotateCcw, Star, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Suppress unused imports that are available for future use
void Link2; void ExternalLink; void ChevronRight; void Badge;

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface FullProperty {
  airbnbSnapshot?: string | null;
  id: number;
  name: string;
  unitNumber: string;
  building: string | null;
  area: string | null;
  bedroomType: string | null;
  status: string;
  description: string | null;
  photos: string | null;
  amenities: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  guestCapacity: number | null;
  listingUrl: string | null;
  checkInInstructions: string | null;
  wifiDetails: string | null;
  accessDetails: string | null;
  cleaningFee: string | null;
  managementFee: string | null;
  importedOwnerName: string | null;
  importedOwnerEmail: string | null;
  ownerId: number | null;
  ownerName: string | null;
  airbnbIcalUrl: string | null;
  bookingComIcalUrl: string | null;
}

// ─── DrawerField helper ───────────────────────────────────────────────────────

function DrawerField({ label, value, onChange, placeholder, type = "text" }: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider block">
        {label}
      </Label>
      <Input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        className="h-9 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm"
      />
    </div>
  );
}

// ─── PropertyEditDrawer ───────────────────────────────────────────────────────

export function PropertyEditDrawer({ propertyId, onClose, onSaved, onDeleted }: {
  propertyId: number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [property, setProperty] = useState<FullProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; skipped: number; updated?: number; flagged?: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncStatus, setSyncStatus] = useState<{ lastSyncAt?: string } | null>(null);

  const [carouselIdx, setCarouselIdx] = useState(0);
  let sourcePhotos: { localUrl?: string; caption?: string | null; altText?: string | null }[] = [];
  try { sourcePhotos = JSON.parse(property?.airbnbSnapshot || "null")?.photos ?? []; } catch { /* no source snapshot */ }


  const {data:owners}=useGetOwners();
  const [form, setForm] = useState({
    ownerId: "",
    name: "",
    unitNumber: "",
    building: "",
    description: "",
    bedrooms: "",
    checkInInstructions: "",
    wifiDetails: "",
    accessDetails: "",
    cleaningFee: "",
    managementFee: "",
    airbnbIcalUrl: "",
  });

  const [photos, setPhotos] = useState<string[]>([]);
  const sourcePhoto = sourcePhotos.find(photo => photo.localUrl === photos[carouselIdx]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile, isUploading } = useUpload({
    basePath: `${API_BASE}/api/storage`,
    onSuccess: (response) => {
      const servedUrl = `${API_BASE}/api/storage${response.objectPath}`;
      setPhotos(p => [...p, servedUrl]);
    },
    onError: (err) => {
      setPhotoError(`Upload failed: ${err.message}`);
    },
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch(`${API_BASE}/api/properties/${propertyId}`);
        if (!res.ok) throw new Error("Failed to load");
        const data: FullProperty = await res.json();
        setProperty(data);

        apiFetch(`${API_BASE}/api/properties/${propertyId}/sync-status`)
          .then(r => r.json())
          .then(d => setSyncStatus(d))
          .catch(() => {});

        setForm({
          name: data.name ?? "",
          ownerId: data.ownerId == null ? "" : String(data.ownerId),
          unitNumber: data.unitNumber ?? "",
          building: data.building ?? "",
          description: data.description ?? "",
          bedrooms: data.bedrooms != null ? String(data.bedrooms) : "",
          checkInInstructions: data.checkInInstructions ?? "",
          wifiDetails: data.wifiDetails ?? "",
          accessDetails: data.accessDetails ?? "",
          cleaningFee: data.cleaningFee ?? "",
          managementFee: data.managementFee ?? "",
          airbnbIcalUrl: data.airbnbIcalUrl ?? "",
        });
        try {
          const parsed = JSON.parse(data.photos ?? "[]");
          setPhotos(Array.isArray(parsed) ? parsed : []);
        } catch { setPhotos([]); }
        try {
          const parsed = JSON.parse(data.amenities ?? "[]");
          setAmenities(Array.isArray(parsed) ? parsed : []);
        } catch { setAmenities([]); }
      } catch {
        // leave defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [propertyId]);

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function addPhoto() {
    const url = newPhotoUrl.trim();
    if (!url) return;
    if (!url.startsWith("http")) { setPhotoError("Please enter a valid URL starting with http"); return; }
    setPhotoError("");
    setPhotos(p => [...p, url]);
    setNewPhotoUrl("");
  }

  function removePhoto(idx: number) {
    setPhotos(p => p.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      const body: Record<string, unknown> = {
        ownerId: form.ownerId ? Number(form.ownerId) : null,
        name: form.name,
        unitNumber: form.unitNumber,
        building: form.building || null,
        description: form.description || null,
        checkInInstructions: form.checkInInstructions || null,
        wifiDetails: form.wifiDetails || null,
        accessDetails: form.accessDetails || null,
        cleaningFee: form.cleaningFee || null,
        managementFee: form.managementFee || null,
        airbnbIcalUrl: form.airbnbIcalUrl || null,
        photos: JSON.stringify(photos),
      };
      if (form.bedrooms !== "") body.bedrooms = parseInt(form.bedrooms, 10);

      const res = await apiFetch(`${API_BASE}/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `Save failed (${res.status})`);
      }
      setProperty(p => p ? { ...p, airbnbIcalUrl: form.airbnbIcalUrl || null } : p);
      setSaveSuccess(true);
      onSaved();
      setMode("view");
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (!property) return;
    setArchiving(true);
    try {
      const newStatus = property.status === "archived" ? "active" : "archived";
      const res = await apiFetch(`${API_BASE}/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Status update failed");
      setProperty(p => p ? { ...p, status: newStatus } : p);
      onSaved();
    } catch {
      // silently fail — drawer stays open
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/properties/${propertyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      onDeleted();
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  async function handleSyncIcal() {
    setSyncingIcal(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/properties/${propertyId}/sync-ical`, { method: "POST" });
      type ChannelSync = { created?: number; updated?: number; flagged?: number; skipped?: number; error?: string };
      const json = await res.json().catch(() => ({})) as { airbnb?: ChannelSync; booking?: ChannelSync; vrbo?: ChannelSync; error?: string };
      if (!res.ok) throw new Error(json.error || `Sync failed (${res.status})`);
      const channels = [["Airbnb", json.airbnb], ["Booking.com", json.booking], ["Vrbo", json.vrbo]] as const;
      const total = (key: "created" | "updated" | "flagged" | "skipped") => channels.reduce((n, [, c]) => n + (c?.[key] ?? 0), 0);
      // "No ... iCal URL configured" just means the channel is not linked; any other error is a failed sync and must be shown.
      const failures = channels.filter(([, c]) => c?.error && !/^No .* iCal URL configured$/.test(c.error)).map(([name, c]) => `${name}: ${c!.error}`);
      if (failures.length) setSyncError(failures.join(" · "));
      setSyncResult({ created: total("created"), skipped: total("skipped"), updated: total("updated"), flagged: total("flagged") });
      const statusRes = await apiFetch(`${API_BASE}/api/properties/${propertyId}/sync-status`);
      if (statusRes.ok) setSyncStatus(await statusRes.json());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingIcal(false);
    }
  }

  const prevPhoto = () => setCarouselIdx(i => (i - 1 + photos.length) % photos.length);
  const nextPhoto = () => setCarouselIdx(i => (i + 1) % photos.length);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 36 }}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          width: "min(580px, 100vw)",
          background: "linear-gradient(160deg, #06101a 0%, #071524 100%)",
          borderLeft: "1px solid rgba(45,212,191,0.15)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "rgba(45,212,191,0.12)" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={mode === "edit" ? () => setMode("view") : onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-white/60" />
            </button>
            <div>
              <div className="font-bold text-white text-sm flex items-center gap-2">
                {mode === "view" ? "Property Details" : "Edit Property"}
                {property && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={property.status === "active"
                      ? { background: "rgba(16,185,129,0.2)", color: "#34d399" }
                      : { background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                    {property.status}
                  </span>
                )}
              </div>
              {property && <div className="text-[11px] text-teal-400/70 truncate max-w-[260px] mt-0.5">{property.name}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </motion.div>
            )}
            {mode === "view" ? (
              <Button onClick={() => setMode("edit")} disabled={loading}
                className="h-8 px-4 text-sm font-semibold gap-1.5"
                style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={saving || loading}
                className="h-8 px-4 text-sm font-semibold gap-1.5"
                style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-4">
              {Array(6).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
              ))}
            </div>
          ) : mode === "view" ? (
            /* ── VIEW MODE ── */
            <div className="space-y-0">
              {/* Photo Carousel */}
              {photos.length > 0 ? (
                <div className="relative bg-black" style={{ height: "260px" }}>
                  <img key={carouselIdx} src={photos[carouselIdx]} alt={sourcePhoto?.altText || sourcePhoto?.caption || `Photo ${carouselIdx + 1}`}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
                  {photos.length > 1 && (
                    <>
                      <button onClick={prevPhoto}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                        <ChevronLeft className="w-4 h-4 text-white" />
                      </button>
                      <button onClick={nextPhoto}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                        <ChevronRight className="w-4 h-4 text-white" />
                      </button>
                    </>
                  )}
                  <div className="absolute bottom-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-white/90 font-medium"
                    style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                    {carouselIdx + 1} / {photos.length}
                  </div>
                  {photos.length > 1 && photos.length <= 12 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                      {photos.map((_, i) => (
                        <button key={i} onClick={() => setCarouselIdx(i)} className="rounded-full transition-all"
                          style={{ width: i === carouselIdx ? "16px" : "6px", height: "6px", background: i === carouselIdx ? "#2dd4bf" : "rgba(255,255,255,0.35)" }} />
                      ))}
                    </div>
                  )}
                  {property?.listingUrl && (
                    <a href={property.listingUrl} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
                      style={{ background: "rgba(255,90,96,0.85)", backdropFilter: "blur(4px)" }}>
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.4c5.302 0 9.6 4.298 9.6 9.6s-4.298 9.6-9.6 9.6S2.4 17.302 2.4 12 6.698 2.4 12 2.4zm0 3.6c-1.325 0-2.4 1.075-2.4 2.4S10.675 10.8 12 10.8s2.4-1.075 2.4-2.4S13.325 6 12 6zm-4.2 6.6c-.497 0-.9.403-.9.9v.3c0 2.487 2.238 4.5 4.8 4.5s4.8-2.013 4.8-4.5v-.3c0-.497-.403-.9-.9-.9H7.8z"/></svg>
                      Airbnb listing
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center"
                  style={{ height: "180px", background: "linear-gradient(135deg, rgba(13,148,136,0.1), rgba(8,145,178,0.1))" }}>
                  <svg className="w-16 h-16 opacity-20" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#0d9488" }}>
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                  </svg>
                </div>
              )}

              {sourcePhoto?.caption && <p className="px-5 pt-3 whitespace-pre-wrap text-sm text-white/70">{sourcePhoto.caption}</p>}
              <div className="p-5 space-y-6">
                {/* Title + stats */}
                <div className="space-y-3">
                  <div>
                    <h2 className="text-xl font-bold text-white leading-tight">{property?.name}</h2>
                    {(property?.building || property?.unitNumber) && (
                      <div className="flex items-center gap-1.5 text-sm text-teal-400/80 mt-1">
                        <Building2 className="w-3.5 h-3.5" />
                        {[property?.building, property?.unitNumber].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {property?.area && (
                      <div className="flex items-center gap-1.5 text-sm text-white/50 mt-0.5">
                        <MapPin className="w-3.5 h-3.5" />{property.area}
                      </div>
                    )}
                  </div>
                  {(property?.bedrooms || property?.bathrooms || property?.guestCapacity || property?.bedroomType) && (
                    <div className="flex flex-wrap gap-2">
                      {property?.bedrooms != null && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white/80"
                          style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.15)" }}>
                          <BedDouble className="w-3.5 h-3.5 text-teal-400" />
                          {property.bedrooms} {property.bedrooms === 1 ? "bedroom" : "bedrooms"}
                        </div>
                      )}
                      {property?.bathrooms != null && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white/80"
                          style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.15)" }}>
                          <Bath className="w-3.5 h-3.5 text-teal-400" />
                          {property.bathrooms} {property.bathrooms === 1 ? "bath" : "baths"}
                        </div>
                      )}
                      {property?.guestCapacity != null && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white/80"
                          style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.15)" }}>
                          <Users className="w-3.5 h-3.5 text-teal-400" />Up to {property.guestCapacity} guests
                        </div>
                      )}
                      {property?.bedroomType && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white/80"
                          style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.15)" }}>
                          <Layers className="w-3.5 h-3.5 text-teal-400" />{property.bedroomType}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <AirbnbSourceDetails snapshot={property?.airbnbSnapshot} />

                {property?.description && !property?.airbnbSnapshot && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-2">
                      <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Description</div>
                      <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{property.description}</p>
                    </section>
                  </>
                )}

                {amenities.length > 0 && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Amenities</span>
                        <span className="text-[11px] text-white/30">{amenities.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {amenities.map((a, i) => (
                          <span key={i} className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-white/70"
                            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                            {a}
                          </span>
                        ))}
                      </div>
                    </section>
                  </>
                )}

                {(property?.checkInInstructions || property?.wifiDetails || property?.accessDetails) && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Access &amp; Guest Info</span>
                      </div>
                      {property?.checkInInstructions && (
                        <div className="rounded-xl p-3 space-y-1.5"
                          style={{ background: "rgba(45,212,191,0.05)", border: "1px solid rgba(45,212,191,0.1)" }}>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-teal-400/70 uppercase tracking-widest">
                            <ClipboardList className="w-3 h-3" /> Check-in Instructions
                          </div>
                          <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{property.checkInInstructions}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        {property?.wifiDetails && (
                          <div className="rounded-xl p-3 space-y-1"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                              <Wifi className="w-3 h-3" /> WiFi
                            </div>
                            <p className="text-sm text-white/80">{property.wifiDetails}</p>
                          </div>
                        )}
                        {property?.accessDetails && (
                          <div className="rounded-xl p-3 space-y-1"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                              <Key className="w-3 h-3" /> Access
                            </div>
                            <p className="text-sm text-white/80">{property.accessDetails}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {(property?.cleaningFee || property?.managementFee) && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Fees</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {property?.cleaningFee && (
                          <div className="rounded-xl p-3 space-y-1"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Cleaning Fee</div>
                            <div className="text-base font-bold text-white">AED {property.cleaningFee}</div>
                          </div>
                        )}
                        {property?.managementFee && (
                          <div className="rounded-xl p-3 space-y-1"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Management Fee</div>
                            <div className="text-base font-bold text-white">{property.managementFee}%</div>
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {(property?.ownerName || property?.importedOwnerName || property?.importedOwnerEmail) && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Owner</span>
                      </div>
                      <div className="rounded-xl p-3 space-y-1.5"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        {(property?.ownerName || property?.importedOwnerName) && (
                          <div className="text-sm font-semibold text-white">{property?.ownerName ?? property?.importedOwnerName}</div>
                        )}
                        {property?.importedOwnerEmail && (
                          <div className="flex items-center gap-1.5 text-sm text-white/60">
                            <Mail className="w-3.5 h-3.5" />{property.importedOwnerEmail}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {(property?.airbnbIcalUrl || property?.bookingComIcalUrl) && (
                  <>
                    <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />
                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Calendar Sync</span>
                      </div>
                      <div className="rounded-xl p-3 space-y-3"
                        style={{ background: "rgba(45,212,191,0.05)", border: "1px solid rgba(45,212,191,0.15)" }}>
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs text-white/55 leading-relaxed">Pull latest reservations from Airbnb, Booking.com and Vrbo calendars.</p>
                          {syncStatus?.lastSyncAt && (
                            <div className="text-[10px] text-teal-400/60 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Last synced: {new Date(syncStatus.lastSyncAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                        {syncResult && (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                            {syncResult.created === 0 && !syncResult.updated && !syncResult.flagged
                              ? (syncError ? "No changes from the channels that synced" : "Already up to date — no new bookings found")
                              : [syncResult.created ? `${syncResult.created} imported` : "", syncResult.updated ? `${syncResult.updated} updated` : "", syncResult.flagged ? `${syncResult.flagged} need checking (see notifications)` : "", syncResult.skipped > 0 ? `${syncResult.skipped} unchanged` : ""].filter(Boolean).join(", ")}
                          </div>
                        )}
                        {syncError && (
                          <div className="flex items-start gap-1.5 text-xs text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{syncError}
                          </div>
                        )}
                        <Button onClick={handleSyncIcal} disabled={syncingIcal}
                          className="w-full h-9 font-semibold gap-2 text-sm"
                          style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}>
                          {syncingIcal
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
                            : <><RefreshCw className="w-3.5 h-3.5" /> Sync Now</>}
                        </Button>
                      </div>
                    </section>
                  </>
                )}

                <div className="border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                  <Button onClick={() => setMode("edit")}
                    className="w-full h-11 font-bold text-base gap-2"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none", boxShadow: "0 4px 20px rgba(13,148,136,0.3)" }}>
                    <Pencil className="w-4 h-4" /> Edit Property Details
                  </Button>
                </div>
                <div className="pb-4" />
              </div>
            </div>
          ) : (
            /* ── EDIT MODE ── */
            <div className="p-5 space-y-6">
              {/* Photos */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <ImagePlus className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Photos</span>
                  <span className="text-[11px] text-white/30">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>
                </div>
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {photos.map((url, idx) => (
                      <div key={idx} className="relative group rounded-xl overflow-hidden aspect-[4/3]">
                        <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover"
                          onError={e => {
                            (e.target as HTMLImageElement).src = "";
                            (e.target as HTMLImageElement).parentElement!.style.background = "rgba(255,255,255,0.05)";
                          }} />
                        {idx === 0 && (
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white"
                            style={{ background: "rgba(13,148,136,0.85)" }}>COVER</div>
                        )}
                        <button onClick={() => removePhoto(idx)}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: "rgba(220,38,38,0.85)" }}>
                          <Trash2 className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mb-3">
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length === 0) return;
                      setPhotoError("");
                      for (const file of files) await uploadFile(file);
                      e.target.value = "";
                    }} />
                  <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                    variant="outline" size="sm"
                    className="w-full h-10 border-dashed border-teal-400/30 text-teal-400 hover:bg-teal-400/10 gap-2">
                    {isUploading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                      : <><ImagePlus className="w-3.5 h-3.5" /> Upload from device</>}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Or paste a URL</p>
                  <div className="flex gap-2">
                    <Input value={newPhotoUrl}
                      onChange={e => { setNewPhotoUrl(e.target.value); setPhotoError(""); }}
                      onKeyDown={e => e.key === "Enter" && addPhoto()}
                      placeholder="https://…"
                      className="flex-1 h-9 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm" />
                    <Button onClick={addPhoto} variant="outline" size="sm"
                      className="h-9 px-3 border-teal-400/30 text-teal-400 hover:bg-teal-400/10">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {photoError && <p className="text-[11px] text-red-400">{photoError}</p>}
                  <p className="text-[11px] text-white/25">The first photo is used as the cover image.</p>
                </div>
              </section>

              <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />

              {/* Core details */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Property Details</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <DrawerField label="Property Name" value={form.name} onChange={upd("name")} placeholder="e.g. Marina Luxury 2BR" />
                  </div>
                  <label className="text-xs text-white/70">Owner<select className="w-full p-2 rounded bg-slate-800 text-white border" value={form.ownerId} onChange={e=>setForm(f=>({...f,ownerId:e.target.value}))}><option value="">Choose owner</option>{owners?.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                  <DrawerField label="Unit Number" value={form.unitNumber} onChange={upd("unitNumber")} placeholder="e.g. 1204" />
                  <DrawerField label="Building" value={form.building} onChange={upd("building")} placeholder="e.g. Marina Gate Tower 1" />
                  <DrawerField label="Bedrooms" value={form.bedrooms} onChange={upd("bedrooms")} placeholder="e.g. 2" type="number" />
                </div>
                <div>
                  <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider block mb-1.5">Description</Label>
                  <Textarea value={form.description} onChange={upd("description")}
                    placeholder="Property description shown to guests…" rows={3}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm resize-none" />
                </div>
              </section>

              <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />

              {/* Access & guest info */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Access &amp; Guest Info</span>
                </div>
                <div>
                  <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider block mb-1.5">Check-in Instructions</Label>
                  <Textarea value={form.checkInInstructions} onChange={upd("checkInInstructions")}
                    placeholder="e.g. Key lockbox code: 1234. Located at main entrance…" rows={3}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DrawerField label="WiFi Details" value={form.wifiDetails} onChange={upd("wifiDetails")} placeholder="Network: YallaHome | Password: …" />
                  <DrawerField label="Access Details" value={form.accessDetails} onChange={upd("accessDetails")} placeholder="e.g. Gate code: 5678" />
                </div>
              </section>

              <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />

              {/* Fees */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Fees</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DrawerField label="Cleaning Fee (AED)" value={form.cleaningFee} onChange={upd("cleaningFee")} placeholder="e.g. 350" />
                  <DrawerField label="Management Fee %" value={form.managementFee} onChange={upd("managementFee")} placeholder="e.g. 20" />
                </div>
              </section>

              <div className="border-t" style={{ borderColor: "rgba(45,212,191,0.1)" }} />

              {/* Calendar Sync */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Calendar Sync</span>
                </div>
                <div>
                  <Label className="text-white/60 text-[11px] font-semibold uppercase tracking-wider block mb-1.5">Airbnb iCal URL</Label>
                  <Input value={form.airbnbIcalUrl} onChange={upd("airbnbIcalUrl")}
                    placeholder="https://www.airbnb.com/calendar/ical/…"
                    className="h-9 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-teal-400/50 text-sm" />
                  <p className="text-[11px] text-white/30 mt-1.5 leading-snug">
                    Paste the iCal export link from your Airbnb listing to enable calendar sync.
                  </p>
                </div>
              </section>

              {saveError && (
                <div className="rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2"
                  style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{saveError}
                </div>
              )}

              <Button onClick={handleSave} disabled={saving || loading}
                className="w-full h-11 font-bold text-base gap-2"
                style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none", boxShadow: "0 4px 20px rgba(13,148,136,0.3)" }}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Save className="w-4 h-4" />Save Changes</>}
              </Button>

              {/* Danger zone */}
              {property && (
                <>
                  <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }} />
                  <section className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70" />
                      <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Property Status</span>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleArchiveToggle} disabled={archiving || loading} variant="outline"
                        className="flex-1 h-9 text-sm gap-2 font-semibold"
                        style={property.status === "archived"
                          ? { border: "1px solid rgba(16,185,129,0.4)", color: "#34d399", background: "rgba(16,185,129,0.08)" }
                          : { border: "1px solid rgba(245,158,11,0.4)", color: "#fbbf24", background: "rgba(245,158,11,0.08)" }}>
                        {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {property.status === "archived" ? "Restore to Active" : "Archive Property"}
                      </Button>
                      <Button onClick={() => { setShowDeleteConfirm(true); setDeleteError(""); }}
                        disabled={deleting || loading} variant="outline"
                        className="h-9 px-4 text-sm gap-2 font-semibold"
                        style={{ border: "1px solid rgba(220,38,38,0.4)", color: "#f87171", background: "rgba(220,38,38,0.08)" }}>
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    </div>
                    {property.status === "archived" && (
                      <p className="text-[11px] text-amber-400/60 leading-snug">This property is archived and hidden from your active list.</p>
                    )}
                  </section>
                </>
              )}
              <div className="pb-4" />
            </div>
          )}
        </div>
      </motion.div>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60]" style={{ background: "rgba(0,0,0,0.7)" }}
              onClick={() => !deleting && setShowDeleteConfirm(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.18 }}
              className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 space-y-4 w-[min(360px,90vw)]"
              style={{
                background: "linear-gradient(160deg, #0a1929 0%, #071524 100%)",
                border: "1px solid rgba(220,38,38,0.3)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
              }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)" }}>
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <div className="font-bold text-white text-sm">Delete Property?</div>
                  <div className="text-[12px] text-white/50 mt-1 leading-snug">
                    This will permanently remove <span className="text-white/80 font-semibold">{property?.name}</span> and all its data. This action cannot be undone.
                  </div>
                </div>
              </div>
              {deleteError && (
                <div className="rounded-lg px-3 py-2 text-xs text-red-400 flex items-center gap-2"
                  style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)" }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{deleteError}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} variant="outline"
                  className="flex-1 h-9 text-sm font-semibold"
                  style={{ border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>Cancel</Button>
                <Button onClick={handleDelete} disabled={deleting}
                  className="flex-1 h-9 text-sm font-bold gap-1.5"
                  style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)", border: "none" }}>
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  {deleting ? "Deleting…" : "Yes, Delete"}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
