import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, ArrowLeft, CheckCircle2, Shield } from "lucide-react";
import logoPath from "../assets/yallastay-logo.png";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    setLoading(false);
    setSent(true);
  }

  return (
    <>
      <style>{`
        @keyframes ys-fade { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .ys-r1 { animation: ys-fade 0.6s ease both 0.1s; }
        .ys-btn:hover { transform:translateY(-1px); box-shadow:0 8px 32px rgba(13,148,136,0.45); }
        .ys-btn { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .ys-input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#fff; transition:border-color 0.2s, background 0.2s; }
        .ys-input:focus { background:rgba(255,255,255,0.10); border-color:rgba(45,212,191,0.6); outline:none; }
        .ys-input::placeholder { color:rgba(255,255,255,0.3); }
      `}</style>

      <div className="min-h-screen flex items-center justify-center p-6" style={{ background:"#06131a" }}>
        <div className="ys-r1 w-full max-w-[400px]">

          <div className="flex flex-col items-center mb-8 text-center">
            <img src={logoPath} alt="YallaStay" className="h-14 w-14 mb-4" style={{ filter:"drop-shadow(0 0 12px rgba(45,212,191,0.5))" }} />
            <div className="text-xl font-extrabold text-white">Yalla<span className="text-teal-400">Stay</span></div>
            <div className="text-[10px] text-teal-300/60 tracking-[0.15em] uppercase mt-0.5">Property Management</div>
          </div>

          <div className="rounded-2xl p-8" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)" }}>
            {!sent ? (
              <>
                <div className="mb-6 text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background:"rgba(13,148,136,0.2)", border:"1px solid rgba(45,212,191,0.3)" }}>
                    <Mail className="h-6 w-6 text-teal-400" />
                  </div>
                  <h1 className="text-xl font-bold text-white">Reset your password</h1>
                  <p className="text-white/45 text-sm mt-1.5">Contact your administrator to restore account access.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                        autoFocus
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="ys-btn w-full h-12 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2"
                    style={{ background:"linear-gradient(135deg,#0d9488,#0f766e)", cursor: loading ? "wait" : "pointer" }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Show recovery instructions
                  </button>
                </form>
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background:"rgba(13,148,136,0.2)", border:"1px solid rgba(45,212,191,0.4)" }}>
                  <CheckCircle2 className="h-8 w-8 text-teal-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Contact your administrator</h2>
                  <p className="text-white/45 text-sm mt-2 leading-relaxed">
                    Ask your administrator to reset access for <span className="text-teal-400 font-medium">{email}</span>. No email has been sent.
                    
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-center text-xs text-white/30 mt-2">
                  <Shield className="h-3.5 w-3.5 text-teal-400/50" />
                  <span>The link expires in 1 hour for security.</span>
                </div>
              </div>
            )}

            <button
              onClick={() => setLocation("/login")}
              className="w-full mt-5 flex items-center justify-center gap-2 text-teal-400/60 hover:text-teal-400 transition-colors text-sm font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
