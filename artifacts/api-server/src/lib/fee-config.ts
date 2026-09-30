import { db, propertySettingsTable, propertiesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * The single place the server decides which fee rates apply to a property.
 *
 * Source of truth: the property's fee settings record (property_settings, edited under
 * Accounting → Fee settings). A property without a record uses the same defaults the Fee settings
 * screen shows for it. Rates sent by the browser are never used for booking calculations.
 */
export type PropertyLike = { id: number; city?: string | null; area?: string | null; currency?: string | null };
type Settings = typeof propertySettingsTable.$inferSelect;
type Reader = Pick<typeof db, "select">;

export function defaultFeeSettings(p: PropertyLike) {
  const dubai = /dubai/i.test(p.city || "");
  return {
    id: null as number | null,
    propertyId: p.id,
    tourismRate: "10", tourismEnabled: dubai, vatEnabled: dubai,
    managementFeePercent: "20",
    cleaningFee: null as string | null,
    platformFeeAirbnb: "3", platformFeeBookingCom: "15", platformFeeDirect: "0", platformFeeVrbo: "0",
    ownerSplitPercent: "80", vatPercent: "5",
    includeCleaning: true, includeMaintenance: true,
    currency: p.currency || "AED",
    cleaningCostOverride: null as string | null,
    // The cleaning-company rate card is for Dubai units; elsewhere the property starts with "no rate set".
    cleaningRateCard: /dubai/i.test(`${p.city || ""} ${p.area || ""}`),
    cleaningCostCurrency: null as string | null,
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

// ── Management % and cleaning fee: single source of truth ─────────────────────
// Both live only in property_settings. The property API still accepts/returns them as
// `managementFee` / `cleaningFee` for the existing screens, but reads and writes this record.
type Writer = Pick<typeof db, "select" | "insert" | "update">;

export function parseFeeFields(body: any, forCreate: boolean): { managementFeePercent?: string; cleaningFee?: string | null } {
  const out: { managementFeePercent?: string; cleaningFee?: string | null } = {};
  const m = body?.managementFee;
  if (m !== undefined && m !== null && String(m).trim() !== "") {
    const n = Number(m);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("Management fee must be a percentage between 0 and 100");
    out.managementFeePercent = n.toFixed(2);
  }
  const c = body?.cleaningFee;
  if (c !== undefined) {
    if (c === null || String(c).trim() === "") { if (!forCreate) out.cleaningFee = null; }
    else {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Cleaning fee must be a non-negative amount");
      out.cleaningFee = n.toFixed(2);
    }
  }
  return out;
}

/** Values used for a new property's fee record when none are entered: Settings > Property Defaults, else 20% / none. */
async function newPropertyDefaults(q: Pick<typeof db, "select">) {
  const [row] = await q.select().from(appSettingsTable).where(eq(appSettingsTable.key, "property"));
  const v = (row?.value ?? {}) as { managementFee?: unknown; cleaningFee?: unknown };
  const num = (x: unknown) => (x == null || String(x).trim() === "" ? NaN : Number(x));
  const m = num(v.managementFee), c = num(v.cleaningFee);
  return {
    managementFeePercent: Number.isFinite(m) && m >= 0 && m <= 100 ? m.toFixed(2) : "20.00",
    cleaningFee: Number.isFinite(c) && c >= 0 ? c.toFixed(2) : null,
  };
}

/** Create the property's fee record if it has none (same defaults as before), then apply the given fields. */
export async function saveFeeFields(q: Writer, property: PropertyLike, fields: { managementFeePercent?: string; cleaningFee?: string | null }) {
  const [existing] = await q.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, property.id));
  if (!existing) {
    const d = defaultFeeSettings(property), nd = await newPropertyDefaults(q);
    const [row] = await q.insert(propertySettingsTable).values({
      propertyId: property.id, tourismEnabled: d.tourismEnabled, vatEnabled: d.vatEnabled, currency: d.currency, cleaningRateCard: d.cleaningRateCard,
      managementFeePercent: fields.managementFeePercent ?? nd.managementFeePercent,
      cleaningFee: fields.cleaningFee !== undefined ? fields.cleaningFee : nd.cleaningFee,
    }).returning();
    return row;
  }
  if (!Object.keys(fields).length) return existing;
  const [row] = await q.update(propertySettingsTable).set({ ...fields, updatedAt: new Date() }).where(eq(propertySettingsTable.propertyId, property.id)).returning();
  return row;
}

const plain = (v: string | null | undefined) => v == null ? null : String(Number(v));
/** The `managementFee` / `cleaningFee` fields the property API returns, read from the fee record. */
export function feeFieldsFrom(row: { managementFeePercent?: string | null; cleaningFee?: string | null } | null | undefined) {
  return { managementFee: plain(row?.managementFeePercent ?? "20"), cleaningFee: plain(row?.cleaningFee) };
}
