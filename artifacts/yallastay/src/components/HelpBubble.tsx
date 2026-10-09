import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, X, Minus, HelpCircle, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { usePMSData } from "@/hooks/use-today-data";
import { helpIndex, helpSearch, clampPos, readPos, type BubblePos, type HelpResult } from "@/lib/help-search";

// Floating "What are you looking for?" helper: small, draggable (position remembered), minimisable, bounces
// gently (not under prefers-reduced-motion), and searches only data already in the app (no external calls).
const KEY = "helpBubble.v1";
const OPS = ["cleaner", "maintenance", "owner"];

export function HelpBubble() {
  const { user } = useAuth();
  const [, go] = useLocation();
  const [pos, setPos] = useState<BubblePos>(() => clampPos(readPos(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY)), window.innerWidth, window.innerHeight));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const role = user?.role ?? "";
  const operator = !!user && !OPS.includes(role);
  const financial = ["admin", "super_admin", "manager", "accountant"].includes(role);
  const properties = usePMSData("properties", open && operator), bookings = usePMSData("reservations", open && operator);
  const owners = usePMSData("owners", open && financial), statements = usePMSData("accounting/statements", open && financial);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* private mode */ } }, [pos]);
  useEffect(() => { const r = () => setPos(p => clampPos(p, window.innerWidth, window.innerHeight)); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);

  const index = useMemo(() => helpIndex({ properties: properties.data as any[], bookings: bookings.data as any[], owners: owners.data as any[], statements: statements.data as any[], role }),
    [properties.data, bookings.data, owners.data, statements.data, role]);
  const results = useMemo(() => helpSearch(index, q), [index, q]);
  useEffect(() => setSel(0), [q]);

  if (!user || role === "owner") return null;

  const pick = (r: HelpResult) => { setOpen(false); setQ(""); go(r.href); };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setPos(p => clampPos({ ...p, right: d.right - dx, bottom: d.bottom - dy }, window.innerWidth, window.innerHeight));
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d && !d.moved) setOpen(o => !o); };
  const upper = pos.bottom > window.innerHeight / 2;
  const panelStyle: React.CSSProperties = { right: Math.min(pos.right, Math.max(8, window.innerWidth - 368)), ...(upper ? { top: window.innerHeight - pos.bottom + 8 } : { bottom: pos.bottom + 56 }) };

  return (
    <>
      <div data-testid="help-bubble" className="fixed z-40 select-none" style={{ right: pos.right, bottom: pos.bottom }}>
        <div className={`flex items-center gap-1 ${open || pos.minimised ? "" : "help-bubble-bounce"}`}>
          <button type="button" aria-label="What are you looking for? Open search help" aria-expanded={open}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
            className={`touch-none cursor-grab active:cursor-grabbing flex items-center gap-1.5 rounded-full border bg-card/95 shadow-md text-xs text-foreground hover:shadow-lg transition-shadow ${pos.minimised ? "h-9 w-9 justify-center opacity-70 hover:opacity-100" : "h-9 pl-2.5 pr-3"}`}>
            <HelpCircle className="h-4 w-4 text-primary shrink-0" />
            {!pos.minimised && <span className="whitespace-nowrap">What are you looking for?</span>}
          </button>
          {!pos.minimised && !open && <button type="button" aria-label="Minimise help" title="Minimise" onClick={() => setPos(p => ({ ...p, minimised: true }))}
            className="h-5 w-5 rounded-full border bg-card/95 text-muted-foreground flex items-center justify-center shadow-sm hover:text-foreground"><Minus className="h-3 w-3" /></button>}
        </div>
      </div>
      {open && (
        <div role="dialog" aria-label="Search help" data-testid="help-panel" className="fixed z-50 w-[min(360px,calc(100vw-16px))] rounded-xl border bg-card shadow-xl" style={panelStyle}>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Screen, property, guest, booking ref, owner…" aria-label="Search"
              onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); } else if (e.key === "Enter" && results[sel]) pick(results[sel]); }}
              className="flex-1 bg-transparent text-sm outline-none min-w-0" />
            {pos.minimised
              ? <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setPos(p => ({ ...p, minimised: false }))}>Expand</button>
              : <button type="button" aria-label="Minimise help" title="Minimise" onClick={() => { setPos(p => ({ ...p, minimised: true })); setOpen(false); }} className="text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /></button>}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <ul className="max-h-[min(60vh,420px)] overflow-auto p-1">
            {!q.trim() && <li className="px-2 pt-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Quick answers</li>}
            {results.map((r, i) => (
              <li key={r.id}>
                <button type="button" onMouseEnter={() => setSel(i)} onClick={() => pick(r)} className={`w-full text-left rounded-lg px-2 py-1.5 text-sm ${i === sel ? "bg-muted" : ""}`}>
                  <span className="flex items-center gap-2"><span className="text-[10px] uppercase tracking-wide text-muted-foreground w-20 shrink-0">{r.type}</span><span className="font-medium truncate flex-1">{r.title}</span><ArrowUpRight className="h-3 w-3 text-muted-foreground shrink-0" /></span>
                  {r.answer ? <span className="block pl-[5.5rem] text-xs text-muted-foreground">{r.answer}</span> : r.detail && r.type !== "Screen" && r.type !== "Report" ? <span className="block pl-[5.5rem] text-xs text-muted-foreground truncate">{r.detail}</span> : null}
                </button>
              </li>
            ))}
            {q.trim() && !results.length && <li className="px-2 py-3 text-sm text-muted-foreground">Nothing found for “{q}”. Try a guest name, booking reference, property or screen.</li>}
          </ul>
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Searches this app only. Drag the bubble to move it.</p>
        </div>
      )}
    </>
  );
}
