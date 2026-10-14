import { INSTANCE } from "@/lib/instance";
import { useUiMode } from "@/hooks/use-ui-mode";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Building2, Users, Link2, UserPlus, CheckCircle2,
  ArrowRight, X, Sparkles, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";

const ONBOARDING_KEY = "ys_onboarded";
const ONBOARDING_STEP_KEY = "ys_onboarding_step";

const STEPS = [
  {
    id: 1,
    icon: Building2,
    title: "Set up your company",
    subtitle: "Tell us about your property management business.",
    color: "text-teal-400",
    bg: "bg-teal-500/15",
    action: "Continue",
    skip: false,
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Your company profile is the foundation for everything — owner statements, invoices, and guest communications will carry your company name and branding.</p>
        <div className="bg-muted/40 rounded-xl p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" /> Set your company name and logo</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" /> Add your RERA/DET license numbers</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" /> Configure your management fee defaults</div>
        </div>
      </div>
    ),
    cta: "/settings",
    ctaLabel: "Go to Settings",
  },
  {
    id: 2,
    icon: Building2,
    title: "Add your first property",
    subtitle: "Add it by hand, then connect its calendars.",
    color: "text-blue-400",
    bg: "bg-blue-500/15",
    action: "Add Property",
    skip: true,
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Once you add a property, it appears in your calendar, cleaning schedule, maintenance board, and owner reports automatically.</p>
        <div className="bg-muted/40 rounded-xl p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" /> Name, unit and owner on the Properties page</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" /> Add unit number, DTCM license, owner info</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" /> Set check-in instructions and WiFi details</div>
        </div>
      </div>
    ),
    cta: "/properties",
    ctaLabel: "Add Property",
  },
  {
    id: 3,
    icon: Users,
    title: "Add a property owner",
    subtitle: "Link owners to their properties for statements and portal access.",
    color: "text-violet-400",
    bg: "bg-violet-500/15",
    action: "Add Owner",
    skip: true,
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Owners can log in to their own portal to track bookings, revenue, and statements — without seeing your full PMS.</p>
        <div className="bg-muted/40 rounded-xl p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" /> Add owner name, email, and bank details</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" /> Auto-generate monthly owner statements</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" /> Owners get read-only portal access</div>
        </div>
      </div>
    ),
    cta: "/owners",
    ctaLabel: "Add Owner",
  },
  {
    id: 4,
    icon: Link2,
    title: "Connect booking channels",
    subtitle: "Sync Airbnb, Booking.com, and more.",
    color: "text-amber-400",
    bg: "bg-amber-500/15",
    action: "Connect Channels",
    skip: true,
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Connect your booking platforms so reservations, calendars, and guest messages flow into LaunchRiot automatically.</p>
        <div className="bg-muted/40 rounded-xl p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /> Airbnb — iCal sync or API (coming soon)</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /> Booking.com — iCal + extranet setup</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /> Direct bookings via your own calendar link</div>
        </div>
      </div>
    ),
    cta: "/platforms",
    ctaLabel: "Connect Platforms",
  },
  {
    id: 5,
    icon: UserPlus,
    title: "Invite your team",
    subtitle: "Add cleaners, managers, and accountants.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/15",
    action: "Invite Team",
    skip: true,
    body: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Each team member gets access based on their role — cleaners see only their tasks, accountants see only financials.</p>
        <div className="bg-muted/40 rounded-xl p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" /> Roles: Manager, Cleaner, Accountant, Reservations</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" /> Staff get login credentials by email</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" /> Role-based access controls throughout</div>
        </div>
      </div>
    ),
    cta: "/staff",
    ctaLabel: "Invite Staff",
  },
];

export function OnboardingWizard() {
  if (INSTANCE.whiteLabel) return null;
  const { mode: uiMode, loaded: uiModeLoaded } = useUiMode();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Re-check on every route change: wizard stays alive until "Skip setup" or step 5 is finished
  useEffect(() => {
    if (!user) return;
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) {
      const saved = parseInt(localStorage.getItem(ONBOARDING_STEP_KEY) ?? "0", 10);
      setStep(isNaN(saved) ? 0 : Math.min(saved, STEPS.length - 1));
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [user, location]);

  function dismiss() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    localStorage.removeItem(ONBOARDING_STEP_KEY);
    setVisible(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      const nextStep = step + 1;
      setStep(nextStep);
      localStorage.setItem(ONBOARDING_STEP_KEY, String(nextStep));
    } else {
      dismiss();
    }
  }

  function goTo(cta: string) {
    // Advance to next step and navigate. The wizard will re-open on the
    // target page (since ys_onboarded is still unset) so the user continues
    // the flow naturally. Only "Skip setup" permanently dismisses.
    if (step < STEPS.length - 1) {
      const nextStep = step + 1;
      localStorage.setItem(ONBOARDING_STEP_KEY, String(nextStep));
    } else {
      dismiss();
    }
    setVisible(false);
    setLocation(cta);
  }

  // The Simple/Full choice comes first; the tour starts only once a mode is saved (no stacked pop-ups).
  if (!visible || !uiModeLoaded || !uiMode) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(0,0,0,0.65)", backdropFilter:"blur(6px)" }}>
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ background:"hsl(var(--card))", border:"1px solid hsl(var(--border))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${current.bg}`}>
              <Icon className={`h-5 w-5 ${current.color}`} />
            </div>
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Step {step + 1} of {STEPS.length}
              </div>
              <div className="font-bold text-sm">{current.title}</div>
            </div>
          </div>
          <button onClick={dismiss} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div className="h-full bg-teal-500 transition-all duration-500 rounded-full" style={{ width:`${progress}%` }} />
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground mb-4">{current.subtitle}</p>
          {current.body}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-teal-500" : i < step ? "w-1.5 bg-teal-500/40" : "w-1.5 bg-muted"}`} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex items-center justify-between gap-3">
          <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
            Skip setup
          </button>
          <div className="flex items-center gap-2">
            {current.skip && (
              <Button variant="outline" size="sm" onClick={next} className="gap-1">
                Skip <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" onClick={() => goTo(current.cta)} className="gap-1.5">
              {current.ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useShowOnboarding() {
  return {
    reset: () => localStorage.removeItem(ONBOARDING_KEY),
  };
}
