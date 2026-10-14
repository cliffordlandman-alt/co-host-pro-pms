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
    if (INSTANCE.brandColor) document.documentElement.style.setProperty("--wl-brand", INSTANCE.brandColor);
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
