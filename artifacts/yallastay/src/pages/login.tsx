import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Eye, EyeOff, LogIn, Mail, Lock, Shield, Building2, TrendingUp, Star, CheckCircle2, UserPlus } from "lucide-react";
import logoPath from "../assets/cohost-logo.svg";
import { BRAND, PRODUCT_FULL } from "../../../../lib/brand.mjs";
import dubaiSkyline from "../assets/dubai-skyline.png";

const FEATURES = [
  { icon: Building2,    label: "Centralize",  sub: "Everything" },
  { icon: TrendingUp,   label: "Automate",    sub: "Operations" },
  { icon: Star,         label: "Maximize",    sub: "Revenue" },
  { icon: CheckCircle2, label: "Deliver",     sub: "Excellence" },
];

export default function Login() {
  const { login, user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!authLoading && user) setLocation("/dashboard");
  }, [authLoading, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") {
      setSuccessMsg("Account created! Sign in to get started.");
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      setLocation("/dashboard");
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
        .ys-a1 { animation: ys-fadex 0.7s ease both 0.1s; }
        .ys-a2 { animation: ys-fadex 0.7s ease both 0.2s; }
        .ys-a3 { animation: ys-fadex 0.7s ease both 0.35s; }
        .ys-a4 { animation: ys-fadex 0.7s ease both 0.5s; }
        .ys-a5 { animation: ys-fadex 0.7s ease both 0.65s; }
        .ys-r1 { animation: ys-fade  0.7s ease both 0.2s; }
        .ys-r2 { animation: ys-fade  0.7s ease both 0.3s; }
        .ys-r3 { animation: ys-fade  0.7s ease both 0.4s; }
        .ys-btn:hover { transform:translateY(-1px); box-shadow:0 8px 32px rgba(13,148,136,0.45); }
        .ys-btn { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .ys-input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#fff; transition:border-color 0.2s, background 0.2s; }
        .ys-input:focus { background:rgba(255,255,255,0.10); border-color:rgba(45,212,191,0.6); outline:none; }
        .ys-input::placeholder { color:rgba(255,255,255,0.3); }
        .ys-feat:hover { background:rgba(45,212,191,0.1); }
        .ys-feat { transition:background 0.2s; }
        @media (max-width: 767px) { .ys-left { display:none; } .ys-right { width:100vw !important; max-width:100vw !important; border-radius:0 !important; min-height:100dvh; } }
      `}</style>

      <div className="min-h-screen flex overflow-hidden" style={{ background:"#06131a" }}>

        {/* LEFT PANEL — Brand */}
        <div className="ys-left flex-1 relative flex flex-col justify-between p-10 overflow-hidden" style={{ minHeight:"100vh" }}>
          <img src={dubaiSkyline} alt="" className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none" style={{ opacity:0.6 }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background:"linear-gradient(135deg, rgba(4,22,28,0.82) 0%, rgba(6,35,42,0.68) 50%, rgba(4,18,24,0.80) 100%)" }} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none" style={{ background:"linear-gradient(to top, rgba(4,14,18,0.85) 0%, transparent 100%)" }} />

          <div className="relative z-10 flex flex-col h-full">
            <div className="ys-a1 flex items-center gap-3 w-fit">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl blur-2xl" style={{ background:"rgba(13,148,136,0.55)", transform:"scale(1.6)" }} />
                <img src={logoPath} alt={BRAND} className="relative h-44 w-44" style={{ filter:"drop-shadow(0 0 28px rgba(45,212,191,0.8))" }} />
              </div>
              <div>
                <div data-testid="brand-wordmark" className="text-2xl font-extrabold text-white tracking-tight leading-none">Launch<span className="text-teal-400">Riot</span></div>
                <div className="text-[11px] font-semibold text-teal-300/70 tracking-[0.15em] uppercase mt-0.5">for Holiday Homes</div>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center mt-12">
              <div className="ys-a2">
                <h2 className="text-5xl font-black text-white leading-[1.1] tracking-tight">
                  Manage<span className="text-teal-400">.</span><br />
                  Automate<span className="text-teal-400">.</span><br />
                  Grow<span className="text-teal-400">.</span>
                </h2>
                <div className="mt-1 h-0.5 w-12 bg-teal-400 rounded-full" />
              </div>
              <p className="ys-a3 mt-5 text-white/60 text-base leading-relaxed max-w-xs">
                The all-in-one property management platform for modern holiday homes in Dubai.
              </p>
              <div className="ys-a4 mt-8 grid grid-cols-4 gap-3 max-w-xs">
                {FEATURES.map(f => (
                  <div key={f.label} className="ys-feat flex flex-col items-center gap-1.5 p-2 rounded-xl cursor-default">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background:"rgba(13,148,136,0.2)", border:"1px solid rgba(45,212,191,0.25)" }}>
                      <f.icon className="h-5 w-5 text-teal-400" />
                    </div>
                    <span className="text-[10px] font-semibold text-white/60 text-center leading-tight">{f.label}<br />{f.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ys-a5">
              <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full" style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.13)" }}>
                <Shield className="h-4 w-4 text-teal-400 flex-shrink-0" />
                <span className="text-white/70 text-sm">Trusted by property managers across Dubai</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — Login Card */}
        <div className="ys-right flex items-center justify-center p-6 sm:p-8 md:p-10" style={{ width:"480px", flexShrink:0, background:"rgba(8,20,26,0.97)" }}>
          <div className="ys-r1 w-full max-w-[380px]">

            <div className="flex flex-col items-center mb-7 text-center">
              <img src={logoPath} alt={BRAND} className="h-12 w-12 rounded-xl mb-4 block md:hidden" style={{ filter:"drop-shadow(0 0 8px rgba(45,212,191,0.35))" }} />
              <h1 className="text-2xl font-bold text-white">Welcome back</h1>
              <p className="text-white/45 text-sm mt-1">Sign in to {PRODUCT_FULL}</p>
            </div>

            {successMsg && (
              <div className="mb-4 text-sm rounded-xl px-4 py-3 text-emerald-300 flex items-center gap-2" style={{ background:"rgba(16,185,129,0.12)", border:"1px solid rgba(16,185,129,0.25)" }}>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {successMsg}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-white/70 mb-1.5">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="ys-input w-full h-12 pl-10 pr-4 rounded-xl text-sm"
                    placeholder="you@company.com"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-white/70 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="ys-input w-full h-12 pl-10 pr-11 rounded-xl text-sm"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span />
                <a href="forgot-password" onClick={e => { e.preventDefault(); setLocation("/forgot-password"); }} className="text-teal-400 hover:text-teal-300 transition-colors text-xs font-medium">
                  Forgot password?
                </a>
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
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Sign In to {PRODUCT_FULL}
              </button>
            </form>

            <div className="ys-r2 mt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px" style={{ background:"rgba(255,255,255,0.08)" }} />
                <span className="text-white/30 text-xs font-medium">New to {BRAND}?</span>
                <div className="flex-1 h-px" style={{ background:"rgba(255,255,255,0.08)" }} />
              </div>
              <button
                type="button"
                onClick={() => setLocation("/signup")}
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90"
                style={{ background:"rgba(45,212,191,0.1)", border:"1px solid rgba(45,212,191,0.3)", color:"#2dd4bf" }}
              >
                <UserPlus className="h-4 w-4" />
                Create an account
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
