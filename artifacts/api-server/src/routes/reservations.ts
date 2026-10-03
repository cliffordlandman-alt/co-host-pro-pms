import { reservationFinancials, financialTotals } from "../../../../lib/reservation-financials.mjs";
import { pageParams, paged, likeTerm } from "../lib/paging";
import { dubaiToday } from "../lib/dubai-date";
import { airbnbEarningsTable } from "@workspace/db";
import { bedroomCount, bookingFinance } from "../../../../lib/booking-finance.mjs";
import { loadPropertyFeeSettings, ratesFromSettings } from "../lib/fee-config";
import { parseBreakdowns, payoutComparison } from "../lib/airbnb-breakdowns.mjs";
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
  currency: propertiesTable.currency,
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
    balanceDue: r.balanceDue != null ? parseFloat(r.balanceDue) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// Rates and derived amounts are decided by the server, never taken from the browser.
const SERVER_FINANCE_FIELDS = ["managementPercent", "managementAmount", "channelPercent", "channelAmount", "vatRate", "vatAmount", "tourismRate", "tourismFee", "tourismNights", "ownerAmount", "dubaiCharges"];

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
  for (const f of [...SERVER_FINANCE_FIELDS, "refreshRates", "tourismRooms", "channelCommissionPercent"]) delete clean[f];
  const input: any = { ...(existing ?? {}), ...clean };
  if (input.financeMode !== "inclusive-v1") return input;
  const loaded = await loadPropertyFeeSettings(db, Number(input.propertyId));
  if (!loaded) throw new Error("Choose an existing property");
  const { property, settings } = loaded;
  for (const field of ["checkIn", "checkOut"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input[field]) || new Date(input[field]).toISOString().slice(0,10) !== input[field]) throw new Error("Enter valid booking dates");
  }
  const nights = (Date.parse(input.checkOut)-Date.parse(input.checkIn))/86400000;
  const keepSnapshot = !refreshRates && existing?.financeMode === "inclusive-v1" && Number(existing.propertyId) === Number(input.propertyId) && existing.managementPercent != null;
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
    input.cleaningFee = existing?.cleaningFee ?? settings.cleaningFee ?? 0;
  }
  const rooms = bedroomCount(property) ?? Number(tourismRoomsHint ?? existing?.tourismRooms);
  const finance = bookingFinance({total: input.grossAmount, managementPercent: rates.managementPercent,
    cleaningFee: input.cleaningFee ?? 0, nights, rooms, dubai: rates.tourismEnabled,
    vatRate: rates.vatRate, tourismRate: rates.tourismRate, tourismEnabled: rates.tourismEnabled,
    channelPercent: rates.channelPercent,
    // Always the property's current "Include cleaning costs" setting, so the booking's owner amount and
    // the owner statement agree (the statement applies the same setting).
    deductCleaning: settings.includeCleaning !== false});
  const result = {...input, ...finance, nights};
  for (const field of ["channelPercent", "channelAmount", "tourismRate", "revenue", "grossAmount", "managementPercent", "managementAmount", "tourismFee", "vatAmount", "vatRate", "ownerAmount", "cleaningFee", "balanceDue"]) {
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
  return res.json({ propertyId, platform, currency: loaded.settings.currency || loaded.property.currency || "AED", ...ratesFromSettings(loaded.settings, platform), includeCleaning: loaded.settings.includeCleaning !== false });
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
      and(eq(reservationsTable.platform, "airbnb"), isNull(reservationsTable.cohostPayout), eq(propertySettingsTable.cohostPaidToOwner, true)))];
  if (propertyId) conds.push(eq(reservationsTable.propertyId, propertyId));
  if (ownerId) conds.push(eq(propertiesTable.ownerId, ownerId));
  const rows = await db.select({ r: reservationsTable, propertyName: propertiesTable.name, ownerId: propertiesTable.ownerId, ownerName: ownersTable.name, cohostPaidToOwner: propertySettingsTable.cohostPaidToOwner })
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
  res.json(rows.map(({ r, propertyName, ownerId, ownerName, cohostPaidToOwner }) => {
    const d = defaults.get(r.propertyId); const rates = d ? ratesFromSettings(d.settings, r.platform) : null;
    const f = reservationFinancials(r, earnings, { currency: d?.settings.currency || d?.property.currency });
    return { id: r.id, propertyId: r.propertyId, propertyName, ownerId, ownerName, guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform, status: r.status,
      cohostPayout: r.cohostPayout != null ? Number(r.cohostPayout) : null,
      verified: r.financeMode === "inclusive-v1", cohostRequired: cohostPaidToOwner === true && r.platform === "airbnb",
      currency: f.currency, channelEarnings: f.channelEarnings, recordedAmount: f.recordedAmount,
      defaults: { cleaningFee: d?.settings.cleaningFee != null ? Number(d.settings.cleaningFee) : 0, channelPercent: rates?.channelPercent ?? 0, managementPercent: rates?.managementPercent ?? null, vatRate: rates?.vatRate ?? 0, tourismEnabled: !!rates?.tourismEnabled },
      needsRooms: !!rates?.tourismEnabled && d != null && bedroomCount(d.property) == null,
      locked: locks.some(l => l.propertyId === r.propertyId) };
  }));
}));

// Airbnb reservation breakdowns (guest-paid figures from each reservation's details page): match rows to
// bookings by confirmation code and show what applying them would change. Read-only; the screen applies the
// rows the user ticks through PATCH /reservations/:id (audit log and month lock apply). Blanks stay blank.
router.post("/reservations/airbnb-breakdowns/preview", asyncHandler(async (req, res) => {
  let rows;
  try { rows = parseBreakdowns(req.body?.csv); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const codes: string[] = [...new Set(rows.map(r => r.code).filter(Boolean))];
  const bookings = codes.length ? await db.select({ r: reservationsTable, propertyName: propertiesTable.name }).from(reservationsTable).innerJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(inArray(reservationsTable.externalId, codes.map(c => `airbnb:${c}`))) : [];
  const earnings = codes.length ? await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode, codes)) : [];
  const months = [...new Set(bookings.map(b => b.r.checkOut.slice(0, 7)))];
  const locks = bookings.length ? await db.select({ propertyId: ownerStatementsTable.propertyId, month: ownerStatementsTable.month }).from(ownerStatementsTable)
    .where(and(inArray(ownerStatementsTable.propertyId, [...new Set(bookings.map(b => b.r.propertyId))]), inArray(ownerStatementsTable.month, months), ne(ownerStatementsTable.status, "draft"))) : [];
  const seen = new Map<string, number>(); for (const r of rows) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const out = [];
  for (const row of rows) {
    const matches = bookings.filter(b => b.r.externalId === `airbnb:${row.code}`);
    const blocking: string[] = [...row.errors], review: string[] = [], notes: string[] = [];
    if (seen.get(row.code)! > 1) blocking.push("This confirmation code appears more than once in the file");
    if (!matches.length) { out.push({ ...row, matched: false, blocking: blocking.length ? blocking : ["No booking with this confirmation code"], review, notes, bulkOk: false }); continue; }
    if (matches.length > 1) blocking.push("More than one booking has this confirmation code");
    const { r, propertyName } = matches[0];
    const loaded = await loadPropertyFeeSettings(db, r.propertyId);
    const currency = loaded?.settings.currency || loaded?.property.currency || "AED";
    const stored = earnings.filter(e => e.confirmationCode === row.code && Number(e.propertyId) === r.propertyId);
    const storedPayout = stored.length === 1 ? Number(stored[0].amount).toFixed(2) : null;
    if (row.guestTotal == null) blocking.push("No guest paid total in the file (a blank is not 0)");
    if (row.currency && row.currency !== currency) blocking.push(`File currency ${row.currency} differs from the property's ${currency}`);
    if (!row.currency) blocking.push("No currency in the file");
    if (["cancelled", "blocked"].includes(r.status)) blocking.push(`Booking is ${r.status}`);
    if (locks.some(l => l.propertyId === r.propertyId && l.month === r.checkOut.slice(0, 7))) blocking.push(`The ${r.checkOut.slice(0, 7)} statement for this property was already sent or paid`);
    if ((row.checkIn && row.checkIn !== r.checkIn) || (row.checkOut && row.checkOut !== r.checkOut)) review.push(`Dates differ: file ${row.checkIn} → ${row.checkOut}, booking ${r.checkIn} → ${r.checkOut}`);
    if (stored.length > 1) review.push("More than one stored Airbnb payout for this code");
    // The stored payout (Airbnb's export) is kept as Airbnb's latest figure; the file never changes it.
    const payoutCheck = storedPayout != null && stored[0].currency === row.currency ? payoutComparison(row.hostPayout, storedPayout) : "none";
    if (payoutCheck === "differs") review.push(`Payout differs: file ${row.currency} ${row.hostPayout}, stored ${stored[0].currency} ${storedPayout}`);
    if (payoutCheck === "rounding") notes.push(`Rounding difference: file ${row.currency} ${row.hostPayout}, stored ${storedPayout} (the stored figure is kept)`);
    if (storedPayout != null && stored[0].currency !== row.currency) review.push(`Stored payout is in ${stored[0].currency}, the file in ${row.currency}`);
    if (storedPayout == null && stored.length === 0) notes.push("No stored Airbnb payout to compare with");
    if (row.cohost.mentioned && row.cohost.amount == null) review.push(row.cohost.suggested != null
      ? `Co-host payout amount filled in from other fees (${row.cohost.suggested}): check it against Airbnb before ticking`
      : "Co-host payout mentioned without an amount: enter it from Airbnb");
    if (r.financeMode === "inclusive-v1") review.push("Booking is already verified; applying replaces its guest total");
    if (r.cohostPayout != null && row.cohost.amount != null && Number(r.cohostPayout).toFixed(2) !== row.cohost.amount) review.push(`Co-host payout differs from the one saved (${Number(r.cohostPayout).toFixed(2)})`);
    if (row.cleaningFee == null) notes.push(r.cleaningFee != null ? `No cleaning fee in the file; the booking keeps ${Number(r.cleaningFee).toFixed(2)}` : "No cleaning fee in the file; the property's cleaning fee setting applies");
    let preview: any = null;
    if (!blocking.length) {
      try {
        const body: any = { grossAmount: row.guestTotal, financeMode: "inclusive-v1", ...(row.cleaningFee != null ? { cleaningFee: row.cleaningFee } : {}) };
        const f = validateBooking(await prepareFinance(body, r));
        const n = (k: string) => f[k] == null ? null : Number(f[k]);
        preview = { ok: true, grossAmount: n("grossAmount"), revenue: n("revenue"), vatAmount: n("vatAmount"), tourismFee: n("tourismFee"), channelPercent: n("channelPercent"), channelAmount: n("channelAmount"),
          managementPercent: n("managementPercent"), managementAmount: n("managementAmount"), cleaningFee: n("cleaningFee"), cleaningDeducted: loaded?.settings.includeCleaning !== false, ownerAmount: n("ownerAmount") };
      } catch (e) { blocking.push((e as Error).message); }
    }
    out.push({ ...row, matched: true, reservationId: r.id, propertyId: r.propertyId, propertyName, bookingGuest: r.guestName, bookingCheckIn: r.checkIn, bookingCheckOut: r.checkOut, currencyExpected: currency,
      current: { verified: r.financeMode === "inclusive-v1", grossAmount: r.grossAmount != null ? Number(r.grossAmount) : null, cleaningFee: r.cleaningFee != null ? Number(r.cleaningFee) : null, cohostPayout: r.cohostPayout != null ? Number(r.cohostPayout) : null },
      storedPayout: storedPayout != null ? Number(storedPayout) : null, storedPayoutCurrency: stored[0]?.currency ?? null, payoutCheck,
      preview, blocking, review, notes, bulkOk: !blocking.length && !review.length });
  }
  res.json({ rows: out, summary: { rows: out.length, matched: out.filter(r => r.matched).length, unmatched: out.filter(r => !r.matched).length, clean: out.filter(r => r.bulkOk).length,
    review: out.filter(r => r.matched && !r.blocking.length && r.review.length).length, blocked: out.filter(r => r.matched && r.blocking.length).length } });
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
    return res.json({ ok: true, cleaningDeducted: loaded?.settings.includeCleaning !== false, grossAmount: n("grossAmount"), revenue: n("revenue"), vatAmount: n("vatAmount"), tourismFee: n("tourismFee"), channelPercent: n("channelPercent"), channelAmount: n("channelAmount"),
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
  for (const key of ["revenue","cleaningFee","balanceDue","cohostPayout"]) {
    if (input[key] != null) {
      if (!/^\d+(\.\d{1,2})?$/.test(String(input[key]))) throw new Error("Enter valid non-negative amounts");
      input[key] = String(input[key]);
    }
  }
  if (input.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.guestEmail)) throw new Error("Enter a valid guest email");
  return input;
}
async function saveBooking(input: any, id?: number) {
 return db.transaction(async tx => {
  const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id,Number(input.propertyId))).for("update");
  if (!property) throw new Error("Choose an existing property");
  const [existing] = id ? await tx.select().from(reservationsTable).where(eq(reservationsTable.id,id)).for("update") : [];
  const availabilityChanged = !existing || ["propertyId","checkIn","checkOut","status"].some(k=>(existing as any)[k]!==input[k]);
  if (input.status !== "cancelled" && availabilityChanged) {
   const conflicts = await tx.select({id:reservationsTable.id}).from(reservationsTable).where(and(eq(reservationsTable.propertyId,input.propertyId), ne(reservationsTable.status,"cancelled"),lt(reservationsTable.checkIn,input.checkOut),gt(reservationsTable.checkOut,input.checkIn),id ? ne(reservationsTable.id,id) : undefined));
   if (conflicts.length) throw new Error("These dates overlap an existing reservation or blocked dates");
  }
  const locked = await tx.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(inArray(ownerStatementsTable.propertyId,[input.propertyId,...(existing?[existing.propertyId]:[])]),inArray(ownerStatementsTable.month,[input.checkOut.slice(0,7),...(existing?[existing.checkOut.slice(0,7)]:[])]),ne(ownerStatementsTable.status,"draft")));
  if (locked.length && (!existing || ["propertyId","financeMode","grossAmount","revenue","managementPercent","managementAmount","cleaningFee","channelPercent","channelAmount","vatRate","vatAmount","tourismRate","tourismFee","ownerAmount","cohostPayout","checkIn","checkOut","status"].some(k=>String((existing as any)[k])!==String(input[k])))) throw new Error("This booking belongs to a published statement. Finance changes require an adjustment.");
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
  } else if (!tasks.length) {
   await tx.insert(cleaningTasksTable).values({propertyId:row.propertyId,reservationId:row.id,status:"dirty",scheduledDate:row.checkOut,scheduledTime:"11:00"});
  } else {
   for (const task of tasks) if (!["approved","completed"].includes(task.status)) await tx.update(cleaningTasksTable).set({propertyId:row.propertyId,scheduledDate:row.checkOut,status:task.status==="cancelled"?"dirty":task.status}).where(eq(cleaningTasksTable.id,task.id));
  }
  return row;
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
