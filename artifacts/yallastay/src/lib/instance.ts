// Instance-level look and words (server env: INDUSTRY, PRODUCT_NAME, BRAND_COLOR; logo from Settings company.logoUrl).
// Loaded once before the app renders (GET /api/brand, public). Default instance: unchanged holiday-homes wording.
export type Instance = { industry: string; productName: string | null; brandColor: string | null; logoUrl: string | null; workspaceName: string | null; whiteLabel: boolean };
export let INSTANCE: Instance = { industry: "holiday_homes", productName: null, brandColor: null, logoUrl: null, workspaceName: null, whiteLabel: false };
export async function loadInstance() {
  try {
    const r = await fetch(import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/brand"); const b = await r.json();
    INSTANCE = { industry: b.industry || "holiday_homes", productName: b.productName || null, brandColor: b.brandColor || null, logoUrl: b.logoUrl || null, workspaceName: b.workspaceName || null, whiteLabel: !!b.productName };
  } catch { /* defaults */ }
  if (INSTANCE.whiteLabel) {
    document.title = INSTANCE.productName!;
    if (INSTANCE.logoUrl) { const l = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null; if (l) l.href = INSTANCE.logoUrl; }
    if (INSTANCE.brandColor) {
      const hex = INSTANCE.brandColor.slice(1), [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
      const h = !d ? 0 : mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      const hsl = `${Math.round((h + 360) % 360)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
      const st = document.createElement("style"); st.id = "wl-theme";
      st.textContent = `:root, .dark { --primary: ${hsl} !important; --ring: ${hsl} !important; --sidebar-primary: ${hsl} !important; --sidebar-ring: ${hsl} !important; --sidebar: 0 0% 9% !important; --sidebar-border: 0 0% 16% !important; --sidebar-accent: 0 0% 18% !important; }`;
      document.head.appendChild(st);
    }
  }
  return INSTANCE;
}
const EQUIPMENT: Record<string, string> = {
  "Properties": "Customer sites / Machines", "Bookings": "Service jobs", "Guests": "Customers", "Cleaning": "Technician visits",
  "Maintenance": "Repairs & parts", "Owner statements": "Customer statements", "Income per property": "Income per site",
  "Properties & people": "Sites & people", "Owners": "Account holders", "Property calendar": "Site calendar", "Cleaner App": "Technician App",
  "Calendar": "Job calendar", "Verify bookings": "Verify jobs",
};
const EQUIPMENT_HIDE = new Set(["/calendar-sync", "/platforms", "/payout-check", "/airbnb-import", "/compliance", "/inbox", "/reviews", "/templates", "/devices", "/pricing"]);
export const term = (s: string) => INSTANCE.industry === "equipment_service" ? (EQUIPMENT[s] ?? s) : s;
export const hiddenHref = (href: string) => INSTANCE.industry === "equipment_service" && EQUIPMENT_HIDE.has(href.split("?")[0]);

// ---- White-label wording rewriter (equipment service). Only active when INSTANCE.whiteLabel. ----
const WL_RULES: [RegExp, string][] = [
  [/\bHoliday Homes?\b/g, "Service"], [/\bholiday homes?\b/g, "service"], [/\bvacation rentals?\b/gi, "service jobs"], [/\bshort[- ]term rentals?\b/gi, "service work"],
  [/\bAirbnb\s*(?:&|and|\/)\s*Booking\.com\b/g, "external systems"], [/\b(?:Airbnb|Booking\.com|VRBO|Vrbo)\b/g, "external system"],
  [/\bproperty readiness\b/gi, "site readiness"], [/\bProperty readiness\b/g, "Site readiness"],
  [/\bby property\b/g, "by customer site"], [/\bper property\b/g, "per customer site"], [/\bPer property\b/g, "Per customer site"],
  [/\bBookings checking out\b/g, "Service jobs completed"], [/\bbookings? checks? out\b/g, "service jobs complete"],
  [/\bChecking in\b/g, "Starting"], [/\bchecking in\b/g, "starting"], [/\bChecking out\b/g, "Finishing"], [/\bchecking out\b/g, "finishing"],
  [/\bCheck-?ins?\b/g, "Job starts"], [/\bcheck-?ins?\b/g, "job starts"], [/\bCheck-?outs?\b/g, "Job finishes"], [/\bcheck-?outs?\b/g, "job finishes"],
  [/\bCheck in\b/g, "Start"], [/\bcheck in\b/g, "start"], [/\bCheck out\b/g, "Finish"], [/\bcheck out\b/g, "finish"],
  [/\bArrivals?\b/g, "Job starts"], [/\barrivals?\b/g, "job starts"], [/\bDepartures?\b/g, "Job finishes"], [/\bdepartures?\b/g, "job finishes"],
  [/\bnights\b/g, "days"], [/\bNights\b/g, "Days"], [/\bnight\b/g, "day"], [/\bNight\b/g, "Day"], [/\bstays\b/g, "service jobs"], [/\bStays\b/g, "Service jobs"], [/\bstay\b/g, "service job"], [/\bStay\b/g, "Service job"],
  [/\bReservations\b/g, "Service jobs"], [/\breservations\b/g, "service jobs"], [/\bReservation\b/g, "Service job"], [/\breservation\b/g, "service job"],
  [/\bBookings\b/g, "Service jobs"], [/\bbookings\b/g, "service jobs"], [/\bBooking\b/g, "Service job"], [/\bbooking\b/g, "service job"],
  [/\bGuests\b/g, "Customers"], [/\bguests\b/g, "customers"], [/\bGuest\b/g, "Customer"], [/\bguest\b/g, "customer"],
  [/\bHousekeeping\b/g, "Technician visits"], [/\bhousekeeping\b/g, "technician visits"], [/\bCleanings\b/g, "Technician visits"], [/\bcleanings\b/g, "technician visits"],
  [/\bCleaning\b/g, "Technician visit"], [/\bcleaning\b/g, "technician visit"], [/\bCleaners\b/g, "Technicians"], [/\bcleaners\b/g, "technicians"], [/\bCleaner\b/g, "Technician"], [/\bcleaner\b/g, "technician"],
  [/\bMaintenance\b/g, "Repairs & parts"], [/\bmaintenance\b/g, "repairs"],
  [/\bOwner statements?\b/g, "Customer statements"], [/\bowner statements?\b/g, "customer statements"], [/\bOwner payouts?\b/g, "Customer settlements"], [/\bowner payouts?\b/g, "customer settlements"],
  [/\bOwners\b/g, "Account holders"], [/\bowners\b/g, "account holders"], [/\bOwner\b/g, "Account holder"], [/\bowner\b/g, "account holder"],
  [/\bApartments\b/g, "Machines"], [/\bapartments\b/g, "machines"], [/\bApartment\b/g, "Machine"], [/\bapartment\b/g, "machine"], [/\bUnits\b/g, "Machines"], [/\bunits\b/g, "machines"],
  [/\bProperties\b/g, "Customer sites"], [/\bproperties\b/g, "customer sites"], [/\bProperty\b/g, "Customer site"], [/\bproperty\b/g, "customer site"],
  [/\bAmenities\b/g, "Parts"], [/\bamenities\b/g, "parts"], [/\bLinens?\b/g, "Parts"], [/\blinens?\b/g, "parts"],
  [/\bOccupancy\b/g, "Utilisation"], [/\boccupancy\b/g, "utilisation"], [/\bOccupied\b/g, "In service"], [/\bVacant\b/g, "Idle"],
  [/\bAll Platforms\b/g, "All sources"], [/\bPlatforms\b/g, "Sources"], [/\bplatforms\b/g, "sources"], [/\bPlatform\b/g, "Source"], [/\bplatform\b/g, "source"], [/\bTourism Dirham\b/g, "Tax"], [/\bPassport\/ID\b/g, "Customer PO"], [/\bID PENDING\b/g, "PO PENDING"], [/\bchannel amount\b/gi, "job amount"], [/\bChannels?\b/g, "Integrations"], [/\bchannels?\b/g, "integrations"], [/\bRERA\/DET\b/g, "trade"], [/\bDTCM\b/g, "trade"], [/\bhosts?\b/g, "service teams"], [/\bHosts?\b/g, "Service teams"], [/\bCo-hosts?\b/gi, "Partners"],
];
export function wlText(s: string): string { let o = s; for (const [r, t] of WL_RULES) o = o.replace(r, t); return o; }
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);
function fix(node: Node) {
  if (node.nodeType === 3) { const p = node.parentElement; if (!p || SKIP.has(p.tagName) || p.isContentEditable || p.closest("[data-wl-keep]")) return; const v = node.nodeValue || ""; if (/[A-Za-z]/.test(v)) { const n = wlText(v); if (n !== v) node.nodeValue = n; } return; }
  if (node.nodeType !== 1) return; const el = node as Element; if (SKIP.has(el.tagName) && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
  for (const a of ["placeholder", "title", "aria-label"]) { const v = el.getAttribute(a); if (v) { const n = wlText(v); if (n !== v) el.setAttribute(a, n); } }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
  el.childNodes.forEach(fix);
}
export function startWlRewriter() {
  if (!INSTANCE.whiteLabel || typeof MutationObserver === "undefined") return;
  const run = () => { fix(document.body); new MutationObserver(ms => { for (const m of ms) { if (m.type === "characterData") fix(m.target); else if (m.type === "attributes") fix(m.target); else m.addedNodes.forEach(fix); } }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] }); };
  if (document.body) run(); else document.addEventListener("DOMContentLoaded", run);
}
