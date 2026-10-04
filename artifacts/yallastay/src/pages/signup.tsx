import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import {
  Loader2, Eye, EyeOff, Mail, Lock, User, Building2, Phone,
  Shield, Globe, CheckCircle2, ArrowLeft, Briefcase,
} from "lucide-react";
import logoPath from "../assets/yallastay-logo.png";
import dubaiSkyline from "../assets/dubai-skyline.png";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLES = [
  { value: "super_admin", label: "Super Admin", desc: "Full access to all features" },
  { value: "manager",     label: "Manager",     desc: "Manage operations and team" },
  { value: "accountant",  label: "Accountant",  desc: "Financial reports and payments" },
  { value: "owner",       label: "Owner",       desc: "View your property performance" },
  { value: "cleaner",     label: "Cleaner",     desc: "Cleaning tasks and schedules" },
];

export default function Signup() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && user) setLocation("/dashboard");
  }, [authLoading, user]);

  const [form, setForm] = useState({
    name: "", email: "", password: "", confirmPassword: "",
    company: "", phone: "", role: "super_admin",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Full name is required");
    if (!form.email.trim()) return setError("Email is required");
    if (form.password.length < 8) return setError("Password must be at least 8 characters");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match");
    if (!form.role) return setError("Please select a role");

    setLoading(true);
    try {
      const res = await apiFetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          company: form.company.trim() || undefined,
          phone: form.phone.trim() || undefined,
          role: form.role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setLocation("/login?registered=1");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes ys-fade  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes ys-fadex { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
        .ys-a1 { animation: ys-fadex 0.7s ease both 0.05s; }
        .ys-r1 { animation: ys-fade 0.6s ease both 0.1s; }
        .ys-input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#fff; transition:border-color 0.2s, background 0.2s; }
        .ys-input:focus { background:rgba(255,255,255,0.10); border-color:rgba(45,212,191,0.6); outline:none; }
        .ys-input::placeholder { color:rgba(255,255,255,0.3); }
        .ys-btn:hover { transform:translateY(-1px); box-shadow:0 8px 32px rgba(13,148,136,0.45); }
        .ys-btn { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .ys-role:hover { border-color:rgba(45,212,191,0.4) !important; background:rgba(45,212,191,0.08) !important; }
        .ys-role-active { border-color:rgba(45,212,191,0.6) !important; background:rgba(45,212,191,0.12) !important; }
        @media (max-width: 767px) { .ys-left { display:none; } .ys-right { width:100vw !important; max-width:100vw !important; min-height:100dvh; } }
      `}</style>

      <div className="min-h-screen flex overflow-hidden" style={{ background:"#06131a" }}>

        {/* LEFT PANEL */}
        <div className="ys-left flex-1 relative flex flex-col p-10 overflow-hidden" style={{ minHeight:"100vh" }}>
          <img src={dubaiSkyline} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ opacity:0.5 }} />
          <div className="absolute inset-0" style={{ background:"linear-gradient(135deg, rgba(4,22,28,0.88) 0%, rgba(6,35,42,0.75) 50%, rgba(4,18,24,0.85) 100%)" }} />

          <div className="relative z-10 flex flex-col h-full">
            <div className="ys-a1 flex items-center gap-3">
              <img src={logoPath} alt="YallaStay" className="h-16 w-16" style={{ filter:"drop-shadow(0 0 20px rgba(45,212,191,0.7))" }} />
              <div>
                <div className="text-xl font-extrabold text-white">Yalla<span className="text-teal-400">Stay</span></div>
                <div className="text-[10px] text-teal-300/60 tracking-[0.15em] uppercase">Property Management</div>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              <h2 className="text-4xl font-black text-white leading-tight tracking-tight mb-4">
                Start managing<br /><span className="text-teal-400">your portfolio.</span>
              </h2>
              <p className="text-white/55 text-base leading-relaxed max-w-xs mb-8">
                Create your account and connect your properties in minutes. No setup fees.
              </p>

              <div className="space-y-3 max-w-xs">
                {[
                  { icon: "🏠", text: "Sync Airbnb calendars by iCal" },
                  { icon: "📅", text: "Sync bookings from all platforms" },
                  { icon: "💰", text: "Auto-generate owner statements" },
                  { icon: "🧹", text: "Assign and track cleaning tasks" },
                  { icon: "📊", text: "Revenue reports and insights" },
                ].map(f => (
                  <div key={f.text} className="flex items-center gap-3">
                    <span className="text-lg">{f.icon}</span>
                    <span className="text-white/65 text-sm">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full" style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.13)" }}>
              <Shield className="h-4 w-4 text-teal-400 flex-shrink-0" />
              <span className="text-white/70 text-sm">Your data is secure and private</span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — Signup Form */}
        <div className="ys-right flex items-start justify-center p-6 sm:p-8 md:p-10 overflow-y-auto" style={{ width:"520px", flexShrink:0, background:"rgba(8,20,26,0.97)" }}>
          <div className="ys-r1 w-full max-w-[420px] py-4">

            <button onClick={() => setLocation("/login")} className="flex items-center gap-1.5 text-teal-400/60 hover:text-teal-400 transition-colors text-xs font-medium mb-6">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </button>

            <div className="mb-7">
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="text-white/45 text-sm mt-1">Get started with YallaStay — free to use</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name + Email */}
              <div className="grid grid-cols-1 gap-4">
                <Field icon={<User className="h-4 w-4" />} label="Full Name" required>
                  <input type="text" value={form.name} onChange={upd("name")} className="ys-input w-full h-11 pl-10 pr-4 rounded-xl text-sm" placeholder="Sarah Al Mansoori" required />
                </Field>

                <Field icon={<Mail className="h-4 w-4" />} label="Work Email" required>
                  <input type="email" value={form.email} onChange={upd("email")} className="ys-input w-full h-11 pl-10 pr-4 rounded-xl text-sm" placeholder="you@company.com" required autoComplete="email" />
                </Field>
              </div>

              {/* Company + Phone */}
              <div className="grid grid-cols-2 gap-3">
                <Field icon={<Building2 className="h-4 w-4" />} label="Company Name">
                  <input type="text" value={form.company} onChange={upd("company")} className="ys-input w-full h-11 pl-10 pr-4 rounded-xl text-sm" placeholder="YallaStay LLC" />
                </Field>
                <Field icon={<Phone className="h-4 w-4" />} label="Phone">
                  <input type="tel" value={form.phone} onChange={upd("phone")} className="ys-input w-full h-11 pl-10 pr-4 rounded-xl text-sm" placeholder="+971 50 000 0000" />
                </Field>
              </div>

              {/* Password */}
              <Field icon={<Lock className="h-4 w-4" />} label="Password" required>
                <input type={showPassword ? "text" : "password"} value={form.password} onChange={upd("password")} className="ys-input w-full h-11 pl-10 pr-11 rounded-xl text-sm" placeholder="Min. 8 characters" required autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </Field>

              <Field icon={<Lock className="h-4 w-4" />} label="Confirm Password" required>
                <input type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={upd("confirmPassword")} className="ys-input w-full h-11 pl-10 pr-11 rounded-xl text-sm" placeholder="Repeat password" required autoComplete="new-password" />
                <button type="button" onClick={() => setShowConfirm(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </Field>

              {/* Role */}
              <div>
                <label className="block text-sm font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-white/30" />
                  Your Role <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {ROLES.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, role: r.value }))}
                      className={`ys-role flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all ${form.role === r.value ? "ys-role-active" : ""}`}
                      style={{ border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.03)" }}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${form.role === r.value ? "border-teal-400 bg-teal-400" : "border-white/30"}`}>
                        {form.role === r.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white/90 leading-tight">{r.label}</div>
                        <div className="text-[11px] text-white/40 mt-0.5">{r.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-sm rounded-xl px-4 py-3 text-red-300" style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.25)" }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="ys-btn w-full h-12 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2"
                style={{ background:"linear-gradient(135deg,#0d9488,#0f766e)", cursor: loading ? "wait" : "pointer" }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Create Account
              </button>

              <p className="text-center text-xs text-white/25 mt-2">
                By creating an account you agree to our Terms of Service and Privacy Policy.
              </p>
            </form>

            <div className="mt-6 flex justify-center">
              <a href="/yallastay-home/" className="flex items-center gap-1.5 text-teal-400/60 hover:text-teal-400 transition-colors text-xs font-medium">
                <Globe className="h-3.5 w-3.5" />
                Visit YallaStay Website
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ icon, label, required, children }: { icon: React.ReactNode; label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white/70 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30">{icon}</div>
        {children}
      </div>
    </div>
  );
}
