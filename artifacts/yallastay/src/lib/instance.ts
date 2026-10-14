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
