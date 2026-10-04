import { apiFetch } from "@/lib/api-fetch";
import { BRAND } from "../../../../lib/brand.mjs";
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2, Palette, Bell, CreditCard, Zap, MessageSquare, Users, Bot,
  Home, Sparkles, Wrench, DollarSign, Plug, FileText, Crown,
  Save, CheckCircle2, ChevronRight, Loader2, Plus, Trash2, Pencil,
  ToggleLeft, ToggleRight, ExternalLink, RefreshCw, X, Globe, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme, ACCENT_VARS } from "@/contexts/theme-context";
import { useAuth, ROLE_LABELS, ROLE_COLORS } from "@/contexts/auth-context";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const SECTIONS = [
  { id: "company",     icon: Building2,    label: "Company",         group: "General" },
  { id: "theme",       icon: Palette,      label: "Appearance",      group: "General" },
  { id: "notifications",icon: Bell,        label: "Notifications",   group: "General" },
  { id: "property",    icon: Home,         label: "Property Defaults",group: "Operations" },
  { id: "cleaning",    icon: Sparkles,     label: "Cleaning",        group: "Operations" },
  { id: "maintenance", icon: Wrench,       label: "Maintenance",     group: "Operations" },
  { id: "financial",   icon: DollarSign,   label: "Financial",       group: "Operations" },
  { id: "payouts",     icon: CreditCard,   label: "Payout Methods",  group: "People" },
  { id: "users",       icon: Users,        label: "Users & Roles",   group: "People" },
  { id: "ai",          icon: Bot,          label: "AI Assistant",    group: "Automation" },
  { id: "automations", icon: Zap,          label: "Automations",     group: "Automation" },
  { id: "templates",   icon: MessageSquare,label: "Templates",       group: "Automation" },
  { id: "integrations",icon: Plug,         label: "Integrations",    group: "Integrations" },
  { id: "documents",   icon: FileText,     label: "Documents",       group: "Integrations" },
  { id: "plans",       icon: Crown,        label: "PMS Plans",       group: "Integrations" },
];

async function fetchSettings() {
  const r = await apiFetch(`${API}/api/settings`); return r.json();
}
async function saveSection(key: string, value: unknown) {
  const r = await apiFetch(`${API}/api/settings/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
  return r.json();
}
async function fetchUsers() { const r = await apiFetch(`${API}/api/users`); return r.json(); }

function SectionCard({ title, desc, children, onSave, saving }: { title: string; desc?: string; children: React.ReactNode; onSave?: () => void; saving?: boolean }) {
  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <div className="p-6 border-b bg-muted/30">
        <h3 className="font-bold text-base">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className="p-6 space-y-5">{children}</div>
      {onSave && (
        <div className="px-6 pb-6">
          <Button onClick={onSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[220px_1fr] gap-2 sm:gap-4 items-start">
      <div className="pt-2.5"><Label className="text-sm font-medium leading-tight">{label}</Label>{hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}</div>
      <div>{children}</div>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onCheckedChange }: { label: string; desc?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b last:border-0">
      <div><p className="text-sm font-medium">{label}</p>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="flex-shrink-0" />
    </div>
  );
}

// ─── Company ──────────────────────────────────────────────────────────────────
function CompanySection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const [form, setForm] = useState({ name: "", documentName: BRAND, phone: "+971 50 000 0000", email: "", address: "Dubai Marina, Dubai, UAE", website: "", currency: "AED", vatNumber: "", invoicePrefix: "INV-", receiptPrefix: "RCP-", language: "English", ...settings?.company });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: string) { setForm((f: Record<string,string>) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Company settings saved" }); }
  return (
    <SectionCard title="Company Details" desc="Used on invoices, receipts, owner statements, and reports" onSave={save} saving={saving}>
      <Field label="Company name on documents"><Input data-testid="document-name" value={form.documentName} onChange={e => set("documentName", e.target.value)} placeholder={BRAND} maxLength={120} /><p className="text-xs text-muted-foreground mt-1">Shown on owner statements and their PDFs, in the Owner Portal and in emails to owners. Leave empty to use {BRAND}.</p></Field>
      <Field label="Email"><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></Field>
      <Field label="Address"><Input value={form.address} onChange={e => set("address", e.target.value)} /></Field>
      <Field label="Website"><Input value={form.website} onChange={e => set("website", e.target.value)} /></Field>
      <Field label="Currency">
        <Select value={form.currency} onValueChange={v => set("currency", v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{["AED","USD","EUR","GBP","SAR","QAR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="VAT / Tax Number"><Input value={form.vatNumber} onChange={e => set("vatNumber", e.target.value)} placeholder="e.g. 100123456789003" /></Field>
      <Field label="Invoice Prefix"><Input value={form.invoicePrefix} onChange={e => set("invoicePrefix", e.target.value)} className="w-32" /></Field>
      <Field label="Receipt Prefix"><Input value={form.receiptPrefix} onChange={e => set("receiptPrefix", e.target.value)} className="w-32" /></Field>
      <Field label="Default Language">
        <Select value={form.language} onValueChange={v => set("language", v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{["English","Arabic","French","Russian","Chinese"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </SectionCard>
  );
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function ThemeSection() {
  const { theme, setColorScheme, setAccent, setDensity } = useTheme();
  const { toast } = useToast();
  return (
    <SectionCard title="Appearance & Theme" desc={`Customize how ${BRAND} looks and feels`} onSave={() => toast({ title: "Theme saved" })}>
      <Field label="Color Mode">
        <div className="flex gap-2 flex-wrap">
          {(["light","dark","system"] as const).map(m => (
            <button key={m} onClick={() => setColorScheme(m)} className={`flex-1 min-w-[100px] p-3 rounded-xl border-2 text-sm font-medium transition-all capitalize ${theme.colorScheme === m ? "border-primary bg-primary/10" : "border-muted hover:border-muted-foreground/40"}`}>{m}</button>
          ))}
        </div>
      </Field>
      <Field label="Accent Color">
        <div className="flex gap-3 flex-wrap">
          {(Object.entries(ACCENT_VARS) as any[]).map(([key, val]) => (
            <button key={key} onClick={() => setAccent(key as any)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm transition-all ${theme.accent === key ? "border-primary" : "border-muted hover:border-muted-foreground/40"}`}>
              <span className="h-4 w-4 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-white" style={{ backgroundColor: val.swatch }} />
              {val.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Density">
        <div className="flex gap-3">
          {(["comfortable","compact"] as const).map(d => (
            <button key={d} onClick={() => setDensity(d)} className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium capitalize transition-all ${theme.density === d ? "border-primary bg-primary/10" : "border-muted hover:border-muted-foreground/40"}`}>{d}</button>
          ))}
        </div>
      </Field>
    </SectionCard>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────
function NotificationsSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defaults = { newBooking: true, checkinToday: true, checkoutToday: true, cleaningDue: true, cleaningOverdue: true, maintenanceReported: true, maintenanceApproval: true, paymentPending: true, payoutDue: true, payoutCompleted: false, taskOverdue: true, documentExpiring: true, lowOccupancy: false, dailySummary: true, weeklySummary: false, channels: { inApp: true, email: false, whatsapp: false }, quietHoursFrom: "22:00", quietHoursTo: "08:00" };
  const [form, setForm] = useState({ ...defaults, ...settings?.notifications });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Notification settings saved" }); }

  const events = [
    { key: "newBooking", label: "New Booking" }, { key: "checkinToday", label: "Check-In Today" },
    { key: "checkoutToday", label: "Check-Out Today" }, { key: "cleaningDue", label: "Cleaning Due" },
    { key: "cleaningOverdue", label: "Cleaning Overdue" }, { key: "maintenanceReported", label: "Maintenance Reported" },
    { key: "maintenanceApproval", label: "Maintenance Approval Required" }, { key: "paymentPending", label: "Guest Payment Pending" },
    { key: "payoutDue", label: "Owner Payout Due" }, { key: "payoutCompleted", label: "Owner Payout Completed" },
    { key: "taskOverdue", label: "Task Overdue" }, { key: "documentExpiring", label: "Document Expiring" },
    { key: "lowOccupancy", label: "Low Occupancy Alert" },
  ];

  return (
    <div className="space-y-4">
      <SectionCard title="Event Notifications" desc="Choose which events trigger notifications" onSave={save} saving={saving}>
        {events.map(ev => <ToggleRow key={ev.key} label={ev.label} checked={form[ev.key as keyof typeof form] as boolean} onCheckedChange={v => set(ev.key, v)} />)}
      </SectionCard>
      <SectionCard title="Channels" desc="Where to send notifications">
        <ToggleRow label="In-App" desc="Notification bell in the dashboard" checked={form.channels?.inApp ?? true} onCheckedChange={v => set("channels", { ...form.channels, inApp: v })} />
        <ToggleRow label="Email" desc="Send to company email" checked={form.channels?.email ?? false} onCheckedChange={v => set("channels", { ...form.channels, email: v })} />
        <ToggleRow label="WhatsApp" desc="Requires WhatsApp integration" checked={form.channels?.whatsapp ?? false} onCheckedChange={v => set("channels", { ...form.channels, whatsapp: v })} />
      </SectionCard>
      <SectionCard title="Schedule" desc="Summary and quiet hours">
        <ToggleRow label="Daily Summary" desc="Morning briefing of today's operations" checked={form.dailySummary} onCheckedChange={v => set("dailySummary", v)} />
        <ToggleRow label="Weekly Performance Summary" desc="Every Monday morning" checked={form.weeklySummary} onCheckedChange={v => set("weeklySummary", v)} />
        <div className="pt-2">
          <Field label="Quiet Hours">
            <div className="flex items-center gap-3">
              <Input type="time" value={form.quietHoursFrom} onChange={e => set("quietHoursFrom", e.target.value)} className="w-32" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="time" value={form.quietHoursTo} onChange={e => set("quietHoursTo", e.target.value)} className="w-32" />
            </div>
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Property Defaults ─────────────────────────────────────────────────────────
function PropertySection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { checkInTime: "15:00", checkOutTime: "11:00", cleaningFee: "" as number | "", securityDeposit: 500, managementFee: 20 as number | "", maxGuests: 4, maintenanceThreshold: 500, houseRules: "No smoking indoors. No parties. No pets unless pre-approved.", wifiInstructions: "WiFi name and password are in the welcome guide on the coffee table.", parkingInstructions: "Dedicated parking space in the basement. Use intercom for access." };
  const [form, setForm] = useState({ ...defs, ...settings?.property });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Property defaults saved" }); }
  return (
    <SectionCard title="Property Defaults" desc="Starting values for new properties" onSave={save} saving={saving}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Check-In Time"><Input type="time" value={form.checkInTime} onChange={e => set("checkInTime", e.target.value)} className="w-full" /></Field>
        <Field label="Check-Out Time"><Input type="time" value={form.checkOutTime} onChange={e => set("checkOutTime", e.target.value)} className="w-full" /></Field>
      </div>
      <div className="space-y-4">
        <Field label="Cleaning Fee (AED)" hint="Blank = no cleaning fee"><Input type="number" min="0" step="0.01" value={form.cleaningFee} onChange={e => set("cleaningFee", e.target.value === "" ? "" : +e.target.value)} className="w-32" /></Field>
        <Field label="Security Deposit (AED)"><Input type="number" value={form.securityDeposit} onChange={e => set("securityDeposit", +e.target.value)} className="w-32" /></Field>
        <Field label="Management Fee (%)" hint="Blank = 20%"><Input type="number" min="0" max="100" step="0.01" value={form.managementFee} onChange={e => set("managementFee", e.target.value === "" ? "" : +e.target.value)} className="w-32" /></Field>
      </div>
      <p className="text-xs text-muted-foreground">The cleaning and management fees here are only starting values: a new property gets them when you leave its fees blank. After that, each property's fees live in Accounting → Fee settings (also editable on the property). Changing these defaults does not change existing properties or bookings.</p>
      <Field label="Max Guests"><Input type="number" value={form.maxGuests} onChange={e => set("maxGuests", +e.target.value)} className="w-24" /></Field>
      <Field label="Maintenance Approval Threshold" hint="Owner approval required above this amount">
        <div className="flex items-center gap-2"><Input type="number" value={form.maintenanceThreshold} onChange={e => set("maintenanceThreshold", +e.target.value)} className="w-32" /><span className="text-sm text-muted-foreground">AED</span></div>
      </Field>
      <Field label="Default House Rules"><Textarea value={form.houseRules} onChange={e => set("houseRules", e.target.value)} rows={3} /></Field>
      <Field label="WiFi Instructions"><Textarea value={form.wifiInstructions} onChange={e => set("wifiInstructions", e.target.value)} rows={2} /></Field>
      <Field label="Parking Instructions"><Textarea value={form.parkingInstructions} onChange={e => set("parkingInstructions", e.target.value)} rows={2} /></Field>
    </SectionCard>
  );
}

// ─── Cleaning ─────────────────────────────────────────────────────────────────
function CleaningSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { studio: 150, oneBr: 200, twoBr: 280, threeBr: 380, villa: 500, inspectionRequired: true, photoRequired: true, linenChecklist: "Duvet cover\nPillowcases (x2 per bed)\nBed sheet\nBathroom towels (x2 per guest)\nHand towels\nBath mat", amenitiesChecklist: "Shampoo\nConditioner\nBody wash\nToilet paper (x2 per bathroom)\nDish soap\nSponge\nTrash bags\nTea/coffee sachets" };
  const [form, setForm] = useState({ ...defs, ...settings?.cleaning });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Cleaning settings saved" }); }
  return (
    <div className="space-y-4">
      <SectionCard title="Cleaning Rates by Property Type" desc="Default cleaning cost (AED)" onSave={save} saving={saving}>
        <div className="grid sm:grid-cols-3 gap-4">
          {[["studio","Studio"],["oneBr","1 Bedroom"],["twoBr","2 Bedrooms"],["threeBr","3 Bedrooms"],["villa","Villa"]].map(([k,l]) => (
            <Field key={k} label={l}><div className="flex items-center gap-2"><Input type="number" value={form[k as keyof typeof form] as number} onChange={e => set(k, +e.target.value)} /><span className="text-sm text-muted-foreground">AED</span></div></Field>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Quality Control">
        <ToggleRow label="Inspection Required" desc="Require manager inspection after cleaning" checked={form.inspectionRequired} onCheckedChange={v => set("inspectionRequired", v)} />
        <ToggleRow label="Before/After Photos Required" checked={form.photoRequired} onCheckedChange={v => set("photoRequired", v)} />
      </SectionCard>
      <SectionCard title="Checklists">
        <Field label="Linen Checklist"><Textarea value={form.linenChecklist} onChange={e => set("linenChecklist", e.target.value)} rows={6} className="font-mono text-sm" /></Field>
        <Field label="Amenities Checklist"><Textarea value={form.amenitiesChecklist} onChange={e => set("amenitiesChecklist", e.target.value)} rows={6} className="font-mono text-sm" /></Field>
      </SectionCard>
    </div>
  );
}

// ─── Maintenance ──────────────────────────────────────────────────────────────
function MaintenanceSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { approvalThreshold: 500, markupPct: 10, requireInvoice: true, requirePhotos: true, emergencyRule: "Contact manager immediately for AC, water leak, or lock issues.", categories: "AC\nPlumbing\nElectrical\nInternet\nFurniture\nAppliance\nPainting\nDeep Cleaning\nPest Control\nSmart Lock\nOther" };
  const [form, setForm] = useState({ ...defs, ...settings?.maintenance });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Maintenance settings saved" }); }
  return (
    <div className="space-y-4">
      <SectionCard title="Approval & Costs" desc="Owner approval thresholds and markup" onSave={save} saving={saving}>
        <Field label="Owner Approval Threshold" hint="Require approval above this amount">
          <div className="flex items-center gap-2"><Input type="number" value={form.approvalThreshold} onChange={e => set("approvalThreshold", +e.target.value)} className="w-32" /><span className="text-sm text-muted-foreground">AED</span></div>
        </Field>
        <Field label="Default Markup %" hint="Company margin on maintenance work">
          <div className="flex items-center gap-2"><Input type="number" value={form.markupPct} onChange={e => set("markupPct", +e.target.value)} className="w-24" /><span className="text-sm text-muted-foreground">%</span></div>
        </Field>
        <ToggleRow label="Require Invoice Upload" checked={form.requireInvoice} onCheckedChange={v => set("requireInvoice", v)} />
        <ToggleRow label="Require Before/After Photos" checked={form.requirePhotos} onCheckedChange={v => set("requirePhotos", v)} />
      </SectionCard>
      <SectionCard title="Categories & Rules">
        <Field label="Maintenance Categories" hint="One per line">
          <Textarea value={form.categories} onChange={e => set("categories", e.target.value)} rows={8} className="font-mono text-sm" />
        </Field>
        <Field label="Emergency Response Rule"><Textarea value={form.emergencyRule} onChange={e => set("emergencyRule", e.target.value)} rows={2} /></Field>
      </SectionCard>
    </div>
  );
}

// ─── Financial ─────────────────────────────────────────────────────────────
// The fields that used to be here (cleaningMargin, maintenanceMarkup, payoutMethod, vatEnabled, vatRate,
// expenseCategories, revenueCategories) were saved under the "financial" settings key but never read by
// any calculation, so they are hidden rather than shown as if they worked. Their saved values are kept
// untouched in app_settings (key "financial"); nothing here writes to it.
function FinancialSection(_props: { settings: any; onSave: (v: any) => void }) {
  return (
    <SectionCard title="Financial" desc="Where financial rules are set">
      <ul className="text-sm space-y-2 list-disc pl-5">
        <li>Management fee, cleaning fee, channel fees, VAT and tourism fee: per property in <a className="underline" href="/accounting">Accounting → Fee settings</a>.</li>
        <li>Cleaning company rate card and cleaning cost backfill: also in Accounting → Fee settings.</li>
        <li>Starting fees for new properties: Settings → Property Defaults.</li>
      </ul>
      <p className="text-xs text-muted-foreground">Cleaning margin, maintenance markup, payout calculation method, a company-wide VAT switch and category lists are not used by the app yet, so they are not shown. Anything saved earlier is kept.</p>
    </SectionCard>
  );
}

// ─── Payout Methods ───────────────────────────────────────────────────────────
function PayoutsSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { frequency: "monthly", methods: [], bankTransfer: { beneficiary: "", bank: "", iban: "", account: "", swift: "" }, ziina: { name: "", link: "", contact: "" }, cash: { note: "Cash collected by manager on owner's request." }, custom: { name: "", details: "" } };
  const [form, setForm] = useState({ ...defs, ...settings?.payouts });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  function setNested(section: string, k: string, v: string) { setForm((f: any) => ({ ...f, [section]: { ...f[section], [k]: v } })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Payout methods saved" }); }
  return (
    <div className="space-y-4">
      <SectionCard title="Payout Frequency" desc="Default payout schedule for owners" onSave={save} saving={saving}>
        <div className="flex gap-3 flex-wrap">
          {[["monthly","Monthly"],["weekly","Weekly"],["per_booking","After Each Booking"]].map(([v,l]) => (
            <button key={v} onClick={() => set("frequency", v)} className={`flex-1 min-w-[140px] p-3 rounded-xl border-2 text-sm font-medium transition-all ${form.frequency === v ? "border-primary bg-primary/10" : "border-muted hover:border-muted-foreground/40"}`}>{l}</button>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Bank Transfer Details">
        <Field label="Beneficiary Name"><Input value={form.bankTransfer?.beneficiary ?? ""} onChange={e => setNested("bankTransfer","beneficiary",e.target.value)} /></Field>
        <Field label="Bank Name"><Input value={form.bankTransfer?.bank ?? ""} onChange={e => setNested("bankTransfer","bank",e.target.value)} /></Field>
        <Field label="IBAN"><Input value={form.bankTransfer?.iban ?? ""} onChange={e => setNested("bankTransfer","iban",e.target.value)} placeholder="AE00 0000 0000 0000 0000 000" /></Field>
        <Field label="Account Number"><Input value={form.bankTransfer?.account ?? ""} onChange={e => setNested("bankTransfer","account",e.target.value)} /></Field>
        <Field label="SWIFT Code"><Input value={form.bankTransfer?.swift ?? ""} onChange={e => setNested("bankTransfer","swift",e.target.value)} /></Field>
      </SectionCard>
      <SectionCard title="Ziina (Instant Payments)">
        <Field label="Account Name"><Input value={form.ziina?.name ?? ""} onChange={e => setNested("ziina","name",e.target.value)} /></Field>
        <Field label="Ziina Link"><Input value={form.ziina?.link ?? ""} onChange={e => setNested("ziina","link",e.target.value)} placeholder="ziina.io/yourname" /></Field>
        <Field label="Registered Phone/Email"><Input value={form.ziina?.contact ?? ""} onChange={e => setNested("ziina","contact",e.target.value)} /></Field>
      </SectionCard>
      <SectionCard title="Cash Collection">
        <Field label="Collection Note"><Textarea value={form.cash?.note ?? ""} onChange={e => setNested("cash","note",e.target.value)} rows={2} /></Field>
      </SectionCard>
    </div>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────
function UsersSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "manager", phone: "" });

  const addMutation = useMutation({
    mutationFn: async () => { const r = await apiFetch(`${API}/api/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); if (!r.ok) throw new Error((await r.json()).error); return r.json(); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast({ title: "User created" }); setShowAdd(false); setForm({ name: "", email: "", password: "", role: "manager", phone: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, ...changes }: { id: number; status?: string; password?: string }) => { const r = await apiFetch(`${API}/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not update user"); },
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ["users"] }); if (vars.password) { toast({ title: "Password reset", description: "Share the new temporary password with the user securely." }); setResetUser(null); setNewPassword(""); } },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [resetUser, setResetUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h3 className="font-bold text-base">Users & Roles</h3><p className="text-sm text-muted-foreground">{users.length} team members</p></div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-2" /> Add User</Button>
      </div>
      <div className="bg-card border rounded-2xl overflow-hidden">
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b"><tr>{["Name","Role","Email","Status","Last Login",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {users.map((u: any) => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3"><div className="flex items-center gap-2.5"><div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{u.name.split(" ").map((n: string) => n[0]).slice(0,2).join("")}</div><span className="font-medium">{u.name}</span></div></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-700"}`}>{ROLE_LABELS[u.role] ?? u.role}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{u.status}</span></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "Never"}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => patchMutation.mutate({ id: u.id, status: u.status === "active" ? "inactive" : "active" })}>
                      {u.status === "active" ? "Deactivate" : "Activate"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setResetUser(u); setNewPassword(""); }}>Reset password</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Dialog open={!!resetUser} onOpenChange={o => { if (!o) setResetUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reset password · {resetUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Set a new temporary password (at least 8 characters). No email is sent — give it to {resetUser?.email} yourself.</p>
            <Input type="password" aria-label="New temporary password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <Button className="w-full" disabled={newPassword.length < 8 || patchMutation.isPending} onClick={() => patchMutation.mutate({ id: resetUser.id, password: newPassword })}>Set new password</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Temporary Password</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div><Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ROLE_LABELS).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Phone (optional)</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.name || !form.email || !form.password || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Create User
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI ────────────────────────────────────────────────────────────────────────
function AISection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { enabled: true, tone: "professional", language: "English", draftGuest: true, draftOwner: true, summarizeMaintenance: true, generateReports: false, pricingSuggestions: false };
  const [form, setForm] = useState({ ...defs, ...settings?.ai });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "AI settings saved" }); }
  return (
    <SectionCard title="AI Assistant Configuration" desc="Control how the AI assistant behaves" onSave={save} saving={saving}>
      <ToggleRow label="Enable AI Assistant" desc="Show AI features throughout the app" checked={form.enabled} onCheckedChange={v => set("enabled", v)} />
      <Field label="Response Tone">
        <Select value={form.tone} onValueChange={v => set("tone", v)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[["professional","Professional"],["friendly","Friendly & Warm"],["luxury","Luxury Hospitality"],["concise","Short & Direct"],["personal","Warm & Personal"]].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Default Language">
        <Select value={form.language} onValueChange={v => set("language", v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{["English","Arabic","French","Russian","Chinese"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="border-t pt-4 mt-2 space-y-0">
        <ToggleRow label="Draft Guest Messages" checked={form.draftGuest} onCheckedChange={v => set("draftGuest", v)} />
        <ToggleRow label="Draft Owner Updates" checked={form.draftOwner} onCheckedChange={v => set("draftOwner", v)} />
        <ToggleRow label="Summarize Maintenance Issues" checked={form.summarizeMaintenance} onCheckedChange={v => set("summarizeMaintenance", v)} />
        <ToggleRow label="Generate Financial Reports" checked={form.generateReports} onCheckedChange={v => set("generateReports", v)} />
        <ToggleRow label="Pricing Improvement Suggestions" checked={form.pricingSuggestions} onCheckedChange={v => set("pricingSuggestions", v)} />
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>AI Status:</strong> Requires phone verification in Replit account settings to activate OpenAI. Once connected, all AI features will work automatically.
      </div>
    </SectionCard>
  );
}

// ─── Integrations ─────────────────────────────────────────────────────────────
function IntegrationsSection() {
  const integrations = [
    { name: "Airbnb", logo: "🏡", status: "coming_soon", desc: "Sync bookings, calendar, and messages" },
    { name: "Booking.com", logo: "🌐", status: "coming_soon", desc: "Two-way calendar and reservation sync" },
    { name: "WhatsApp Business", logo: "💬", status: "coming_soon", desc: "Send automated guest messages via WhatsApp" },
    { name: "Google Calendar", logo: "📅", status: "coming_soon", desc: "Sync property availability to Google Calendar" },
    { name: "Stripe", logo: "💳", status: "coming_soon", desc: "Accept credit card payments online" },
    { name: "Ziina", logo: "⚡", status: "coming_soon", desc: "Instant AED payments for UAE" },
    { name: "Email SMTP", logo: "📧", status: "configurable", desc: "Send automated emails via your mail server" },
    { name: "Google Drive", logo: "☁️", status: "coming_soon", desc: "Auto-backup documents and photos" },
  ];
  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Integrations Hub</strong> — Direct channel connections are coming soon. Use iCal sync under Platforms for calendar sync in the meantime.
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {integrations.map(int => (
          <div key={int.name} className="bg-card border rounded-xl p-4 flex items-start gap-3">
            <div className="text-2xl flex-shrink-0">{int.logo}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{int.name}</span>
                {int.status === "coming_soon" ? <Badge className="text-[10px] bg-gray-100 text-gray-500">Coming Soon</Badge> : <Badge className="text-[10px] bg-blue-100 text-blue-700">Available</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{int.desc}</p>
            </div>
            <Button variant="outline" size="sm" className="text-xs flex-shrink-0" disabled={int.status === "coming_soon"}>
              {int.status === "coming_soon" ? "Soon" : "Connect"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Documents Config ─────────────────────────────────────────────────────────
function DocumentsSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { expiryReminderDays: 30, requiredOwner: "Owner Agreement\nTitle Deed\nPassport / EID", requiredProperty: "DTCM Permit\nDEWA Bill\nEmpower/Emicool Bill", requiredGuest: "Passport Copy\nVisa (if required)" };
  const [form, setForm] = useState({ ...defs, ...settings?.documentsConfig });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Document settings saved" }); }
  return (
    <SectionCard title="Document Requirements" desc="Required documents and expiry alert rules" onSave={save} saving={saving}>
      <Field label="Expiry Reminder (days)" hint="Alert X days before a document expires">
        <Input type="number" value={form.expiryReminderDays} onChange={e => set("expiryReminderDays", +e.target.value)} className="w-24" />
      </Field>
      <Field label="Required Owner Documents" hint="One per line"><Textarea value={form.requiredOwner} onChange={e => set("requiredOwner", e.target.value)} rows={4} className="font-mono text-sm" /></Field>
      <Field label="Required Property Documents" hint="One per line"><Textarea value={form.requiredProperty} onChange={e => set("requiredProperty", e.target.value)} rows={4} className="font-mono text-sm" /></Field>
      <Field label="Required Guest Documents" hint="One per line"><Textarea value={form.requiredGuest} onChange={e => set("requiredGuest", e.target.value)} rows={3} className="font-mono text-sm" /></Field>
    </SectionCard>
  );
}

// ─── PMS Plans ────────────────────────────────────────────────────────────────
function PlansSection({ settings, onSave }: { settings: any; onSave: (v: any) => void }) {
  const defs = { starter: { name: "Starter", price: 299, properties: 5, users: 3, trial: 14 }, growth: { name: "Growth", price: 499, properties: 15, users: 10, trial: 14 }, pro: { name: "Pro", price: 999, properties: 999, users: 999, trial: 30 } };
  const [form, setForm] = useState({ ...defs, ...settings?.plans });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  function setNested(plan: string, k: string, v: any) { setForm((f: any) => ({ ...f, [plan]: { ...f[plan], [k]: v } })); }
  async function save() { setSaving(true); await onSave(form); setSaving(false); toast({ title: "Plan settings saved" }); }
  return (
    <SectionCard title="PMS Subscription Plans" desc="Configure plans for external clients" onSave={save} saving={saving}>
      <div className="grid sm:grid-cols-3 gap-4">
        {(["starter","growth","pro"] as const).map((plan, i) => {
          const colors = ["border-blue-200 bg-blue-50","border-purple-200 bg-purple-50","border-amber-200 bg-amber-50"];
          return (
            <div key={plan} className={`rounded-2xl border-2 p-4 space-y-3 ${colors[i]}`}>
              <Input value={form[plan]?.name ?? ""} onChange={e => setNested(plan,"name",e.target.value)} className="font-bold text-base bg-white border-0 shadow-none" />
              <div><Label className="text-xs">Monthly Price (AED)</Label><Input type="number" value={form[plan]?.price ?? 0} onChange={e => setNested(plan,"price",+e.target.value)} className="bg-white" /></div>
              <div><Label className="text-xs">Max Properties</Label><Input type="number" value={form[plan]?.properties ?? 0} onChange={e => setNested(plan,"properties",+e.target.value)} className="bg-white" /></div>
              <div><Label className="text-xs">Max Users</Label><Input type="number" value={form[plan]?.users ?? 0} onChange={e => setNested(plan,"users",+e.target.value)} className="bg-white" /></div>
              <div><Label className="text-xs">Trial Days</Label><Input type="number" value={form[plan]?.trial ?? 0} onChange={e => setNested(plan,"trial",+e.target.value)} className="bg-white" /></div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ─── Automations + Templates (link sections) ──────────────────────────────────
function AutomationsSection() {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-center gap-4">
        <Zap className="h-10 w-10 text-amber-500 flex-shrink-0" />
        <div>
          <h3 className="font-bold text-base">Automation Rules</h3>
          <p className="text-sm text-muted-foreground">Manage your automation rules — toggle them on/off, edit timing, and more.</p>
          <Button className="mt-3" onClick={() => setLocation("/automations")}>Open Automations <ExternalLink className="h-4 w-4 ml-2" /></Button>
        </div>
      </div>
    </div>
  );
}

function TemplatesSection() {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-4">
      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-6 flex items-center gap-4">
        <MessageSquare className="h-10 w-10 text-purple-500 flex-shrink-0" />
        <div>
          <h3 className="font-bold text-base">Message Templates</h3>
          <p className="text-sm text-muted-foreground">Edit your WhatsApp, email, and SMS templates with dynamic variables.</p>
          <Button className="mt-3" onClick={() => setLocation("/templates")}>Open Templates <ExternalLink className="h-4 w-4 ml-2" /></Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("company");
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const qc = useQueryClient();

  async function saveSection(key: string, value: unknown) {
    await apiFetch(`${API}/api/settings/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  const groups = [...new Set(SECTIONS.map(s => s.group))];

  function renderSection() {
    if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    switch (activeSection) {
      case "company":      return <CompanySection settings={settings} onSave={v => saveSection("company", v)} />;
      case "theme":        return <ThemeSection />;
      case "notifications":return <NotificationsSection settings={settings} onSave={v => saveSection("notifications", v)} />;
      case "property":     return <PropertySection settings={settings} onSave={v => saveSection("property", v)} />;
      case "cleaning":     return <CleaningSection settings={settings} onSave={v => saveSection("cleaning", v)} />;
      case "maintenance":  return <MaintenanceSection settings={settings} onSave={v => saveSection("maintenance", v)} />;
      case "financial":    return <FinancialSection settings={settings} onSave={v => saveSection("financial", v)} />;
      case "payouts":      return <PayoutsSection settings={settings} onSave={v => saveSection("payouts", v)} />;
      case "users":        return <UsersSection />;
      case "ai":           return <AISection settings={settings} onSave={v => saveSection("ai", v)} />;
      case "automations":  return <AutomationsSection />;
      case "templates":    return <TemplatesSection />;
      case "integrations": return <IntegrationsSection />;
      case "documents":    return <DocumentsSection settings={settings} onSave={v => saveSection("documentsConfig", v)} />;
      case "plans":        return <PlansSection settings={settings} onSave={v => saveSection("plans", v)} />;
      default: return null;
    }
  }

  const activeInfo = SECTIONS.find(s => s.id === activeSection);

  return (
    <div className="flex h-full min-h-screen">
      {/* Left nav */}
      <aside className="w-56 flex-shrink-0 border-r bg-muted/20 py-6 overflow-y-auto hidden md:block">
        {groups.map(group => (
          <div key={group} className="mb-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-4 mb-1">{group}</p>
            {SECTIONS.filter(s => s.group === group).map(s => {
              const Icon = s.icon;
              const active = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${active ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            {activeInfo && <activeInfo.icon className="h-6 w-6 text-muted-foreground" />}
            <div>
              <h1 className="text-xl font-bold">{activeInfo?.label} Settings</h1>
              <p className="text-sm text-muted-foreground capitalize">{activeInfo?.group}</p>
            </div>
          </div>

          {/* Mobile section picker */}
          <div className="md:hidden mb-4">
            <Select value={activeSection} onValueChange={setActiveSection}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SECTIONS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {renderSection()}
        </div>
      </div>
    </div>
  );
}
