import { apiFetch } from "@/lib/api-fetch";
import { BRAND } from "../../../../lib/brand.mjs";
import { useState, useRef, useEffect } from "react";
import {
  Bot, Send, Sparkles, Loader2, Copy, Check, Trash2,
  FileText, Wrench, CreditCard, Building2, MessageCircle,
  Star, TrendingUp, ChevronDown, ChevronUp, BarChart3, Clock,
  Zap, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage { role: "user" | "assistant"; content: string; ts: number; }

// ─── Markdown renderer ────────────────────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <p key={i} className="font-bold text-base mt-2">{line.slice(4)}</p>;
        if (line.startsWith("## ")) return <p key={i} className="font-bold text-base mt-2">{line.slice(3)}</p>;
        if (line.startsWith("# ")) return <p key={i} className="font-bold text-lg mt-2">{line.slice(2)}</p>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-bold">{line.slice(2, -2)}</p>;
        if (line.startsWith("• ") || line.startsWith("- ")) return <p key={i} className="pl-3 flex gap-2"><span className="text-purple-500 mt-0.5">•</span><span>{line.slice(2)}</span></p>;
        if (line.match(/^\d+\. /)) return <p key={i} className="pl-3">{line}</p>;
        if (line === "") return <div key={i} className="h-2" />;
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return <p key={i}>{parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}</p>;
      })}
    </div>
  );
}

// ─── Result box ───────────────────────────────────────────────────────────────
function ResultBox({ result, isJson }: { result: string; isJson?: boolean }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function copy() {
    const text = isJson ? result : result;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-4 rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Result</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={copy}>
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </Button>
      </div>
      <div className="p-4">
        {isJson ? result : <MarkdownText text={result} />}
      </div>
    </div>
  );
}

// ─── Maintenance JSON result ──────────────────────────────────────────────────
function MaintenanceResult({ data }: { data: Record<string, unknown> }) {
  const PRIORITY_COLORS: Record<string, string> = {
    Emergency: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    High: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    Medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    Low: "bg-slate-100 text-slate-600",
  };
  const priority = String(data.priority ?? "");
  return (
    <div className="mt-4 rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Categorization</span>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Category</p>
          <p className="font-semibold text-sm">{String(data.category ?? "—")}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Priority</p>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${PRIORITY_COLORS[priority] ?? "bg-muted"}`}>{priority}</span>
        </div>
        <div className="space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Vendor Needed</p>
          <p className="text-sm">{String(data.vendorType ?? "—")}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Est. Resolution</p>
          <p className="text-sm">{String(data.estimatedResolutionTime ?? "—")}</p>
        </div>
        <div className="sm:col-span-2 space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Guest Impact</p>
          <p className="text-sm">{String(data.guestImpact ?? "—")}</p>
        </div>
        <div className="sm:col-span-2 space-y-0.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Immediate Action</p>
          <p className="text-sm font-medium text-foreground">{String(data.immediateAction ?? "—")}</p>
        </div>
        {Boolean(data.ownerNotification) && (
          <div className="sm:col-span-2">
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">
              <AlertTriangle className="h-3 w-3 mr-1" /> Notify Owner
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1: Listing Description
// ─────────────────────────────────────────────────────────────────────────────
const AMENITY_OPTIONS = [
  "Swimming Pool", "Private Pool", "Gym/Fitness Center", "Balcony/Terrace", "Sea View", "Burj Khalifa View",
  "Parking", "Concierge", "24/7 Security", "High-Speed WiFi", "Smart TV", "Fully Equipped Kitchen",
  "Washing Machine", "Dryer", "Air Conditioning", "BBQ Area", "Beach Access", "Kids Play Area",
  "Business Center", "Sauna", "Spa", "Tennis Court",
];

function ListingDescriptionTool() {
  const [form, setForm] = useState({ propertyName: "", bedrooms: "1", bathrooms: "1", area: "", highlights: "" });
  const [amenities, setAmenities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const { toast } = useToast();

  function toggleAmenity(a: string) {
    setAmenities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  async function generate() {
    if (!form.propertyName || !form.area) {
      toast({ title: "Please fill in property name and area", variant: "destructive" });
      return;
    }
    setLoading(true); setResult("");
    try {
      const res = await apiFetch(`${API}/api/ai/tools/listing-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms), amenities }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold">Property Name</Label>
          <Input placeholder="Marina Sunset 2BR" value={form.propertyName} onChange={e => setForm(f => ({ ...f, propertyName: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Area / Neighbourhood</Label>
          <Input placeholder="Dubai Marina" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Bedrooms</Label>
          <Select value={form.bedrooms} onValueChange={v => setForm(f => ({ ...f, bedrooms: v }))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{[0,1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n === 0 ? "Studio" : `${n} BR`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Bathrooms</Label>
          <Select value={form.bathrooms} onValueChange={v => setForm(f => ({ ...f, bathrooms: v }))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{[1,2,3,4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Special Highlights (optional)</Label>
          <Input placeholder="Burj Khalifa view, direct beach access…" value={form.highlights} onChange={e => setForm(f => ({ ...f, highlights: e.target.value }))} className="h-9" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold">Amenities</Label>
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map(a => (
            <button key={a} onClick={() => toggleAmenity(a)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${amenities.includes(a) ? "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300" : "bg-muted text-muted-foreground border-transparent hover:border-border"}`}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={generate} disabled={loading} className="gap-2 bg-purple-600 hover:bg-purple-700">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate Description</>}
      </Button>

      {result && <ResultBox result={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2: Pricing Suggestion
// ─────────────────────────────────────────────────────────────────────────────
function PricingSuggestionTool() {
  const [form, setForm] = useState({ propertyName: "", baseRate: "", occupancyRate: "", area: "", bedrooms: "1", season: "shoulder", nearbyEvents: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const { toast } = useToast();

  async function generate() {
    if (!form.propertyName || !form.baseRate) {
      toast({ title: "Please fill in property name and base rate", variant: "destructive" });
      return;
    }
    setLoading(true); setResult("");
    try {
      const res = await apiFetch(`${API}/api/ai/tools/pricing-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, baseRate: Number(form.baseRate), occupancyRate: Number(form.occupancyRate) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Property Name</Label>
          <Input placeholder="Marina Sunset 2BR" value={form.propertyName} onChange={e => setForm(f => ({ ...f, propertyName: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Area</Label>
          <Input placeholder="Dubai Marina" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Current Base Rate (AED/night)</Label>
          <Input type="number" placeholder="750" value={form.baseRate} onChange={e => setForm(f => ({ ...f, baseRate: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Occupancy Last 30 Days (%)</Label>
          <Input type="number" placeholder="65" min="0" max="100" value={form.occupancyRate} onChange={e => setForm(f => ({ ...f, occupancyRate: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Bedrooms</Label>
          <Select value={form.bedrooms} onValueChange={v => setForm(f => ({ ...f, bedrooms: v }))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{[0,1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n === 0 ? "Studio" : `${n} BR`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Season</Label>
          <Select value={form.season} onValueChange={v => setForm(f => ({ ...f, season: v }))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="peak">Peak (Oct–Apr)</SelectItem>
              <SelectItem value="shoulder">Shoulder (May, Sep)</SelectItem>
              <SelectItem value="low">Low (Jun–Aug)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold">Nearby Events / Demand Drivers (optional)</Label>
          <Input placeholder="F1 Abu Dhabi weekend, Dubai Expo, Art Dubai…" value={form.nearbyEvents} onChange={e => setForm(f => ({ ...f, nearbyEvents: e.target.value }))} className="h-9" />
        </div>
      </div>

      <Button onClick={generate} disabled={loading} className="gap-2 bg-purple-600 hover:bg-purple-700">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</> : <><TrendingUp className="h-4 w-4" /> Get Pricing Recommendation</>}
      </Button>

      {result && <ResultBox result={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3: WhatsApp Draft
// ─────────────────────────────────────────────────────────────────────────────
const MESSAGE_TYPES = [
  { value: "booking_confirmation", label: "Booking Confirmation" },
  { value: "check_in_instructions", label: "Check-In Instructions" },
  { value: "checkout_reminder", label: "Checkout Reminder" },
  { value: "payment_reminder", label: "Payment Reminder" },
  { value: "review_request", label: "Review Request" },
  { value: "mid_stay_check", label: "Mid-Stay Check-In" },
  { value: "late_checkout_offer", label: "Late Checkout Offer" },
];

function WhatsAppDraftTool() {
  const [form, setForm] = useState({ messageType: "booking_confirmation", guestName: "", propertyName: "", checkIn: "", checkOut: "", extraInfo: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const { toast } = useToast();

  async function generate() {
    if (!form.guestName || !form.propertyName) {
      toast({ title: "Please fill in guest name and property name", variant: "destructive" });
      return;
    }
    setLoading(true); setResult("");
    try {
      const res = await apiFetch(`${API}/api/ai/tools/whatsapp-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold">Message Type</Label>
          <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v }))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MESSAGE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Guest Name</Label>
          <Input placeholder="Ahmed" value={form.guestName} onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Property Name</Label>
          <Input placeholder="Marina Sunset 2BR" value={form.propertyName} onChange={e => setForm(f => ({ ...f, propertyName: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Check-In Date (optional)</Label>
          <Input type="date" value={form.checkIn} onChange={e => setForm(f => ({ ...f, checkIn: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Check-Out Date (optional)</Label>
          <Input type="date" value={form.checkOut} onChange={e => setForm(f => ({ ...f, checkOut: e.target.value }))} className="h-9" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold">Extra Info (optional)</Label>
          <Input placeholder="Guest has 2 kids, late arrival at 11pm, access code 4521…" value={form.extraInfo} onChange={e => setForm(f => ({ ...f, extraInfo: e.target.value }))} className="h-9" />
        </div>
      </div>

      <Button onClick={generate} disabled={loading} className="gap-2 bg-purple-600 hover:bg-purple-700">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing…</> : <><MessageCircle className="h-4 w-4" /> Draft WhatsApp Message</>}
      </Button>

      {result && (
        <div className="mt-4 rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp Message</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => { navigator.clipboard.writeText(result); toast({ title: "Copied — ready to paste into WhatsApp" }); }}>
              <Copy className="h-3 w-3" /> Copy
            </Button>
          </div>
          <div className="p-4">
            <div className="bg-[#dcf8c6] dark:bg-green-950/40 rounded-2xl rounded-tl-sm px-4 py-3 max-w-sm">
              <p className="text-sm whitespace-pre-line text-foreground">{result}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 4: Review Analysis
// ─────────────────────────────────────────────────────────────────────────────
function ReviewAnalysisTool() {
  const [reviews, setReviews] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const { toast } = useToast();

  async function analyse() {
    if (!reviews.trim()) {
      toast({ title: "Please paste guest reviews to analyse", variant: "destructive" });
      return;
    }
    setLoading(true); setResult("");
    try {
      const res = await apiFetch(`${API}/api/ai/tools/review-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Guest Reviews</Label>
        <p className="text-xs text-muted-foreground">Paste multiple reviews separated by blank lines or "---". The more reviews you add, the better the analysis.</p>
        <Textarea
          placeholder={`Review 1:\n"Amazing apartment with stunning views! The check-in was seamless and the team was very responsive. The AC was a bit noisy but overall a wonderful stay."\n\n---\n\nReview 2:\n"Great location in Marina. Bed was comfortable. Kitchen needed more utensils. Host replied quickly to all our messages."`}
          value={reviews}
          onChange={e => setReviews(e.target.value)}
          rows={8}
          className="text-sm"
        />
      </div>

      <Button onClick={analyse} disabled={loading || !reviews.trim()} className="gap-2 bg-purple-600 hover:bg-purple-700">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing reviews…</> : <><Star className="h-4 w-4" /> Analyse Reviews</>}
      </Button>

      {result && <ResultBox result={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 5: Maintenance Categorization
// ─────────────────────────────────────────────────────────────────────────────
function MaintenanceCatTool() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const { toast } = useToast();

  async function categorise() {
    if (!description.trim()) {
      toast({ title: "Please describe the maintenance issue", variant: "destructive" });
      return;
    }
    setLoading(true); setResult(null);
    try {
      const res = await apiFetch(`${API}/api/ai/tools/categorize-maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Describe the Issue</Label>
        <p className="text-xs text-muted-foreground">Describe the maintenance problem in plain language. The AI will categorize it, set priority, and suggest the right vendor.</p>
        <Textarea
          placeholder="The AC in the master bedroom is making a loud rattling noise and not cooling properly. Guest complained it woke them up at night."
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          className="text-sm"
        />
      </div>

      <Button onClick={categorise} disabled={loading || !description.trim()} className="gap-2 bg-purple-600 hover:bg-purple-700">
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Categorising…</> : <><Zap className="h-4 w-4" /> Categorise & Triage</>}
      </Button>

      {result && <MaintenanceResult data={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool config
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    id: "listing",
    icon: Building2,
    label: "Listing Description",
    desc: "Generate a compelling Airbnb listing title and description",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    component: ListingDescriptionTool,
  },
  {
    id: "pricing",
    icon: TrendingUp,
    label: "Dynamic Pricing",
    desc: "Get AI-powered rate recommendations based on occupancy & season",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    component: PricingSuggestionTool,
  },
  {
    id: "whatsapp",
    icon: MessageCircle,
    label: "WhatsApp Draft",
    desc: "Draft professional guest messages for any scenario",
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
    component: WhatsAppDraftTool,
  },
  {
    id: "reviews",
    icon: Star,
    label: "Review Analysis",
    desc: "Analyse guest reviews to surface recurring issues & opportunities",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    component: ReviewAnalysisTool,
  },
  {
    id: "maintenance",
    icon: Wrench,
    label: "Maintenance Triage",
    desc: "Auto-categorize & prioritize any maintenance issue instantly",
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    component: MaintenanceCatTool,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Chat tab
// ─────────────────────────────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  { label: "Guest confirmation", prompt: "Write a warm booking confirmation message for a guest checking into a Dubai marina apartment." },
  { label: "Check-in instructions", prompt: "Write professional check-in instructions for a holiday home in Dubai Marina, including WiFi and access code." },
  { label: "Owner monthly update", prompt: "Write a professional monthly owner update summarizing this month's bookings, revenue, and any maintenance work done." },
  { label: "Explain payout", prompt: "Explain the owner payout: Gross AED 8,500 booking, 20% management fee, AED 300 cleaning cost, AED 200 maintenance deduction." },
  { label: "Suggest next action", prompt: "Based on current operations, what should I prioritize today to run my holiday home business efficiently?" },
  { label: "Review request", prompt: "Write a friendly review request message to send to a guest 1 day after checkout." },
];

function ChatTab() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm your Co-Host Pro AI assistant 👋\n\nI can help you draft messages, explain payouts, create owner updates, summarize issues, and much more.\n\nTry a quick prompt below or type your own question.", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: text.trim(), ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    const assistantMsg: ChatMessage = { role: "assistant", content: "", ts: Date.now() + 1 };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await apiFetch(`${API}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) break;
            if (data.content) {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, content: `Error: ${err.message}` }];
      });
    } finally {
      setStreaming(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  function copyMsg(idx: number, content: string) {
    navigator.clipboard.writeText(content);
    setCopied(idx);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}>
      <div className="flex-shrink-0 overflow-x-auto mb-3">
        <div className="flex gap-2 pb-1 min-w-max">
          {QUICK_PROMPTS.map((p, i) => (
            <button key={i} onClick={() => sendMessage(p.prompt)} disabled={streaming}
              className="flex items-center gap-1.5 text-xs bg-card border rounded-full px-3 py-1.5 hover:bg-muted transition-colors whitespace-nowrap disabled:opacity-50">
              <Bot className="h-3 w-3 text-purple-600" /> {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-3">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${msg.role === "assistant" ? "bg-purple-600" : "bg-teal-600"}`}>
              {msg.role === "assistant" ? <Bot className="h-4 w-4" /> : "You"}
            </div>
            <div className={`max-w-[80%] group ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
              <div className={`rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border rounded-tl-sm"}`}>
                {msg.role === "assistant" && msg.content === "" && streaming ? (
                  <div className="flex items-center gap-1.5">
                    {[0, 150, 300].map(d => <span key={d} className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                  </div>
                ) : msg.role === "assistant" ? (
                  <MarkdownText text={msg.content} />
                ) : (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                )}
              </div>
              {msg.role === "assistant" && msg.content && (
                <button onClick={() => copyMsg(idx, msg.content)} className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1">
                  {copied === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied === idx ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 bg-card border rounded-2xl p-3 flex items-end gap-2 shadow-sm">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Ask me anything — draft a message, explain a payout, create an owner update…"
          rows={2}
          className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 p-0 text-sm"
        />
        <Button size="icon" className="h-9 w-9 rounded-xl flex-shrink-0" onClick={() => sendMessage(input)} disabled={!input.trim() || streaming}>
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted-foreground mt-2">Press Enter to send · Shift+Enter for new line</p>

      <div className="flex justify-end mt-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1.5" onClick={() => setMessages([{ role: "assistant", content: "Hi! I'm your Co-Host Pro AI assistant 👋\n\nI can help you draft messages, explain payouts, create owner updates, summarize issues, and much more.\n\nTry a quick prompt below or type your own question.", ts: Date.now() }])}>
          <Trash2 className="h-3.5 w-3.5" /> Clear chat
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage tab
// ─────────────────────────────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  chat: "Chat",
  listing_description: "Listing Description",
  pricing_suggestion: "Pricing Suggestion",
  whatsapp_draft: "WhatsApp Draft",
  review_analysis: "Review Analysis",
  categorize_maintenance: "Maintenance Triage",
  guest_message: "Guest Message",
  owner_update: "Owner Update",
  maintenance_summary: "Maintenance Summary",
  payout_explanation: "Payout Explanation",
  next_action: "Next Action",
};

function UsageTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const res = await apiFetch(`${API}/api/ai/usage`);
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const byTool: Record<string, number> = data?.byTool ?? {};
  const recent: any[] = data?.recent ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Requests", val: data?.total ?? 0, icon: BarChart3, color: "text-purple-600" },
          { label: "Input Tokens", val: (data?.totalInputTokens ?? 0).toLocaleString(), icon: FileText, color: "text-blue-600" },
          { label: "Output Tokens", val: (data?.totalOutputTokens ?? 0).toLocaleString(), icon: Sparkles, color: "text-emerald-600" },
          { label: "Est. Cost", val: `$${(((data?.totalInputTokens ?? 0) * 0.00000015) + ((data?.totalOutputTokens ?? 0) * 0.0000006)).toFixed(4)}`, icon: CreditCard, color: "text-amber-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <s.icon className={`h-4 w-4 ${s.color} mb-1.5`} />
            <div className="text-xl font-bold">{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {Object.keys(byTool).length > 0 && (
        <div className="bg-card border rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold">Usage by Tool</p>
          {Object.entries(byTool).sort((a, b) => b[1] - a[1]).map(([tool, count]) => {
            const max = Math.max(...Object.values(byTool));
            return (
              <div key={tool} className="flex items-center gap-3">
                <div className="w-36 text-xs text-muted-foreground truncate">{TOOL_LABELS[tool] ?? tool}</div>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                </div>
                <div className="text-xs font-mono w-6 text-right">{count}</div>
              </div>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-semibold">Recent Requests</p>
          </div>
          <div className="divide-y">
            {recent.map((r: any) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{TOOL_LABELS[r.tool] ?? r.tool}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  {r.prompt && <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.prompt}</p>}
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {r.inputTokens ? `${r.inputTokens + (r.outputTokens ?? 0)} tok` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
          <p className="font-medium text-sm">No AI requests yet</p>
          <p className="text-xs mt-1">Use the Tools or Chat tabs to make your first AI request.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function AIAssistant() {
  const [activeTab, setActiveTab] = useState<"tools" | "chat" | "usage">("tools");
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const tool = TOOLS.find(t => t.id === activeTool);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-purple-600" /> AI Assistant
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Powered by GPT-4o-mini · Context-aware property management AI</p>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-purple-500 inline-block animate-pulse" />
          {BRAND} AI · Active
        </Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        {([
          { id: "tools", label: "AI Tools", icon: Sparkles },
          { id: "chat", label: "Chat", icon: Bot },
          { id: "usage", label: "Usage", icon: BarChart3 },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tools tab */}
      {activeTab === "tools" && (
        <div className="space-y-4">
          {/* Tool cards */}
          {!activeTool && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TOOLS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTool(t.id)}
                  className={`${t.bg} ${t.border} border rounded-xl p-5 text-left hover:opacity-90 hover:shadow-md transition-all group`}
                >
                  <div className={`w-10 h-10 rounded-xl ${t.bg} border ${t.border} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                    <t.icon className={`h-5 w-5 ${t.color}`} />
                  </div>
                  <p className="font-semibold text-sm">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.desc}</p>
                  <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${t.color}`}>
                    Open tool <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Active tool panel */}
          {activeTool && tool && (
            <div className="bg-card border rounded-2xl overflow-hidden">
              <div className={`${tool.bg} ${tool.border} border-b px-5 py-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl bg-white/50 dark:bg-black/20 flex items-center justify-center`}>
                    <tool.icon className={`h-5 w-5 ${tool.color}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{tool.label}</p>
                    <p className="text-xs text-muted-foreground">{tool.desc}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setActiveTool(null)}>
                  <ChevronUp className="h-3.5 w-3.5" /> All Tools
                </Button>
              </div>
              <div className="p-5">
                <tool.component />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chat tab */}
      {activeTab === "chat" && <ChatTab />}

      {/* Usage tab */}
      {activeTab === "usage" && <UsageTab />}
    </div>
  );
}
