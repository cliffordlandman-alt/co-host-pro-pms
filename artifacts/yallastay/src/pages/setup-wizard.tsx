import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Building, User, CalendarCheck, CheckCircle2, ArrowRight, ArrowLeft,
  Loader2, Wifi, SkipForward, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import logoPath from "../assets/cohost-logo.svg";
import { BRAND } from "../../../../lib/brand.mjs";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const STEPS = [
  { num: 1, label: "Company Details", icon: Sparkles },
  { num: 2, label: "First Owner", icon: User },
  { num: 3, label: "First Property", icon: Building },
  { num: 4, label: "Airbnb iCal", icon: Wifi },
  { num: 5, label: "Booking.com iCal", icon: Wifi },
  { num: 6, label: "All Done", icon: CheckCircle2 },
];

interface WizardState {
  companyName: string;
  companyCurrency: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerCommission: string;
  propertyName: string;
  unitNumber: string;
  building: string;
  area: string;
  bedroomType: string;
  cleaningFee: string;
  managementFee: string;
  airbnbIcalUrl: string;
  bookingComIcalUrl: string;
  ownerId?: number;
  propertyId?: number;
}

const INITIAL: WizardState = {
  companyName: "", companyCurrency: "AED",
  ownerName: "", ownerEmail: "", ownerPhone: "", ownerCommission: "20",
  propertyName: "", unitNumber: "", building: "", area: "", bedroomType: "1BR", cleaningFee: "200", managementFee: "20",
  airbnbIcalUrl: "", bookingComIcalUrl: "",
};

export default function SetupWizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const set = (field: keyof WizardState, value: string) =>
    setData(prev => ({ ...prev, [field]: value }));

  async function saveStep1() {
    if (!data.companyName.trim()) { toast({ title: "Company name is required", variant: "destructive" }); return false; }
    setSaving(true);
    try {
      await apiFetch(`${API}/api/settings/company`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: { name: data.companyName, documentName: data.companyName, currency: data.companyCurrency } }),
      });
      return true;
    } catch { toast({ title: "Failed to save", variant: "destructive" }); return false; }
    finally { setSaving(false); }
  }

  async function saveStep2(): Promise<boolean> {
    if (!data.ownerName.trim() || !data.ownerEmail.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" }); return false;
    }
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/api/owners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.ownerName,
          email: data.ownerEmail,
          phone: data.ownerPhone || null,
          commissionRate: data.ownerCommission ? parseFloat(data.ownerCommission) : 20,
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || "Failed"); }
      const owner = await r.json();
      setData(prev => ({ ...prev, ownerId: owner.id }));
      return true;
    } catch (e: any) {
      toast({ title: e.message || "Failed to create owner", variant: "destructive" }); return false;
    } finally { setSaving(false); }
  }

  async function saveStep3(): Promise<boolean> {
    if (!data.propertyName.trim()) { toast({ title: "Property name is required", variant: "destructive" }); return false; }
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/api/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.propertyName,
          unitNumber: data.unitNumber || "TBC",
          building: data.building || null,
          area: data.area || null,
          ownerId: data.ownerId ?? null,
          bedroomType: data.bedroomType,
          status: "active",
          cleaningFee: data.cleaningFee,
          managementFee: data.managementFee,
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || "Failed"); }
      const property = await r.json();
      setData(prev => ({ ...prev, propertyId: property.id }));
      return true;
    } catch (e: any) {
      toast({ title: e.message || "Failed to create property", variant: "destructive" }); return false;
    } finally { setSaving(false); }
  }

  async function saveIcal(urlField: "airbnbIcalUrl" | "bookingComIcalUrl", apiField: string): Promise<boolean> {
    const url = data[urlField];
    if (!url.trim()) return true; // skipped
    if (!data.propertyId) return true;
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/api/properties/${data.propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [apiField]: url }),
      });
      if (!r.ok) throw new Error("Failed to save iCal URL");
      return true;
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" }); return false;
    } finally { setSaving(false); }
  }

  async function finishSetup() {
    setSaving(true);
    try {
      await apiFetch(`${API}/api/settings/setup_complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: true }),
      });
      localStorage.setItem("ys_setup_done", "1");
    } catch {}
    setSaving(false);
    setLocation("/dashboard");
  }

  async function handleNext() {
    let ok = true;
    if (step === 1) ok = await saveStep1();
    else if (step === 2) ok = await saveStep2();
    else if (step === 3) ok = await saveStep3();
    else if (step === 4) ok = await saveIcal("airbnbIcalUrl", "airbnbIcalUrl");
    else if (step === 5) ok = await saveIcal("bookingComIcalUrl", "bookingComIcalUrl");
    else if (step === 6) { await finishSetup(); return; }
    if (ok) setStep(s => s + 1);
  }

  async function handleSkip() {
    setStep(s => s + 1);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="border-b px-6 py-4 flex items-center gap-3">
        <img src={logoPath} alt={BRAND} className="h-8 w-auto" />
        <span className="text-sm text-muted-foreground">First-time setup</span>
      </div>

      <div className="flex flex-1 overflow-auto">
        {/* Left sidebar — progress */}
        <div className="hidden md:flex flex-col w-64 border-r p-6 gap-1 bg-muted/20 shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Setup progress</p>
          {STEPS.map(s => {
            const done = step > s.num;
            const active = step === s.num;
            const Icon = s.icon;
            return (
              <div key={s.num} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${active ? "bg-primary/10 text-primary" : done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-100 dark:bg-emerald-900" : "bg-muted"}`}>
                  {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span className={`text-sm font-medium ${active ? "text-foreground" : ""}`}>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-start justify-center p-6 md:p-12">
          <div className="w-full max-w-xl">
            {/* Mobile progress */}
            <div className="flex gap-1.5 mb-8 md:hidden">
              {STEPS.map(s => (
                <div key={s.num} className={`h-1 flex-1 rounded-full ${step >= s.num ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>

            {/* Step 1: Company */}
            {step === 1 && (
              <StepCard
                title={`Welcome to ${BRAND}`}
                subtitle="Let's set up your property management system. Start with your company details."
                step="Step 1 of 6"
              >
                <Field label="Company Name *">
                  <Input
                    placeholder="e.g. Dubai Luxury Stays LLC"
                    value={data.companyName}
                    onChange={e => set("companyName", e.target.value)}
                    autoFocus
                  />
                </Field>
                <Field label="Currency">
                  <Select value={data.companyCurrency} onValueChange={v => set("companyCurrency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AED">AED — UAE Dirham</SelectItem>
                      <SelectItem value="USD">USD — US Dollar</SelectItem>
                      <SelectItem value="EUR">EUR — Euro</SelectItem>
                      <SelectItem value="GBP">GBP — British Pound</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </StepCard>
            )}

            {/* Step 2: Owner */}
            {step === 2 && (
              <StepCard
                title="Add Your First Owner"
                subtitle="Property owners are the people who own the units you manage on their behalf."
                step="Step 2 of 6"
              >
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Owner Name *" className="col-span-2">
                    <Input
                      placeholder="e.g. Ahmed Al Mansoori"
                      value={data.ownerName}
                      onChange={e => set("ownerName", e.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field label="Email Address *" className="col-span-2">
                    <Input
                      type="email"
                      placeholder="ahmed@example.com"
                      value={data.ownerEmail}
                      onChange={e => set("ownerEmail", e.target.value)}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      placeholder="+971 50 000 0000"
                      value={data.ownerPhone}
                      onChange={e => set("ownerPhone", e.target.value)}
                    />
                  </Field>
                  <Field label="Commission (%)">
                    <Input
                      type="number"
                      min="0" max="50" step="0.5"
                      value={data.ownerCommission}
                      onChange={e => set("ownerCommission", e.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">You can add more owners later from the Owners module.</p>
              </StepCard>
            )}

            {/* Step 3: Property */}
            {step === 3 && (
              <StepCard
                title="Add Your First Property"
                subtitle="Enter the details for your first managed property. You can edit these later."
                step="Step 3 of 6"
              >
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Property Name *" className="col-span-2">
                    <Input
                      placeholder="e.g. Marina Gate 2 — Unit 12A"
                      value={data.propertyName}
                      onChange={e => set("propertyName", e.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field label="Building Name">
                    <Input
                      placeholder="e.g. Marina Gate 2"
                      value={data.building}
                      onChange={e => set("building", e.target.value)}
                    />
                  </Field>
                  <Field label="Unit Number">
                    <Input
                      placeholder="e.g. 12A"
                      value={data.unitNumber}
                      onChange={e => set("unitNumber", e.target.value)}
                    />
                  </Field>
                  <Field label="Area / Neighbourhood">
                    <Input
                      placeholder="e.g. Dubai Marina"
                      value={data.area}
                      onChange={e => set("area", e.target.value)}
                    />
                  </Field>
                  <Field label="Bedroom Type">
                    <Select value={data.bedroomType} onValueChange={v => set("bedroomType", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Studio", "1BR", "2BR", "3BR", "4BR", "5BR+", "Villa"].map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Cleaning Fee (AED)">
                    <Input type="number" value={data.cleaningFee} onChange={e => set("cleaningFee", e.target.value)} />
                  </Field>
                  <Field label="Management Fee (%)">
                    <Input type="number" value={data.managementFee} onChange={e => set("managementFee", e.target.value)} />
                  </Field>
                </div>
              </StepCard>
            )}

            {/* Step 4: Airbnb iCal */}
            {step === 4 && (
              <StepCard
                title="Connect Airbnb Calendar"
                subtitle="Paste your Airbnb iCal URL to automatically sync reservations, block-outs, and availability."
                step="Step 4 of 6"
                optional
              >
                <div className="rounded-lg bg-muted/50 border p-4 text-sm space-y-2 mb-2">
                  <p className="font-medium">How to get your Airbnb iCal URL:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                    <li>Go to airbnb.com → Listings → select your listing</li>
                    <li>Click <strong>Availability</strong> → scroll to <strong>Sync calendars</strong></li>
                    <li>Click <strong>Export calendar</strong> and copy the URL</li>
                  </ol>
                </div>
                <Field label="Airbnb iCal URL">
                  <Input
                    type="url"
                    placeholder="https://www.airbnb.com/calendar/ical/..."
                    value={data.airbnbIcalUrl}
                    onChange={e => set("airbnbIcalUrl", e.target.value)}
                  />
                </Field>
              </StepCard>
            )}

            {/* Step 5: Booking.com iCal */}
            {step === 5 && (
              <StepCard
                title="Connect Booking.com Calendar"
                subtitle="Paste your Booking.com iCal URL to sync reservations from Booking.com."
                step="Step 5 of 6"
                optional
              >
                <div className="rounded-lg bg-muted/50 border p-4 text-sm space-y-2 mb-2">
                  <p className="font-medium">How to get your Booking.com iCal URL:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                    <li>Log in to Booking.com Extranet → select your property</li>
                    <li>Go to <strong>Calendar</strong> → <strong>Sync calendars</strong></li>
                    <li>Copy the <strong>Export calendar</strong> URL</li>
                  </ol>
                </div>
                <Field label="Booking.com iCal URL">
                  <Input
                    type="url"
                    placeholder="https://admin.booking.com/hotel/hoteladmin/ical.html?..."
                    value={data.bookingComIcalUrl}
                    onChange={e => set("bookingComIcalUrl", e.target.value)}
                  />
                </Field>
              </StepCard>
            )}

            {/* Step 6: Done */}
            {step === 6 && (
              <div className="text-center space-y-6 py-6">
                <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">You're all set!</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Your property management system is ready. Here's a summary of what was created:
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                  {[
                    { icon: Sparkles, label: "Company", value: data.companyName || "—" },
                    { icon: User, label: "Owner", value: data.ownerName || "—" },
                    { icon: Building, label: "Property", value: data.propertyName || "—" },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                      <Icon className="w-4 h-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-sm font-medium truncate">{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {(data.airbnbIcalUrl || data.bookingComIcalUrl) && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2 justify-center">
                    <CheckCircle2 className="w-4 h-4" />
                    Calendar sync configured — reservations will import automatically.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  You can add more properties, owners, and staff from their respective modules in the sidebar.
                </p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t gap-3">
              <div>
                {step > 1 && step < 6 && (
                  <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={saving}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {(step === 4 || step === 5) && (
                  <Button variant="outline" onClick={handleSkip} disabled={saving}>
                    <SkipForward className="w-4 h-4 mr-2" />
                    Skip
                  </Button>
                )}
                <Button onClick={handleNext} disabled={saving} className="gap-2 min-w-[120px]">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {step === 6 ? "Go to Dashboard" : step === 4 || step === 5 ? (
                    <>{data[step === 4 ? "airbnbIcalUrl" : "bookingComIcalUrl"] ? "Save & Continue" : "Continue"}</>
                  ) : "Continue"}
                  {!saving && step < 6 && <ArrowRight className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({ title, subtitle, step, optional, children }: {
  title: string; subtitle: string; step: string; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">{step}</span>
          {optional && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Optional</span>}
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
