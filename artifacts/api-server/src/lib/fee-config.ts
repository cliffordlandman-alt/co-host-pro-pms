import { db, propertySettingsTable, propertiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * The single place the server decides which fee rates apply to a property.
 *
 * Source of truth: the property's fee settings record (property_settings, edited under
 * Accounting → Fee settings). A property without a record uses the same defaults the Fee settings
 * screen shows for it. Rates sent by the browser are never used for booking calculations.
 */
export type PropertyLike = { id: number; city?: string | null; currency?: string | null; managementFee?: string | null };
type Settings = typeof propertySettingsTable.$inferSelect;
type Reader = Pick<typeof db, "select">;

export function defaultFeeSettings(p: PropertyLike) {
  const dubai = /dubai/i.test(p.city || "");
  return {
    id: null as number | null,
    propertyId: p.id,
    tourismRate: "10", tourismEnabled: dubai, vatEnabled: dubai,
    managementFeePercent: p.managementFee || "20",
    platformFeeAirbnb: "3", platformFeeBookingCom: "15", platformFeeDirect: "0", platformFeeVrbo: "0",
    ownerSplitPercent: "80", vatPercent: "5",
    includeCleaning: true, includeMaintenance: true,
    currency: p.currency || "AED",
  };
}

export type EffectiveSettings = ReturnType<typeof defaultFeeSettings> | (Settings & { platformFeeVrbo?: string | null });

export function effectiveSettings(p: PropertyLike, row?: Settings | null): EffectiveSettings {
  return row ?? defaultFeeSettings(p);
}

const num = (v: unknown, fallback: number) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

export function channelPercentFor(s: EffectiveSettings, platform: string | null | undefined): number {
  switch (platform) {
    case "airbnb": return num(s.platformFeeAirbnb, 3);
    case "booking_com": return num(s.platformFeeBookingCom, 15);
    case "vrbo": return num((s as any).platformFeeVrbo, 0);
    default: return num(s.platformFeeDirect, 0);
  }
}

/** Rates for a new calculation, taken only from the property's fee settings. */
export function ratesFromSettings(s: EffectiveSettings, platform: string | null | undefined) {
  return {
    managementPercent: num(s.managementFeePercent, 20),
    channelPercent: channelPercentFor(s, platform),
    vatRate: s.vatEnabled ? num(s.vatPercent, 5) : 0,
    tourismEnabled: !!s.tourismEnabled,
    tourismRate: num(s.tourismRate, 10),
  };
}

export async function loadPropertyFeeSettings(q: Reader, propertyId: number) {
  const [property] = await q.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return null;
  const [row] = await q.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, propertyId));
  return { property, settings: effectiveSettings(property, row) };
}
