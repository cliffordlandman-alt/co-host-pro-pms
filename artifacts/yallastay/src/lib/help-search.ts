// Help assistant search: local only (no external AI). Matches screens, properties, bookings (guest name or
// booking reference), owners, reports and a few quick "how do I" answers, from data the app already loaded.

export type HelpResult = { id: string; type: string; title: string; detail?: string; href: string; answer?: string };
type Screen = { href: string; label: string; keywords?: string; role?: string[] };

const FIN = ["admin", "super_admin", "manager", "accountant"];
/** Every screen in the menu (scripts/test-help-assistant.mjs checks this list against the sidebar). */
export const SCREENS: Screen[] = [
  { href: "/dashboard", label: "Today", keywords: "home dashboard overview arrivals departures" },
  { href: "/multi-calendar", label: "Calendar", keywords: "availability all properties" },
  { href: "/reservations", label: "Bookings", keywords: "reservations stays guests" },
  { href: "/verify-bookings", label: "Verify bookings", keywords: "not verified unverified guest total breakdown" },
  { href: "/cleaning", label: "Cleaning", keywords: "cleaner turnover" },
  { href: "/maintenance", label: "Maintenance", keywords: "repairs tickets" },
  { href: "/task-centre", label: "Task Centre", keywords: "tasks to do" },
  { href: "/income", label: "Income per property", keywords: "revenue report occupancy" },
  { href: "/accounting", label: "Owner statements", keywords: "statement owner payout report" },
  { href: "/owner-history", label: "Statement history", keywords: "past statements report" },
  { href: "/accounting?tab=transactions", label: "Income & expenses", keywords: "transactions expense entry add" },
  { href: "/payments", label: "Payments", keywords: "guest payments" },
  { href: "/payout-check", label: "Airbnb payout check", keywords: "payouts reconcile", role: FIN },
  { href: "/finance-inputs", label: "Finance inputs", keywords: "workbook export deposits leases bank balance", role: FIN },
  { href: "/reports", label: "Reports", keywords: "report analytics" },
  { href: "/properties", label: "Properties", keywords: "units listings" },
  { href: "/owners", label: "Owners", keywords: "landlords" },
  { href: "/guests", label: "Guests", keywords: "guest contacts id" },
  { href: "/staff", label: "Staff", keywords: "team users" },
  { href: "/platforms", label: "Platforms", keywords: "channels airbnb booking.com" },
  { href: "/calendar-sync", label: "Calendar sync", keywords: "ical sync", role: ["admin", "super_admin", "manager"] },
  { href: "/compliance", label: "Dubai compliance", keywords: "dtcm tourism dirham vat permit", role: [...FIN, "reservations", "operations"] },
  { href: "/calendar", label: "Property calendar", keywords: "calendar" },
  { href: "/inbox", label: "Inbox", keywords: "messages" },
  { href: "/reviews", label: "Reviews", keywords: "ratings" },
  { href: "/accounting?tab=settings", label: "Fee settings", keywords: "management fee commission cleaning fee currency" },
  { href: "/accounting?tab=company", label: "Company statement", keywords: "company month profit report" },
  { href: "/accounting?tab=airbnb", label: "Airbnb payouts", keywords: "payout airbnb transfers" },
  { href: "/airbnb-import", label: "Import Airbnb data", keywords: "earnings csv import reservation breakdown" },
  { href: "/documents", label: "Documents", keywords: "files" },
  { href: "/devices", label: "Devices", keywords: "locks tv" },
  { href: "/automations", label: "Automations", keywords: "rules" },
  { href: "/templates", label: "Templates", keywords: "message templates" },
  { href: "/ai-assistant", label: "AI Assistant", keywords: "assistant" },
  { href: "/cleaner-app", label: "Cleaner App", keywords: "cleaner", role: ["cleaner", "admin", "manager"] },
  { href: "/subscriptions", label: "Subscriptions", keywords: "plan billing", role: ["super_admin"] },
  { href: "/audit-log", label: "Activity Log", keywords: "audit history", role: ["super_admin"] },
  { href: "/system-health", label: "System Health", keywords: "health status", role: ["super_admin"] },
];

export const REPORTS: Screen[] = [
  { href: "/finance-inputs", label: "YALLA workbook (monthly export)", keywords: "excel xlsx export download", role: FIN },
  { href: "/income", label: "Income per property report", keywords: "revenue occupancy" },
  { href: "/accounting?tab=company", label: "Company month report", keywords: "profit summary" },
  { href: "/owner-history", label: "Owner statement history", keywords: "statements" },
  { href: "/payout-check", label: "Airbnb payout check report", keywords: "reconcile payouts", role: FIN },
  { href: "/compliance", label: "Dubai compliance report", keywords: "tourism dirham vat dtcm" },
];

export const QUICK_ANSWERS: HelpResult[] = [
  { id: "qa-workbook", type: "Quick answer", title: "Export the YALLA workbook", href: "/finance-inputs", detail: "workbook excel export download monthly yalla xlsx",
    answer: "Finance inputs → Monthly export: pick the month, then “Download YALLA workbook” (or “Full export from April” for every row)." },
  { id: "qa-expense", type: "Quick answer", title: "Enter an expense", href: "/accounting?tab=transactions", detail: "expense cost add entry income bill receipt",
    answer: "Income & expenses → “Add income / expense”: date, category, property, amount and treatment. “Workbook description” and “Workbook order” are optional." },
  { id: "qa-bank", type: "Quick answer", title: "Set the bank balance", href: "/finance-inputs?tab=bank", detail: "bank balance adib closing latest",
    answer: "Finance inputs → Bank balance: enter the month-end closing balance from the statement, or the latest balance with its date, then save." },
  { id: "qa-payouts", type: "Quick answer", title: "Airbnb payouts", href: "/accounting?tab=airbnb", detail: "airbnb payout transfers import earnings csv check",
    answer: "Owner statements → Airbnb payouts lists the payouts. Import new files under “Import Airbnb data” and match them under “Airbnb payout check”." },
  { id: "qa-verify", type: "Quick answer", title: "Booking says “not verified”", href: "/verify-bookings", detail: "not verified unverified guest total breakdown verify",
    answer: "The guest-paid total and fees aren’t recorded yet. Import Airbnb’s reservation breakdown or type the totals under Verify bookings." },
];

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const allowed = (s: Screen, role?: string) => !s.role || role === "super_admin" || s.role.includes(role ?? "");

export type HelpData = { properties?: any[]; bookings?: any[]; owners?: any[]; statements?: any[]; role?: string };

/** All candidates for the current user. */
export function helpIndex(d: HelpData): HelpResult[] {
  const pname = (id: number) => d.properties?.find(p => p.id === id)?.name ?? "";
  const oname = (id: number) => d.owners?.find(o => o.id === id)?.name ?? "";
  return [
    ...QUICK_ANSWERS,
    ...SCREENS.filter(s => allowed(s, d.role)).map(s => ({ id: `s:${s.href}`, type: "Screen", title: s.label, detail: s.keywords, href: s.href })),
    ...REPORTS.filter(s => allowed(s, d.role)).map(s => ({ id: `r:${s.href}:${s.label}`, type: "Report", title: s.label, detail: s.keywords, href: s.href })),
    ...(d.properties ?? []).map(p => ({ id: `p${p.id}`, type: "Property", title: p.name, detail: [p.reportName, p.unitNumber, p.city].filter(Boolean).join(" · "), href: `/properties?property=${p.id}` })),
    ...(d.bookings ?? []).map(b => ({ id: `b${b.id}`, type: "Booking", title: b.guestName || "Booking",
      detail: [String(b.externalId ?? "").replace(/^[a-z_]+:/, ""), b.propertyName || pname(b.propertyId), `${b.checkIn} → ${b.checkOut}`].filter(Boolean).join(" · "), href: `/reservations/${b.id}` })),
    ...(d.owners ?? []).map(o => ({ id: `o${o.id}`, type: "Owner", title: o.name, detail: [o.email, o.phone].filter(Boolean).join(" · "), href: `/owners?owner=${o.id}` })),
    ...(d.statements ?? []).map(s => ({ id: `st${s.id}`, type: "Report", title: `Owner statement ${s.month}`, detail: [oname(s.ownerId) || s.ownerName, s.propertyName || pname(s.propertyId), s.status].filter(Boolean).join(" · "), href: "/accounting" })),
  ];
}

/** Every word of the query must appear in the title or detail; title matches rank first. */
export function helpSearch(index: HelpResult[], query: string, limit = 12): HelpResult[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return index.filter(r => r.type === "Quick answer");
  const scored: { r: HelpResult; score: number }[] = [];
  for (const r of index) {
    const title = norm(r.title), hay = `${title} ${norm(r.detail)} ${norm(r.type)}`;
    if (!words.every(w => hay.includes(w))) continue;
    const q = words.join(" ");
    const score = (title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : 3) + (r.type === "Quick answer" ? -0.5 : 0);
    scored.push({ r, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(x => x.r);
}

export type BubblePos = { right: number; bottom: number; minimised: boolean };
export const DEFAULT_POS: BubblePos = { right: 16, bottom: 96, minimised: false };
/** Keeps the bubble on screen (a margin from every edge). */
export function clampPos(p: BubblePos, w: number, h: number, size = 48): BubblePos {
  const c = (v: number, max: number) => Math.round(Math.min(Math.max(Number.isFinite(v) ? v : 16, 8), Math.max(8, max)));
  return { ...p, right: c(p.right, w - size - 8), bottom: c(p.bottom, h - size - 8) };
}
export function readPos(raw: string | null): BubblePos {
  try { const v = JSON.parse(raw ?? ""); if (v && typeof v === "object") return { ...DEFAULT_POS, ...v, minimised: !!v.minimised }; } catch { /* default */ }
  return { ...DEFAULT_POS };
}
