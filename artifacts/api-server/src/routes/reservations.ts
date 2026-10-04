import { reservationFinancials, financialTotals } from "../../../../lib/reservation-financials.mjs";
import { pageParams, paged, likeTerm } from "../lib/paging";
import { dubaiToday } from "../lib/dubai-date";
import { airbnbEarningsTable, airbnbBookingPayoutsTable } from "@workspace/db";
import { bedroomCount, bookingFinance } from "../../../../lib/booking-finance.mjs";
import { loadPropertyFeeSettings, ratesFromSettings } from "../lib/fee-config";
import { parseBreakdowns, payoutComparison } from "../lib/airbnb-breakdowns.mjs";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, insertReservationSchema, cleaningTasksTable, propertySettingsTable, ownerStatementsTable, paymentsTable, ownersTable } from "@workspace/db";
import { eq, and, ne, lt, gt, gte, lte, inArray, notInArray, or, ilike, sql, desc, isNull } from "drizzle-orm";
import { insertAuditLog } from "../lib/audit";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";

const router = Router();

// ─── Shared column selection (identical for list and detail) ──────────────────

const reservationSelect = {
  externalId: reservationsTable.externalId,
  // The booking's own currency when stamped (its property's currency changed later), else the property's.
  currency: sql<string | null>`coalesce(${reservationsTable.currency}, ${propertiesTable.currency})`,
  guestEmail: reservationsTable.guestEmail,
  guestPhone: reservationsTable.guestPhone,
  idCollected: reservationsTable.idCollected,
  channelPercent: reservationsTable.channelPercent,
  channelAmount: reservationsTable.channelAmount,
  tourismRate: reservationsTable.tourismRate,
  id: reservationsTable.id,
  guestName: reservationsTable.guestName,
  platform: reservationsTable.platform,
  propertyId: reservationsTable.propertyId,
  propertyName: propertiesTable.name,
  checkIn: reservationsTable.checkIn,
  checkOut: reservationsTable.checkOut,
  nights: reservationsTable.nights,
  revenue: reservationsTable.revenue,
  grossAmount: reservationsTable.grossAmount,
  managementPercent: reservationsTable.managementPercent,
  managementAmount: reservationsTable.managementAmount,
  tourismFee: reservationsTable.tourismFee,
  tourismRooms: reservationsTable.tourismRooms,
  tourismNights: reservationsTable.tourismNights,
  vatAmount: reservationsTable.vatAmount,
  vatRate: reservationsTable.vatRate,
  ownerAmount: reservationsTable.ownerAmount,
  financeMode: reservationsTable.financeMode,

  cleaningFee: reservationsTable.cleaningFee,
  cohostPayout: reservationsTable.cohostPayout,
  channelFees: reservationsTable.channelFees,
  airbnbPayout: reservationsTable.airbnbPayout,
  feeBasis: reservationsTable.feeBasis,
  balanceDue: reservationsTable.balanceDue,
  paymentStatus: reservationsTable.paymentStatus,
  notes: reservationsTable.notes,
  status: reservationsTable.status,
  createdAt: reservationsTable.createdAt,
} as const;

function formatReservation(r: {
  revenue: string | null;
  cleaningFee: string | null;
  balanceDue: string | null;
  createdAt: Date;
  [key: string]: unknown;
}, earnings: any[] = []) {
  return {
    financials: reservationFinancials(r,earnings),
    ...r,
    ...Object.fromEntries(["channelPercent", "channelAmount", "tourismRate", "grossAmount", "managementPercent", "managementAmount", "tourismFee", "vatAmount", "vatRate", "ownerAmount"].map(key => [key, r[key] == null ? null : Number(r[key])])),
    revenue: parseFloat(r.revenue || "0"),
    cleaningFee: r.cleaningFee != null ? parseFloat(r.cleaningFee) : null,
    cohostPayout: r.cohostPayout != null ? parseFloat(String(r.cohostPayout)) : null,
    channelFees: r.channelFees != null ? parseFloat(String(r.channelFees)) : null,
    airbnbPayout: r.airbnbPayout != null ? parseFloat(String(r.airbnbPayout)) : null,
    balanceDue: r.balanceDue != null ? parseFloat(r.balanceDue) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// Rates and derived amounts are decided by the server, never taken from the browser.
const SERVER_FINANCE_FIELDS = ["managementPercent", "managementAmount", "channelPercent", "channelAmount", "vatRate", "vatAmount", "tourismRate", "tourismFee", "tourismNights", "ownerAmount", "dubaiCharges", "feeBasis"];

/**
 * Builds the booking's financial snapshot.
 * - New calculation (new booking, first verification, property change, or refreshRates): rates come
 *   from the property's fee settings (lib/fee-config.ts).
 * - Editing an already verified booking: the rates snapshotted on that booking are kept, so a later
 *   change to the property's fee settings never rewrites past bookings.
 * The calculation itself (lib/booking-finance.mjs) is unchanged.
 */
async function prepareFinance(body: any, existing?: any) {
  const refreshRates = body.refreshRates === true;
  const tourismRoomsHint = body.tourismRooms;
  // The channel commission this booking actually carried (e.g. from the Airbnb or Booking.com statement),
  // as a percentage. Optional; otherwise the property's fee settings decide. Same calculation either way.
  const commission = body.channelCommissionPercent;
  if (commission !== undefined && commission !== null && commission !== "" && !/^\d+(\.\d{1,2})?$/.test(String(commission))) throw new Error("Enter the channel commission as a percentage with up to two decimals");
  const clean: any = { ...body };
  // The booking's currency is never taken from the browser: it is the property's, or the one stamped on it
  // when the property's currency changed (lib/property-currency.ts).
  for (const f of [...SERVER_FINANCE_FIELDS, "refreshRates", "tourismRooms", "channelCommissionPercent", "currency"]) delete clean[f];
  const input: any = { ...(existing ?? {}), ...clean };
  if (input.financeMode !== "inclusive-v1") return input;
  const loaded = await loadPropertyFeeSettings(db, Number(input.propertyId));
  if (!loaded) throw new Error("Choose an existing property");
  const { property, settings } = loaded;
  for (const field of ["checkIn", "checkOut"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input[field]) || new Date(input[field]).toISOString().slice(0,10) !== input[field]) throw new Error("Enter valid booking dates");
  }
  const nights = (Date.parse(input.checkOut)-Date.parse(input.checkIn))/86400000;
  // Fee basis: the property's current one. A verified booking calculated on another basis is recalculated with
  // the property's current rates the next time it is saved (until then its month's statement is blocked).
  const basis = settings.feeBasis === "net-payout" || settings.feeBasis === "airbnb-payout" ? settings.feeBasis : null;
  const keepSnapshot = !refreshRates && existing?.financeMode === "inclusive-v1" && Number(existing.propertyId) === Number(input.propertyId) && existing.managementPercent != null && (existing.feeBasis ?? null) === basis;
  const current = ratesFromSettings(settings, input.platform);
  const rates = keepSnapshot ? {
    managementPercent: Number(existing.managementPercent),
    channelPercent: existing.platform === input.platform && existing.channelPercent != null ? Number(existing.channelPercent) : current.channelPercent,
    vatRate: Number(existing.vatRate ?? 0),
    tourismEnabled: Number(existing.tourismRooms) > 0,
    tourismRate: Number(existing.tourismRate ?? current.tourismRate),
  } : current;
  if (commission !== undefined && commission !== null && commission !== "") rates.channelPercent = Number(commission);
  // Cleaning fee: the amount entered for this booking, else the booking's saved snapshot, else the
  // property's cleaning fee from its fee settings (the single source), snapshotted onto the booking.
  if (clean.cleaningFee === undefined || clean.cleaningFee === null || clean.cleaningFee === "") {
    const propertyCurrency = property.currency || settings.currency || "AED";
    // The cleaning fee setting is in the property's current currency: never apply it to a booking kept in another one.
    if (existing?.cleaningFee == null && settings.cleaningFee != null && existing?.currency && existing.currency !== propertyCurrency)
      throw new Error(`This booking is in ${existing.currency} but the property's cleaning fee setting is in ${propertyCurrency}: enter the booking's cleaning fee in ${existing.currency}`);
    input.cleaningFee = existing?.cleaningFee ?? settings.cleaningFee ?? 0;
  }
  // A direct booking has no channel, so no channel fees (a fact, not a percentage fallback).
  if (basis && (input.channelFees == null || input.channelFees === "") && (input.platform ?? "direct") === "direct") input.channelFees = "0";
  // Airbnb payout basis: a direct booking has no channel, so what the guest paid is what was received.
  if (basis === "airbnb-payout" && (input.airbnbPayout == null || input.airbnbPayout === "") && (input.platform ?? "direct") === "direct") input.airbnbPayout = input.grossAmount;
  const rooms = bedroomCount(property) ?? Number(tourismRoomsHint ?? existing?.tourismRooms);
  const finance = bookingFinance({total: input.grossAmount, managementPercent: rates.managementPercent,
    cleaningFee: input.cleaningFee ?? 0, nights, rooms, dubai: rates.tourismEnabled,
    vatRate: rates.vatRate, tourismRate: rates.tourismRate, tourismEnabled: rates.tourismEnabled,
    channelPercent: rates.channelPercent,
    feeBasis: basis ?? "gross", channelFees: input.channelFees ?? null, payout: input.airbnbPayout ?? null,
    // Always the property's current "Include cleaning costs" setting, so the booking's owner amount and
    // the owner statement agree (the statement applies the same setting).
    deductCleaning: settings.includeCleaning !== false});
  const { netPayout: _netPayout, rounding: _rounding, ...stored } = finance as any;
  const result = {...input, ...stored, nights};
  for (const field of ["airbnbPayout", "channelFees", "channelPercent", "channelAmount", "tourismRate", "revenue", "grossAmount", "managementPercent", "managementAmount", "tourismFee", "vatAmount", "vatRate", "ownerAmount", "cleaningFee", "balanceDue"]) {
    if (result[field] != null) result[field] = String(result[field]);
  }
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/reservations", asyncHandler(async (req, res) => {
  const { propertyId, status, platform, paymentStatus, q } = req.query as { propertyId?: string; status?: string; platform?: string; paymentStatus?: string; q?: string };

  const conditions = [];
  if (propertyId) conditions.push(eq(reservationsTable.propertyId, parseInt(propertyId)));
  if (status) conditions.push(eq(reservationsTable.status, status));
  const p = pageParams(req.query as Record<string, unknown>);
  if (p) {
    if (platform) conditions.push(eq(reservationsTable.platform, platform));
    if (paymentStatus) conditions.push(eq(reservationsTable.paymentStatus, paymentStatus));
    if (q?.trim()) { const t = likeTerm(q.trim()); conditions.push(or(ilike(reservationsTable.guestName, t), ilike(propertiesTable.name, t), ilike(reservationsTable.externalId, t))!); }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    // Summary over the whole filtered set: counts in SQL; verified money totals with the same rules the
    // screens use (reservation-financials), over every matching booking, not only this page.
    const [agg] = await db.select({
      total: sql<number>`count(*)::int`,
      pendingPayments: sql<number>`count(*) filter (where ${reservationsTable.paymentStatus} in ('pending','partial'))::int`,
      platforms: sql<number>`count(distinct ${reservationsTable.platform})::int`,
    }).from(reservationsTable).leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id)).where(where);
    const all = await db.select(reservationSelect).from(reservationsTable).leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id)).where(where);
    const allCodes = [...new Set(all.map(r => r.externalId).filter((x): x is string => !!x && x.startsWith("airbnb:")).map(x => x.slice(7)))];
    const allEarnings = allCodes.length ? await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode, allCodes)) : [];
    const formatted = all.map(r => formatReservation(r, allEarnings));
    const finance = financialTotals(formatted);
    const byId = new Map(all.map((r, i) => [r.id, formatted[i]]));
    const pageRows = await db.select({ id: reservationsTable.id }).from(reservationsTable).leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id)).where(where)
      .orderBy(desc(reservationsTable.checkIn), desc(reservationsTable.id)).limit(p.pageSize).offset(p.offset);
    return res.json(paged(pageRows.map(r => byId.get(r.id)), agg.total, p, { total: agg.total, pendingPayments: agg.pendingPayments, platforms: agg.platforms, finance }));
  }

  const rows = await db
    .select(reservationSelect)
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(reservationsTable.checkIn);

  // Only load the Airbnb earnings that belong to the listed bookings (not the whole earnings table on every request).
  const codes=[...new Set(rows.map(r=>r.externalId).filter((x):x is string=>!!x&&x.startsWith("airbnb:")).map(x=>x.slice(7)))];
  const earnings=codes.length?await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode,codes)):[];
  res.json(rows.map(r=>formatReservation(r,earnings)));
}));

// Rates the server will apply to a new calculation for this property and channel (read-only preview
// for the booking forms; available to anyone who can create reservations).
router.get("/reservations/rates", asyncHandler(async (req, res) => {
  const propertyId = parseId(String(req.query.propertyId ?? ""));
  if (propertyId === null) return res.status(400).json({ error: "Choose a property" });
  const loaded = await loadPropertyFeeSettings(db, propertyId);
  if (!loaded) return res.status(404).json({ error: "Property not found" });
  const platform = String(req.query.platform || "direct");
  return res.json({ propertyId, platform, currency: loaded.settings.currency || loaded.property.currency || "AED", ...ratesFromSettings(loaded.settings, platform), includeCleaning: loaded.settings.includeCleaning !== false, feeBasis: loaded.settings.feeBasis === "net-payout" ? "net-payout" : "gross" });
}));

// Bookings still waiting for a verified guest total, for one checkout month (the month their owner
// statement belongs to). Read-only; the Verify bookings screen saves through PATCH /reservations/:id.
router.get("/reservations/unverified", asyncHandler(async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "Choose a month (YYYY-MM)" });
  const propertyId = req.query.propertyId ? parseId(String(req.query.propertyId)) : null;
  const ownerId = req.query.ownerId ? parseId(String(req.query.ownerId)) : null;
  const conds = [gte(reservationsTable.checkOut, `${month}-01`), lte(reservationsTable.checkOut, `${month}-31`), notInArray(reservationsTable.status, ["cancelled", "blocked"]),
    or(sql`${reservationsTable.financeMode} is null`, ne(reservationsTable.financeMode, "inclusive-v1"),
      // verified Airbnb bookings still missing the co-host payout on properties where Airbnb pays it to the owner
      and(eq(reservationsTable.platform, "airbnb"), isNull(reservationsTable.cohostPayout), eq(propertySettingsTable.cohostPaidToOwner, true)),
      // verified bookings not calculated on the property's current fee basis (e.g. actual channel fees missing)
      sql`coalesce(${reservationsTable.feeBasis}, 'gross') <> coalesce(${propertySettingsTable.feeBasis}, 'gross')`,
      // verified Airbnb bookings without Airbnb's payout on properties where Airbnb pays the whole payout to the owner
      and(eq(reservationsTable.platform, "airbnb"), isNull(reservationsTable.airbnbPayout), eq(propertySettingsTable.payoutToOwner, true)))];
  if (propertyId) conds.push(eq(reservationsTable.propertyId, propertyId));
  if (ownerId) conds.push(eq(propertiesTable.ownerId, ownerId));
  const rows = await db.select({ r: reservationsTable, propertyName: propertiesTable.name, ownerId: propertiesTable.ownerId, ownerName: ownersTable.name, cohostPaidToOwner: propertySettingsTable.cohostPaidToOwner, payoutToOwner: propertySettingsTable.payoutToOwner, feeBasis: propertySettingsTable.feeBasis })
    .from(reservationsTable).innerJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id)).leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .leftJoin(propertySettingsTable, eq(propertySettingsTable.propertyId, reservationsTable.propertyId))
    .where(and(...conds)).orderBy(propertiesTable.name, reservationsTable.checkOut, reservationsTable.id);
  const codes = [...new Set(rows.map(x => x.r.externalId).filter((x): x is string => !!x && x.startsWith("airbnb:")).map(x => x.slice(7)))];
  const earnings = codes.length ? await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode, codes)) : [];
  const locks = rows.length ? await db.select({ propertyId: ownerStatementsTable.propertyId }).from(ownerStatementsTable).where(and(eq(ownerStatementsTable.month, month), ne(ownerStatementsTable.status, "draft"), inArray(ownerStatementsTable.propertyId, [...new Set(rows.map(x => x.r.propertyId))]))) : [];
  const defaults = new Map<number, any>();
  for (const pid of new Set(rows.map(x => x.r.propertyId))) {
    const loaded = await loadPropertyFeeSettings(db, pid);
    if (loaded) defaults.set(pid, { settings: loaded.settings, property: loaded.property });
  }
  res.json(rows.map(({ r, propertyName, ownerId, ownerName, cohostPaidToOwner, payoutToOwner, feeBasis }) => {
    const basis = feeBasis === "net-payout" || feeBasis === "airbnb-payout" ? feeBasis : "gross";
    const d = defaults.get(r.propertyId); const rates = d ? ratesFromSettings(d.settings, r.platform) : null;
    const f = reservationFinancials(r, earnings, { currency: d?.settings.currency || d?.property.currency });
    return { id: r.id, propertyId: r.propertyId, propertyName, ownerId, ownerName, guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform, status: r.status,
      cohostPayout: r.cohostPayout != null ? Number(r.cohostPayout) : null,
      verified: r.financeMode === "inclusive-v1", cohostRequired: cohostPaidToOwner === true && r.platform === "airbnb",
      feeBasis: basis, channelFees: r.channelFees != null ? Number(r.channelFees) : null,
      airbnbPayout: r.airbnbPayout != null ? Number(r.airbnbPayout) : null, payoutToOwner: payoutToOwner === true,
      grossAmount: r.financeMode === "inclusive-v1" && r.grossAmount != null ? Number(r.grossAmount) : null,
      needsRecalc: r.financeMode === "inclusive-v1" && (r.feeBasis ?? "gross") !== basis,
      currency: f.currency, channelEarnings: f.channelEarnings, recordedAmount: f.recordedAmount,
      defaults: { cleaningFee: d?.settings.cleaningFee != null ? Number(d.settings.cleaningFee) : 0, channelPercent: rates?.channelPercent ?? 0, managementPercent: rates?.managementPercent ?? null, vatRate: rates?.vatRate ?? 0, tourismEnabled: !!rates?.tourismEnabled },
      needsRooms: !!rates?.tourismEnabled && d != null && bedroomCount(d.property) == null,
      locked: locks.some(l => l.propertyId === r.propertyId) };
  }));
}));

// Airbnb reservation breakdowns (one row per reservation from Airbnb's files): the Verify bookings import, the one
// way Airbnb figures reach bookings. Rows are matched to bookings by confirmation code (or linked to the same stay
// already on the calendar from the Airbnb feed); a stay YallaPMS doesn't have yet (e.g. older than the calendar
// feed) is created as an Airbnb booking on the property named like the listing (or the one chosen). Each row is
// calculated on its property's fee basis: the guest-paid total for the standard and net-payout bases, Airbnb's host
// figures (gross earnings, host service fee, exact payout) for the Airbnb payout basis. A row without the figures
// its basis needs creates the booking unverified (the stay is known; its money isn't): blanks stay blank, never 0.
// Preview is read-only; apply re-runs the same preview on the server and saves only rows that can be applied, each
// through the normal booking save (month lock and overlap checks), with an Activity Log entry per booking and one
// for the import. Re-running the same file changes nothing (rows already up to date are skipped).
type BreakdownPlan = { action: "update" | "link" | "create" | "none"; verify: boolean; body: any; reservationId?: number; propertyId?: number; base?: any; overlapOk?: string[] };
const eqMoney = (a: unknown, b: unknown) => (a == null || a === "") && (b == null || b === "") ? true : a != null && b != null && a !== "" && b !== "" && Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
const fmtMoney = (v: string | number | null | undefined, c: string) => v == null ? "–" : `${c} ${Number(v).toFixed(2)}`;
function importNote(row: any, fileName: string | null) {
  const c = row.currency || "";
  const bits = [row.accommodationTotal != null ? `accommodation ${fmtMoney(row.accommodationTotal, c)}` : null, row.cleaningFee != null ? `cleaning fee ${fmtMoney(row.cleaningFee, c)}` : null,
    row.hostServiceFee != null ? `host service fee ${fmtMoney(row.hostServiceFee, c)}` : null, row.hostPayout != null ? `${row.cohostLineOnly ? "co-host payout line" : "payout"} ${fmtMoney(row.hostPayout, c)}` : null,
    `guest paid total ${row.guestTotal != null ? fmtMoney(row.guestTotal, c) : "not in the file"}`].filter(Boolean);
  return `Airbnb breakdowns import${fileName ? ` (${fileName})` : ""}: ${bits.join(", ")}.`;
}
async function buildBreakdownPreview(csv: unknown, propertyFor: Record<string, unknown> = {}) {
  const rows = parseBreakdowns(csv);
  const codes: string[] = [...new Set(rows.map(r => r.code).filter(Boolean))];
  const bookings = codes.length ? await db.select({ r: reservationsTable, propertyName: propertiesTable.name }).from(reservationsTable).innerJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(inArray(reservationsTable.externalId, codes.map(c => `airbnb:${c}`))) : [];
  const earnings = codes.length ? await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode, codes)) : [];
  const properties = await db.select().from(propertiesTable);
  const lockRows = await db.select({ propertyId: ownerStatementsTable.propertyId, month: ownerStatementsTable.month }).from(ownerStatementsTable).where(ne(ownerStatementsTable.status, "draft"));
  const seen = new Map<string, number>(); for (const r of rows) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const settingsCache = new Map<number, any>();
  const settingsOf = async (pid: number) => { if (!settingsCache.has(pid)) settingsCache.set(pid, await loadPropertyFeeSettings(db, pid)); return settingsCache.get(pid); };
  const listingProperty = (listing: string | null) => {
    const chosen = listing != null ? parseId(String(propertyFor[listing] ?? "")) : null;
    if (chosen) return properties.find(p => p.id === chosen) ?? null;
    const name = String(listing ?? "").trim().toLowerCase();
    const hits = name ? properties.filter(p => p.name.trim().toLowerCase() === name) : [];
    return hits.length === 1 ? hits[0] : null;
  };
  const out: any[] = [];
  const plans = new Map<string, BreakdownPlan>();
  const today = dubaiToday();
  const past = (d: string | null | undefined) => !!d && d < today;
  for (const row of rows) {
    const blocking: string[] = [...row.errors], review: string[] = [], notes: string[] = [];
    if (seen.get(row.code)! > 1) blocking.push("This confirmation code appears more than once in the file");
    const matches = bookings.filter(b => b.r.externalId === `airbnb:${row.code}`);
    if (matches.length > 1) blocking.push("More than one booking has this confirmation code");
    let r: any = matches[0]?.r ?? null, propertyName: string | null = matches[0]?.propertyName ?? null;
    let action: BreakdownPlan["action"] = r ? "update" : "create";
    let overlapOk: string[] | undefined;
    const target = r ? properties.find(p => p.id === r.propertyId) ?? null : listingProperty(row.listing);
    if (!r && !target) {
      out.push({ ...row, matched: false, action: "create", needsProperty: true, blocking: blocking.length ? blocking : ["No booking with this confirmation code, and no property is named like this listing: choose the property to create it on"], review, notes, bulkOk: false });
      continue;
    }
    const loaded = await settingsOf(target!.id);
    const settings = loaded?.settings;
    const basis: "gross" | "net-payout" | "airbnb-payout" = settings?.feeBasis === "net-payout" || settings?.feeBasis === "airbnb-payout" ? settings.feeBasis : "gross";
    const propertyCurrency = { currency: loaded?.property.currency || settings?.currency };
    let currency = r ? bookingCurrency(r, propertyCurrency) : (target!.currency || settings?.currency || "AED");
    if (!r) {
      if (!row.checkIn || !row.checkOut) blocking.push("No stay dates in the file");
      else {
        // The same stay may already be on the calendar from the Airbnb feed (or entered by hand): link it.
        const [twin] = await db.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId, target!.id), eq(reservationsTable.platform, "airbnb"), eq(reservationsTable.checkIn, row.checkIn), eq(reservationsTable.checkOut, row.checkOut), ne(reservationsTable.status, "cancelled"),
          or(isNull(reservationsTable.externalId), sql`${reservationsTable.externalId} like 'ical:airbnb:%'`)));
        // A linked booking keeps its own currency (stamped when the property's currency changed): compare with that.
        if (twin) { r = twin; action = "link"; currency = bookingCurrency(twin, propertyCurrency); notes.push(`Links the stay already on the calendar (booking #${twin.id}) to ${row.code}`); }
        else {
          const clash = await db.select({ id: reservationsTable.id, guestName: reservationsTable.guestName, checkIn: reservationsTable.checkIn, checkOut: reservationsTable.checkOut, externalId: reservationsTable.externalId }).from(reservationsTable)
            .where(and(eq(reservationsTable.propertyId, target!.id), ne(reservationsTable.status, "cancelled"), lt(reservationsTable.checkIn, row.checkOut), gt(reservationsTable.checkOut, row.checkIn)));
          // Airbnb's own records sometimes overlap (e.g. a stay shortened after booking, both paid in full). For past
          // stays that are both in this file, the stay is created as Airbnb recorded it, after a one-by-one review.
          const fileOverlap = (other: { code: string; checkIn: string | null; checkOut: string | null }) => past(row.checkOut) && past(other.checkOut);
          const inFile = rows.filter(o => o !== row && o.code && o.listing === row.listing && o.checkIn && o.checkOut && o.checkIn < row.checkOut! && o.checkOut > row.checkIn! && !clash.some(c => c.externalId === `airbnb:${o.code}`));
          const okClash = clash.filter(c => { const o = rows.find(x => `airbnb:${x.code}` === c.externalId); return o && fileOverlap(o); });
          const badClash = clash.filter(c => !okClash.includes(c));
          if (badClash.length) blocking.push(`Overlaps ${badClash.map(c => `booking #${c.id} (${c.guestName}, ${c.checkIn} → ${c.checkOut})`).join(", ")} on ${target!.name}`);
          const allowed = [...okClash.map(c => String(c.externalId).slice(7)), ...inFile.filter(fileOverlap).map(o => o.code)];
          for (const o of inFile.filter(o => !fileOverlap(o))) blocking.push(`Overlaps ${o.code} (${o.checkIn} → ${o.checkOut}) in this file`);
          if (allowed.length) {
            overlapOk = allowed;
            review.push(`Airbnb's record overlaps ${allowed.map(c => { const o = rows.find(x => x.code === c)!; return `${c} (${o.checkIn} → ${o.checkOut})`; }).join(", ")}: both are past stays paid by Airbnb, so it is added with Airbnb's dates (the calendar overlap check is relaxed only for stays in this file)`);
          }
        }
      }
      propertyName = target!.name;
    }
    const checkOut = r?.checkOut ?? row.checkOut;
    if (checkOut && lockRows.some(l => l.propertyId === target!.id && l.month === String(checkOut).slice(0, 7))) blocking.push(`The ${String(checkOut).slice(0, 7)} statement for this property was already sent or paid`);
    if (!row.currency) blocking.push("No currency in the file");
    else if (row.currency !== currency) blocking.push(`File currency ${row.currency} differs from the ${r ? "booking's" : "property's"} ${currency}`);
    if (r && ["cancelled", "blocked"].includes(r.status)) blocking.push(`Booking is ${r.status}`);
    if (r && ((row.checkIn && row.checkIn !== r.checkIn) || (row.checkOut && row.checkOut !== r.checkOut))) review.push(`Dates differ: file ${row.checkIn} → ${row.checkOut}, booking ${r.checkIn} → ${r.checkOut}`);
    // What the property's fee basis needs from the file; missing figures are listed, never filled with 0.
    const missing: string[] = [];
    let body: any = { financeMode: "inclusive-v1" };
    if (basis === "airbnb-payout") {
      if (row.cohostLineOnly) missing.push("the file only has a co-host payout line for this stay, not what Airbnb paid the host");
      if (row.hostGross == null) missing.push(row.accommodationTotal == null ? "no accommodation total in the file" : "no cleaning fee in the file");
      if (row.hostPayout == null) missing.push("no host payout in the file");
      body = { ...body, grossAmount: row.hostGross, airbnbPayout: row.hostPayout, ...(row.hostServiceFee != null ? { channelFees: row.hostServiceFee } : {}) };
      if (row.hostServiceFee == null) notes.push("No host service fee in the file: Airbnb's fees are worked out as gross earnings minus the payout");
      notes.push(row.guestTotal != null ? `Guest paid total in the file: ${fmtMoney(row.guestTotal, currency)} (kept in the booking notes; this property is calculated from Airbnb's payout)` : "Guest paid total: not in the file, so it stays unknown (this property is calculated from Airbnb's payout)");
    } else {
      if (row.guestTotal == null) missing.push("no guest paid total in the file (a blank is not 0)");
      if (basis === "net-payout" && row.channelFees == null) missing.push("no Airbnb fees in the file (guest service fee and host service fee): this property's fee is a % of the net payout");
      const cohostAmount = row.cohost.amount;
      body = { ...body, grossAmount: row.guestTotal, ...(row.cleaningFee != null ? { cleaningFee: row.cleaningFee } : {}), ...(row.channelFees != null ? { channelFees: row.channelFees } : {}), ...(cohostAmount != null ? { cohostPayout: cohostAmount } : {}) };
      if (row.cohost.mentioned && cohostAmount == null && !missing.length) review.push(row.cohost.suggested != null ? `Co-host payout amount filled in from other fees (${row.cohost.suggested}): check it against Airbnb before ticking` : "Co-host payout mentioned without an amount: enter it from Airbnb");
      if (row.cohost.source === "column") notes.push(`Co-host payout ${row.cohost.amount} from the verified co-host column${row.cohost.to ? ` (to ${row.cohost.to})` : ""}`);
      if (row.cleaningFee == null && r) notes.push(r.cleaningFee != null ? `No cleaning fee in the file; the booking keeps ${Number(r.cleaningFee).toFixed(2)}` : "No cleaning fee in the file; the property's cleaning fee setting applies");
      if (basis === "net-payout" && row.net.check === "differs") review.push(`Guest total minus Airbnb fees (${row.net.netPayout}) doesn't equal the co-host + host payout (${row.net.paidOut})`);
      if (basis === "net-payout" && row.net.check === "rounding") notes.push(`Net payout ${row.net.netPayout} vs paid out ${row.net.paidOut}: rounding`);
      if (r?.cohostPayout != null && row.cohost.amount != null && Number(r.cohostPayout).toFixed(2) !== row.cohost.amount) review.push(`Co-host payout differs from the one saved (${Number(r.cohostPayout).toFixed(2)})`);
      // What Airbnb paid out is kept on the booking where the whole payout goes to the owner, and on stays created here.
      if (row.hostPayout != null && !row.cohostLineOnly && (settings?.payoutToOwner || action !== "update")) body.airbnbPayout = row.hostPayout;
    }
    if (row.hostPayout != null && row.cohostLineOnly) notes.push(`Co-host payout line ${fmtMoney(row.hostPayout, row.currency || currency)} (paid to the co-host's own Airbnb account; not the host payout)`);
    // The stored Airbnb export figure, when there is one, is compared and kept.
    const stored = r ? earnings.filter(e => e.confirmationCode === row.code && Number(e.propertyId) === r.propertyId) : [];
    const storedPayout = stored.length === 1 ? Number(stored[0].amount).toFixed(2) : null;
    const payoutCheck = storedPayout != null && stored[0].currency === row.currency && !row.cohostLineOnly ? payoutComparison(row.hostPayout, storedPayout) : "none";
    if (payoutCheck === "differs") review.push(`Payout differs: file ${row.currency} ${row.hostPayout}, stored ${stored[0].currency} ${storedPayout}`);
    if (payoutCheck === "rounding") notes.push(`Rounding difference: file ${row.currency} ${row.hostPayout}, stored ${storedPayout} (the stored figure is kept)`);
    if (stored.length > 1) review.push("More than one stored Airbnb payout for this code");
    const verify = missing.length === 0;
    if (!verify) {
      if (action === "create") notes.push(`Created without verified figures: ${missing.join("; ")}. The stay is added; its month's statement waits until the booking is verified`);
      else if (action === "link") notes.push(`Linked without verified figures: ${missing.join("; ")}`);
      else if (r?.financeMode === "inclusive-v1") blocking.push(`Can't apply: ${missing.join("; ")}`);
      else blocking.push(`Already added, still not verified: ${missing.join("; ")}`);
    }
    // Already applied: nothing to change (re-running the same file is safe).
    let upToDate = false;
    if (r && action === "update") {
      const sameFigures = verify && r.financeMode === "inclusive-v1" && (r.feeBasis ?? "gross") === basis && eqMoney(r.grossAmount, body.grossAmount) && (body.channelFees === undefined || eqMoney(r.channelFees, body.channelFees))
        && (body.airbnbPayout === undefined || eqMoney(r.airbnbPayout, body.airbnbPayout)) && (body.cohostPayout === undefined || eqMoney(r.cohostPayout, body.cohostPayout)) && (body.cleaningFee === undefined || eqMoney(r.cleaningFee, body.cleaningFee));
      // Saved before Airbnb's actual fees were used on the standard basis (channel line was the estimated %): same figures, recalculated.
      const estimatedFees = sameFigures && basis === "gross" && body.channelFees != null && !eqMoney(r.channelAmount, body.channelFees);
      if (sameFigures && !estimatedFees) upToDate = true;
      if (upToDate) action = "none";
      else if (estimatedFees) notes.push(`Same figures; recalculated with Airbnb's actual fees ${fmtMoney(body.channelFees, currency)} instead of the estimated channel % (${fmtMoney(r.channelAmount, currency)})`);
      else if (r.financeMode === "inclusive-v1") review.push(basis === "airbnb-payout" ? "Booking is already verified; applying replaces its Airbnb figures" : "Booking is already verified; applying replaces its guest total");
    }
    let preview: any = null;
    const base = r ? null : { externalId: `airbnb:${row.code}`, guestName: row.guestName || `Airbnb guest ${row.code}`, propertyId: target!.id, platform: "airbnb", checkIn: row.checkIn, checkOut: row.checkOut,
      status: row.checkOut && row.checkOut <= today ? "checked_out" : row.checkIn && row.checkIn <= today ? "checked_in" : "confirmed", paymentStatus: "unknown" };
    if (!blocking.length && verify && action !== "none") {
      try {
        const f = validateBooking(await prepareFinance({ ...body }, r ?? base));
        const n = (k: string) => f[k] == null ? null : Number(f[k]);
        preview = { ok: true, grossAmount: n("grossAmount"), revenue: n("revenue"), vatAmount: n("vatAmount"), tourismFee: n("tourismFee"), channelPercent: n("channelPercent"), channelAmount: n("channelAmount"),
          managementPercent: n("managementPercent"), managementAmount: n("managementAmount"), cleaningFee: n("cleaningFee"), cleaningDeducted: settings?.includeCleaning !== false, ownerAmount: n("ownerAmount"),
          feeBasis: f.feeBasis ?? "gross", channelFees: n("channelFees"), airbnbPayout: n("airbnbPayout") };
        if (basis === "airbnb-payout" && row.hostServiceFee != null && row.hostGross != null && row.hostPayout != null) {
          const diff = Math.round(Number(row.hostPayout) * 100) - (Math.round(Number(row.hostGross) * 100) - Math.round(Number(row.hostServiceFee) * 100));
          if (diff) notes.push(`Airbnb's payout is ${(Math.abs(diff) / 100).toFixed(2)} ${diff > 0 ? "more" : "less"} than accommodation + cleaning − host service fee (Airbnb's rounding); Airbnb's exact payout is used`);
        }
      } catch (e) { blocking.push((e as Error).message); }
    }
    if (!verify && action !== "update") body = { ...(row.hostPayout != null && !row.cohostLineOnly ? { airbnbPayout: row.hostPayout } : {}) };
    plans.set(row.code, { action, verify, body, reservationId: r?.id, propertyId: target!.id, base, overlapOk });
    const payoutParts = row.payoutParts.filter(p => p.paidOn || p.amount);
    out.push({ ...row, matched: !!r && action !== "link", action, upToDate, verify, basis, reservationId: r?.id ?? null, propertyId: target!.id, propertyName, listingPropertyId: r ? null : target!.id,
      bookingGuest: r?.guestName ?? base?.guestName, bookingCheckIn: r?.checkIn ?? row.checkIn, bookingCheckOut: r?.checkOut ?? row.checkOut, currencyExpected: currency, payoutParts, overlapOk: overlapOk ?? [],
      current: r ? { verified: r.financeMode === "inclusive-v1", grossAmount: r.grossAmount != null ? Number(r.grossAmount) : null, cleaningFee: r.cleaningFee != null ? Number(r.cleaningFee) : null, cohostPayout: r.cohostPayout != null ? Number(r.cohostPayout) : null, channelFees: r.channelFees != null ? Number(r.channelFees) : null, airbnbPayout: r.airbnbPayout != null ? Number(r.airbnbPayout) : null, feeBasis: r.feeBasis ?? null } : null,
      storedPayout: storedPayout != null ? Number(storedPayout) : null, storedPayoutCurrency: stored[0]?.currency ?? null, payoutCheck,
      preview, blocking, review, notes, bulkOk: action !== "none" && !blocking.length && !review.length });
  }
  const summary = { rows: out.length, matched: out.filter(r => r.matched).length, unmatched: out.filter(r => !r.matched && r.action !== "create" && r.action !== "link").length,
    toCreate: out.filter(r => r.action === "create" && !r.needsProperty && !r.blocking.length).length, toLink: out.filter(r => r.action === "link" && !r.blocking.length).length,
    needsProperty: out.filter(r => r.needsProperty).length, upToDate: out.filter(r => r.upToDate).length,
    clean: out.filter(r => r.bulkOk).length, review: out.filter(r => r.action !== "none" && !r.blocking.length && r.review.length).length, blocked: out.filter(r => !r.needsProperty && r.blocking.length && r.action !== "none").length };
  return { rows: out, summary, plans, properties: properties.filter(p => p.status === "active").map(p => ({ id: p.id, name: p.name, currency: p.currency })) };
}

router.post("/reservations/airbnb-breakdowns/preview", asyncHandler(async (req, res) => {
  try {
    const { rows, summary, properties } = await buildBreakdownPreview(req.body?.csv, req.body?.propertyFor ?? {});
    // Older screens used "unmatched" for every row without a booking; rows that will be created are listed separately.
    res.json({ rows, summary, properties });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
}));

router.post("/reservations/airbnb-breakdowns/apply", asyncHandler(async (req, res) => {
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 200) : null;
  const wanted: string[] = Array.isArray(req.body?.codes) ? req.body.codes.map((c: unknown) => String(c).trim().toUpperCase()) : [];
  const cohostInput: Record<string, unknown> = req.body?.cohost ?? {};
  if (!wanted.length) return res.status(400).json({ error: "Tick the rows to apply" });
  let built;
  try { built = await buildBreakdownPreview(req.body?.csv, req.body?.propertyFor ?? {}); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const user = req.headers["x-user-id"] as string;
  const results: Record<string, { ok: boolean; action: string; reservationId?: number; message: string }> = {};
  for (const code of wanted) {
    const row = built.rows.find(r => r.code === code), plan = built.plans.get(code);
    if (!row || !plan) { results[code] = { ok: false, action: "none", message: "Not in the file" }; continue; }
    if (row.needsProperty) { results[code] = { ok: false, action: "none", message: "Choose the property first" }; continue; }
    if (plan.action === "none") { results[code] = { ok: true, action: "none", reservationId: plan.reservationId, message: "Already up to date: nothing changed" }; continue; }
    if (row.blocking.length) { results[code] = { ok: false, action: plan.action, message: row.blocking.join("; ") }; continue; }
    try {
      const body: any = { ...plan.body };
      if (row.cohost?.mentioned && row.cohost.amount == null && cohostInput[code] != null && String(cohostInput[code]).trim() !== "") body.cohostPayout = String(cohostInput[code]).trim();
      if (row.cohost?.mentioned && row.cohost.amount == null && body.cohostPayout == null && row.basis !== "airbnb-payout" && plan.verify) throw new Error("Enter the co-host payout amount from Airbnb");
      const note = importNote(row, fileName);
      let saved: any;
      if (plan.action === "create") {
        const base = { ...plan.base, notes: note };
        const input: any = plan.verify ? validateBooking(await prepareFinance({ ...base, ...body })) : validateBooking({ ...base, ...body });
        input.balanceDue = null; // Airbnb collected from the guest; there's no guest balance to track here.
        const parsed = insertReservationSchema.safeParse(input);
        if (!parsed.success) throw new Error(parsed.error.message);
        saved = await saveBooking(parsed.data, undefined, { historical: true, overlapOk: plan.overlapOk?.map(c => `airbnb:${c}`) });
        await insertAuditLog({ action: "create", entity: "reservation", entityId: saved.id, details: { source: "Airbnb breakdowns import", file: fileName, code, verified: plan.verify, ...body }, performedBy: user });
      } else {
        const [existing] = await db.select().from(reservationsTable).where(eq(reservationsTable.id, plan.reservationId!));
        if (!existing) throw new Error("The booking no longer exists");
        const extra: any = { notes: existing.notes?.includes(note) ? existing.notes : [existing.notes, note].filter(Boolean).join(" "), ...(plan.action === "link" ? { externalId: `airbnb:${code}` } : {}) };
        const input: any = plan.verify ? validateBooking(await prepareFinance({ ...body, ...extra }, existing)) : validateBooking({ ...existing, ...body, ...extra });
        delete input.id; delete input.createdAt;
        const parsed = insertReservationSchema.safeParse(input);
        if (!parsed.success) throw new Error(parsed.error.message);
        saved = await saveBooking(parsed.data, existing.id, { historical: true });
        await insertAuditLog({ action: "update", entity: "reservation", entityId: saved.id, details: { source: "Airbnb breakdowns import", file: fileName, code, linked: plan.action === "link" || undefined, verified: plan.verify, ...body }, performedBy: user });
      }
      // How Airbnb paid it (dates, account, a USD transfer's own amount): replaced with the file's parts.
      const parts = (row.payoutParts as any[]).filter(p => p.paidOn || p.amount);
      if (parts.length && !row.cohostLineOnly) {
        await db.delete(airbnbBookingPayoutsTable).where(eq(airbnbBookingPayoutsTable.reservationId, saved.id));
        await db.insert(airbnbBookingPayoutsTable).values(parts.map(p => ({ reservationId: saved.id, confirmationCode: code, part: p.part, paidOn: p.paidOn, amount: p.amount, currency: p.currency || saved.currency || row.currencyExpected, paidTo: p.paidTo, sentAmount: p.sentAmount, sentCurrency: p.sentCurrency, reference: p.reference, fileName })));
      }
      results[code] = { ok: true, action: plan.action, reservationId: saved.id, message: plan.action === "create" ? (plan.verify ? "Created (verified)" : "Created (not verified: figures missing)") : plan.action === "link" ? "Linked and saved" : "Saved" };
    } catch (e) { results[code] = { ok: false, action: plan.action, message: (e as Error).message }; }
  }
  const done = Object.values(results);
  const counts = { created: done.filter(r => r.ok && r.action === "create").length, linked: done.filter(r => r.ok && r.action === "link").length, updated: done.filter(r => r.ok && r.action === "update").length,
    unchanged: done.filter(r => r.ok && r.action === "none").length, failed: done.filter(r => !r.ok).length };
  await insertAuditLog({ action: "create", entity: "airbnb_breakdown_import", entityId: 0, details: { file: fileName, rows: built.rows.length, ticked: wanted.length, ...counts }, performedBy: user });
  res.json({ results, ...counts });
}));

// Dry run of the booking calculation (the same prepareFinance + validation the save uses); saves nothing.
router.post("/reservations/:id/finance-preview", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(reservationsTable).where(eq(reservationsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  try {
    const r = validateBooking(await prepareFinance({ ...req.body, financeMode: "inclusive-v1" }, existing));
    const n = (k: string) => r[k] == null ? null : Number(r[k]);
    const loaded = await loadPropertyFeeSettings(db, Number(r.propertyId));
    // Same rule prepareFinance applied: the property's "Include cleaning costs" setting.
    return res.json({ ok: true, feeBasis: r.feeBasis ?? "gross", channelFees: n("channelFees"), cleaningDeducted: loaded?.settings.includeCleaning !== false, grossAmount: n("grossAmount"), revenue: n("revenue"), vatAmount: n("vatAmount"), tourismFee: n("tourismFee"), channelPercent: n("channelPercent"), channelAmount: n("channelAmount"),
      managementPercent: n("managementPercent"), managementAmount: n("managementAmount"), cleaningFee: n("cleaningFee"), ownerAmount: n("ownerAmount") });
  } catch (e) { return res.json({ ok: false, error: (e as Error).message }); }
}));

router.get("/reservations/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db
    .select(reservationSelect)
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(eq(reservationsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  const code=row.externalId?.startsWith("airbnb:")?row.externalId.slice(7):null;
  return res.json(formatReservation(row,code?await db.select().from(airbnbEarningsTable).where(eq(airbnbEarningsTable.confirmationCode,code)):[]));
}));


function validateBooking(input: any) {
  if (!input.guestName?.trim()) throw new Error("Guest name is required");
  input.guestName = input.guestName.trim();
  for (const key of ["checkIn", "checkOut"]) {
    const date = new Date(input[key]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input[key]) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input[key]) throw new Error("Enter valid booking dates");
  }
  input.nights = (Date.parse(input.checkOut)-Date.parse(input.checkIn))/86400000;
  if (input.nights <= 0) throw new Error("Checkout must be after check-in");
  if (!["confirmed","checked_in","checked_out","cancelled","blocked"].includes(input.status ?? "confirmed")) throw new Error("Invalid reservation status");
  if (!["pending","partial","paid","unknown"].includes(input.paymentStatus ?? "pending")) throw new Error("Invalid payment status");
  if (input.cohostPayout === "") input.cohostPayout = null;
  if (input.channelFees === "") input.channelFees = null;
  if (input.airbnbPayout === "") input.airbnbPayout = null;
  for (const key of ["revenue","cleaningFee","balanceDue","cohostPayout","channelFees","airbnbPayout"]) {
    if (input[key] != null) {
      if (!/^\d+(\.\d{1,2})?$/.test(String(input[key]))) throw new Error("Enter valid non-negative amounts");
      input[key] = String(input[key]);
    }
  }
  if (input.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.guestEmail)) throw new Error("Enter a valid guest email");
  return input;
}
/** opts.historical: a stay imported after the fact (checkout already past) gets no checkout clean. */
/** opts.overlapOk: Airbnb bookings (external ids) a past stay may overlap, because Airbnb's own record does (breakdowns import, after review). */
async function saveBooking(input: any, id?: number, opts: { historical?: boolean; overlapOk?: string[] } = {}) {
 return db.transaction(async tx => {
  const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id,Number(input.propertyId))).for("update");
  if (!property) throw new Error("Choose an existing property");
  const [existing] = id ? await tx.select().from(reservationsTable).where(eq(reservationsTable.id,id)).for("update") : [];
  // Moving a booking to a property in another currency would relabel its amounts.
  if (existing && Number(existing.propertyId) !== Number(input.propertyId) && (existing.financeMode === "inclusive-v1" || existing.currency)) {
   const [from] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, existing.propertyId));
   const was = bookingCurrency(existing, from);
   if (was !== (property.currency || "AED")) throw new Error(`This booking's amounts are in ${was}; ${property.name} uses ${property.currency || "AED"}. Moving it would relabel them.`);
  }
  const availabilityChanged = !existing || ["propertyId","checkIn","checkOut","status"].some(k=>(existing as any)[k]!==input[k]);
  if (input.status !== "cancelled" && availabilityChanged) {
   const today = dubaiToday();
   const conflicts = (await tx.select({id:reservationsTable.id,externalId:reservationsTable.externalId,checkOut:reservationsTable.checkOut}).from(reservationsTable).where(and(eq(reservationsTable.propertyId,input.propertyId), ne(reservationsTable.status,"cancelled"),lt(reservationsTable.checkIn,input.checkOut),gt(reservationsTable.checkOut,input.checkIn),id ? ne(reservationsTable.id,id) : undefined)))
    .filter(c => !(opts.overlapOk?.includes(String(c.externalId)) && input.checkOut < today && c.checkOut < today));
   if (conflicts.length) throw new Error("These dates overlap an existing reservation or blocked dates");
  }
  const locked = await tx.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(inArray(ownerStatementsTable.propertyId,[input.propertyId,...(existing?[existing.propertyId]:[])]),inArray(ownerStatementsTable.month,[input.checkOut.slice(0,7),...(existing?[existing.checkOut.slice(0,7)]:[])]),ne(ownerStatementsTable.status,"draft")));
  if (locked.length && (!existing || ["propertyId","financeMode","grossAmount","revenue","managementPercent","managementAmount","cleaningFee","channelPercent","channelAmount","vatRate","vatAmount","tourismRate","tourismFee","ownerAmount","cohostPayout","channelFees","airbnbPayout","feeBasis","checkIn","checkOut","status"].some(k=>String((existing as any)[k])!==String(input[k])))) throw new Error("This booking belongs to a published statement. Finance changes require an adjustment.");
  const [row] = id ? await tx.update(reservationsTable).set(input).where(eq(reservationsTable.id,id)).returning() : await tx.insert(reservationsTable).values(input).returning();
  // Keep the payments ledger and the booking balance in step: a balance change made on the booking itself
  // (e.g. choosing "Paid") is posted as a payment or reversal, so the two can never disagree.
  if (row.financeMode==="inclusive-v1" && row.balanceDue!=null && (!existing || (existing.financeMode==="inclusive-v1" && existing.balanceDue!=null))) {
   const cents=(v:unknown)=>Math.round(Number(v||0)*100);
   const paidNow=cents(row.grossAmount)-cents(row.balanceDue), paidBefore=existing ? cents(existing.grossAmount)-cents(existing.balanceDue) : 0;
   const delta=paidNow-paidBefore, today=dubaiToday();
   if (delta!==0) await tx.insert(paymentsTable).values({type:delta>0?"guest_payment":"guest_refund",reservationId:row.id,propertyId:row.propertyId,amount:(Math.abs(delta)/100).toFixed(2),status:"paid",paidAt:today,dueDate:today,description:delta>0?`Recorded from booking #${row.id} payment status`:`Reversal recorded from booking #${row.id} payment status`});
  }
  const tasks = await tx.select().from(cleaningTasksTable).where(eq(cleaningTasksTable.reservationId,row.id));
  if (["cancelled","blocked"].includes(row.status)) {
   for (const task of tasks) if (!["approved","completed"].includes(task.status)) await tx.update(cleaningTasksTable).set({status:"cancelled"}).where(eq(cleaningTasksTable.id,task.id));
  } else if (!tasks.length && !(opts.historical && row.checkOut < dubaiToday())) {
   await tx.insert(cleaningTasksTable).values({propertyId:row.propertyId,reservationId:row.id,status:"dirty",scheduledDate:row.checkOut,scheduledTime:"11:00"});
  } else {
   for (const task of tasks) if (!["approved","completed"].includes(task.status)) await tx.update(cleaningTasksTable).set({propertyId:row.propertyId,scheduledDate:row.checkOut,status:task.status==="cancelled"?"dirty":task.status}).where(eq(cleaningTasksTable.id,task.id));
  }
  return { ...row, currency: bookingCurrency(row, property) };
 });
}
router.post("/reservations", asyncHandler(async (req, res) => {
 try {
  let input = validateBooking(await prepareFinance({...req.body}));
  const total = Number(input.grossAmount ?? input.revenue ?? 0);
  input.balanceDue = input.paymentStatus === "unknown" ? null : String(input.paymentStatus === "paid" ? 0 : input.balanceDue ?? total);
  if (Number(input.balanceDue)>total) throw new Error("Balance cannot exceed booking total");
  const parsed = insertReservationSchema.safeParse(input);
  if (!parsed.success) return res.status(400).json({error:parsed.error.message});
  const row = await saveBooking(parsed.data);
  await insertAuditLog({action:"create",entity:"reservation",entityId:row.id,performedBy:req.headers["x-user-id"] as string});
  return res.status(201).json(formatReservation(row));
 } catch(e) { return res.status(400).json({error:(e as Error).message}); }
}));
router.patch("/reservations/:id", asyncHandler(async (req,res)=>{
 const id = parseId(req.params.id);
 if (!id) return res.status(400).json({error:"Invalid id"});
 const [existing] = await db.select().from(reservationsTable).where(eq(reservationsTable.id,id));
 if (!existing) return res.status(404).json({error:"Not found"});
 try {
  let input = validateBooking(await prepareFinance({...req.body}, existing));
  if (existing.financeMode === "inclusive-v1" && input.financeMode !== "inclusive-v1") throw new Error("Financial calculation cannot be removed");
  const total = Number(input.grossAmount ?? input.revenue ?? 0);
  const previousPaid = Math.max(0,Number(existing.grossAmount ?? existing.revenue)-Number(existing.balanceDue ?? 0));
  input.balanceDue = input.paymentStatus === "unknown" ? null : String(input.paymentStatus === "paid" ? 0 : req.body.balanceDue ?? (input.paymentStatus === "pending" ? total : Math.max(0,total-previousPaid)));
  if (Number(input.balanceDue)>total || (input.paymentStatus==="partial" && (Number(input.balanceDue)<=0 || Number(input.balanceDue)>=total))) throw new Error("Enter the outstanding balance for a partial payment");
  delete input.id; delete input.createdAt;
  const parsed = insertReservationSchema.safeParse(input);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const row = await saveBooking(parsed.data,id);
  await insertAuditLog({action:"update",entity:"reservation",entityId:id,performedBy:req.headers["x-user-id"] as string});
  return res.json(formatReservation(row));
 } catch(e) {return res.status(400).json({error:(e as Error).message});}
}));
router.delete("/reservations/:id", (_req,res)=>res.status(409).json({error:"Cancel the reservation instead to preserve its payment and cleaning history"}));
export default router;
