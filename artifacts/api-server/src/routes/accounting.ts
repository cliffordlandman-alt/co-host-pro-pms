import { refreshOwnerStatements, duplicateOwnerStatements } from "../lib/owner-statements";
import { dubaiToday } from "../lib/dubai-date";
import { companyStatement } from "../../../../lib/company-statement.mjs";
import { airbnbEarningsTable } from "@workspace/db";
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  insertAccountingTransactionSchema,
  propertySettingsTable,
  accountingTransactionsTable,
  ownerStatementsTable,
  propertiesTable,
  reservationsTable,
  maintenanceTicketsTable,
  paymentsTable,
  ownersTable,
} from "@workspace/db";
import { eq, and, gte, lte, ne, sql, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { pageParams, paged } from "../lib/paging";
import { parseId } from "../lib/parseId";
import { defaultFeeSettings } from "../lib/fee-config";
import { backfillCleaningExpenses, cleaningVendor, unitLabel } from "../lib/cleaning-costs";
import { insertAuditLog } from "../lib/audit";
import { changePropertyCurrency, CurrencyChangeRefused } from "../lib/property-currency";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { cleaningCostRatesTable, vendorsTable, usersTable, ownerPayoutsTable } from "@workspace/db";

const router = Router();

// ── Validation schema for property accounting settings ────────────────────────

// Coerce numbers to strings so Drizzle decimal columns always receive string values
const toDecimalStr = z.coerce.number().finite().min(0).max(100).transform(String).optional();

const accountingSettingsSchema = z.object({
  tourismRate: z.coerce.number().finite().min(0).max(1000).transform(String).optional(),
  tourismEnabled: z.boolean().optional(),
  vatEnabled: z.boolean().optional(),
  tourismConfirmed: z.boolean().optional(),
  vatConfirmed: z.boolean().optional(),
  managementFeePercent: toDecimalStr,
  platformFeeAirbnb: toDecimalStr,
  platformFeeBookingCom: toDecimalStr,
  platformFeeDirect: toDecimalStr,
  platformFeeVrbo: toDecimalStr,
  ownerSplitPercent: toDecimalStr,
  vatPercent: toDecimalStr,
  includeCleaning: z.boolean().optional(),
  includeMaintenance: z.boolean().optional(),
  cohostPaidToOwner: z.boolean().optional(),
  payoutToOwner: z.boolean().optional(),
  feeBasis: z.enum(["gross", "net-payout", "airbnb-payout"]).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as AED or ZAR").optional(),
  cleaningFee: z.union([z.null(), z.coerce.number().finite().min(0).max(100000).transform(n => n.toFixed(2))]).optional(),
  cleaningCostOverride: z.union([z.null(), z.coerce.number().finite().min(0).max(100000).transform(n => n.toFixed(2))]).optional(),
  cleaningRateCard: z.boolean().optional(),
  cleaningCostCurrency: z.union([z.null(), z.literal("").transform(() => null), z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as AED or ZAR")]).optional(),
}).strict();

// ── Property Settings ──────────────────────────────────────────────────────────

router.get("/accounting/settings", asyncHandler(async (_req, res) => {
  const rows = await db
    .select({
      tourismRate: propertySettingsTable.tourismRate,
      tourismEnabled: propertySettingsTable.tourismEnabled,
      vatEnabled: propertySettingsTable.vatEnabled,
      tourismConfirmed: propertySettingsTable.tourismConfirmed,
      vatConfirmed: propertySettingsTable.vatConfirmed,
      id: propertySettingsTable.id,
      propertyId: propertySettingsTable.propertyId,
      propertyName: propertiesTable.name,
      managementFeePercent: propertySettingsTable.managementFeePercent,
      platformFeeAirbnb: propertySettingsTable.platformFeeAirbnb,
      platformFeeBookingCom: propertySettingsTable.platformFeeBookingCom,
      platformFeeDirect: propertySettingsTable.platformFeeDirect,
      platformFeeVrbo: propertySettingsTable.platformFeeVrbo,
      vatPercent: propertySettingsTable.vatPercent,
      includeCleaning: propertySettingsTable.includeCleaning,
      includeMaintenance: propertySettingsTable.includeMaintenance,
      cohostPaidToOwner: propertySettingsTable.cohostPaidToOwner,
      payoutToOwner: propertySettingsTable.payoutToOwner,
      feeBasis: propertySettingsTable.feeBasis,
      currency: propertySettingsTable.currency,
      cleaningCostOverride: propertySettingsTable.cleaningCostOverride,
      cleaningRateCard: propertySettingsTable.cleaningRateCard,
      cleaningCostCurrency: propertySettingsTable.cleaningCostCurrency,
      propertyCurrency: propertiesTable.currency,
      cleaningFee: propertySettingsTable.cleaningFee,
    })
    .from(propertySettingsTable)
    .leftJoin(propertiesTable, eq(propertySettingsTable.propertyId, propertiesTable.id));

  const allProps = await db.select().from(propertiesTable);
  const withSettings = allProps.map(p => {
    const s = rows.find(r => r.propertyId === p.id);
    return s ?? { ...defaultFeeSettings(p), propertyName: p.name, propertyCurrency: p.currency };
  });

  res.json(withSettings.map(r => ({
    ...r,
    managementFeePercent: parseFloat(r.managementFeePercent || "20"),
    platformFeeAirbnb: parseFloat(r.platformFeeAirbnb || "3"),
    platformFeeBookingCom: parseFloat(r.platformFeeBookingCom || "15"),
    platformFeeDirect: parseFloat(r.platformFeeDirect || "0"),
    platformFeeVrbo: parseFloat(r.platformFeeVrbo || "0"),
    vatPercent: parseFloat(r.vatPercent || "5"),
    cleaningCostOverride: r.cleaningCostOverride == null ? null : parseFloat(r.cleaningCostOverride),
    cleaningFee: r.cleaningFee == null ? null : parseFloat(r.cleaningFee),
  })));
}));

/**
 * "Include cleaning costs" decides whether the booking's cleaning fee is deducted from the owner's share.
 * The owner statement applies the property's current setting, so when it changes, every verified booking
 * of the property is brought in line: owner amount = net - management - channel - (cleaning if included).
 * Rates are not touched. Bookings in months whose statement is already sent or paid are left as they are
 * (those statements are locked) and counted in the response.
 */
async function applyIncludeCleaning(tx: any, propertyId: number, include: boolean) {
  const locked = new Set((await tx.select({ month: ownerStatementsTable.month }).from(ownerStatementsTable)
    .where(and(eq(ownerStatementsTable.propertyId, propertyId), ne(ownerStatementsTable.status, "draft")))).map((r: any) => r.month));
  const bookings = await tx.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId, propertyId), eq(reservationsTable.financeMode, "inclusive-v1")));
  const c = (v: unknown) => Math.round(Number(v || 0) * 100);
  let updated = 0, skipped = 0;
  for (const b of bookings) {
    if (locked.has(String(b.checkOut).slice(0, 7))) { skipped++; continue; }
    const owner = c(b.revenue) - c(b.managementAmount) - c(b.channelAmount) - (include ? c(b.cleaningFee) : 0);
    if (owner === c(b.ownerAmount)) continue;
    await tx.update(reservationsTable).set({ ownerAmount: (owner / 100).toFixed(2) }).where(eq(reservationsTable.id, b.id));
    updated++;
  }
  return { updated, locked: skipped };
}

router.put("/accounting/settings/:propertyId", asyncHandler(async (req, res) => {
  const propertyId = parseId(req.params.propertyId);
  if (propertyId === null) return res.status(400).json({ error: "Invalid propertyId" });

  const parsed = accountingSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { ownerSplitPercent: _unused, ...data } = parsed.data; // owner share is derived from the management %
  const { currency, ...rest } = data;
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  let result: any;
  try {
    result = await db.transaction(async tx => {
      // A currency change never relabels recorded amounts (lib/property-currency.ts); refused as a whole otherwise.
      const cur = currency !== undefined ? await changePropertyCurrency(tx, propertyId, currency, { cleaningFeeGiven: rest.cleaningFee !== undefined }) : null;
      const [existing] = await tx.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, propertyId));
      if (existing) {
        const [row] = await tx.update(propertySettingsTable)
          .set({ ...rest, ...(currency !== undefined ? { currency } : {}), updatedAt: new Date() })
          .where(eq(propertySettingsTable.propertyId, propertyId))
          .returning();
        const changed = rest.includeCleaning !== undefined && rest.includeCleaning !== (existing.includeCleaning !== false);
        return { row, created: false, cur, cleaning: changed ? await applyIncludeCleaning(tx, propertyId, rest.includeCleaning !== false) : null };
      }
      const d = defaultFeeSettings(property);
      const [row] = await tx.insert(propertySettingsTable).values({ propertyId, tourismEnabled: d.tourismEnabled, vatEnabled: d.vatEnabled, currency: currency ?? d.currency, cleaningRateCard: d.cleaningRateCard, ...rest }).returning();
      return { row, created: true, cur, cleaning: null };
    });
  } catch (e) {
    if (e instanceof CurrencyChangeRefused) return res.status(409).json({ error: e.message });
    throw e;
  }
  await insertAuditLog({ action: "update", entity: "property_settings", entityId: propertyId, details: data, performedBy: req.headers["x-user-id"] as string });
  if (result.cur?.changed) await insertAuditLog({ action: "update", entity: "property_currency", entityId: propertyId, details: result.cur, performedBy: req.headers["x-user-id"] as string });
  const extra = { ...(result.cleaning ? { bookingsRecalculated: result.cleaning.updated, bookingsInPublishedMonths: result.cleaning.locked } : {}), ...(result.cur?.changed ? { currencyChange: result.cur } : {}) };
  return res.status(result.created ? 201 : 200).json({ ...result.row, ...extra });
}));

// ── Transactions ───────────────────────────────────────────────────────────────

router.get("/accounting/transactions", asyncHandler(async (req, res) => {
  const { propertyId, month } = req.query as { propertyId?: string; month?: string };
  const conditions = [];
  if (propertyId) conditions.push(eq(accountingTransactionsTable.propertyId, parseInt(propertyId)));
  if (month) {
    conditions.push(gte(accountingTransactionsTable.date, `${month}-01`));
    conditions.push(lte(accountingTransactionsTable.date, `${month}-31`));
  }

  const rows = await db
    .select({
      id: accountingTransactionsTable.id,
      date: accountingTransactionsTable.date,
      propertyId: accountingTransactionsTable.propertyId,
      reservationId: accountingTransactionsTable.reservationId,
      propertyName: propertiesTable.name,
      type: accountingTransactionsTable.type,
      category: accountingTransactionsTable.category,
      description: accountingTransactionsTable.description,
      amount: accountingTransactionsTable.amount,
      currency: accountingTransactionsTable.currency,
      allocation: accountingTransactionsTable.allocation,
      revenueStream: accountingTransactionsTable.revenueStream,
      reference: accountingTransactionsTable.reference,
      vendorId: accountingTransactionsTable.vendorId,
      vendorName: vendorsTable.name,
      cleaningTaskId: accountingTransactionsTable.cleaningTaskId,
      notes: accountingTransactionsTable.notes,
      treatment: accountingTransactionsTable.treatment,
      fxRate: accountingTransactionsTable.fxRate,
      paymentStatus: accountingTransactionsTable.paymentStatus,
      directCost: accountingTransactionsTable.directCost,
      payer: accountingTransactionsTable.payer,
      reportCategory: accountingTransactionsTable.reportCategory,
      reportSource: accountingTransactionsTable.reportSource,
      reportProperty: accountingTransactionsTable.reportProperty,
      forecastLabel: accountingTransactionsTable.forecastLabel,
      reportDescription: accountingTransactionsTable.reportDescription,
      reportOrder: accountingTransactionsTable.reportOrder,
      createdAt: accountingTransactionsTable.createdAt,
    })
    .from(accountingTransactionsTable)
    .leftJoin(propertiesTable, eq(accountingTransactionsTable.propertyId, propertiesTable.id))
    .leftJoin(vendorsTable, eq(accountingTransactionsTable.vendorId, vendorsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${accountingTransactionsTable.date} DESC`);

  res.json(rows.map(r => ({ ...r, amount: parseFloat(r.amount || "0"), fxRate: r.fxRate == null ? null : Number(r.fxRate), directCost: r.directCost == null ? null : Number(r.directCost), createdAt: r.createdAt.toISOString() })));
}));

// Sent or paid owner statement covering this property and month (owner entries there can't change).
async function publishedStatement(propertyId: number | null | undefined, date: string | null | undefined) {
  if (!propertyId || !date) return null;
  const [st] = await db.select({ id: ownerStatementsTable.id, status: ownerStatementsTable.status, month: ownerStatementsTable.month, propertyName: propertiesTable.name })
    .from(ownerStatementsTable).leftJoin(propertiesTable, eq(ownerStatementsTable.propertyId, propertiesTable.id))
    .where(and(eq(ownerStatementsTable.propertyId, Number(propertyId)), eq(ownerStatementsTable.month, String(date).slice(0, 7)), ne(ownerStatementsTable.status, "draft")));
  return st ?? null;
}
const lockedMessage = (st: { status: string; month: string; propertyName: string | null }) =>
  `This entry is on the ${st.month} owner statement for ${st.propertyName ?? "this property"}, which has been ${st.status === "paid" ? "paid" : "sent"}, so it can't be changed. Record a correction in an open month instead.`;
// Entries written by the system (cleaning costs, maintenance charges) are changed at their source, not here.
const automaticEntry = (e: { cleaningTaskId?: number | null; reference?: string | null }) => e.cleaningTaskId != null || /^(cleaning|maintenance):/.test(e.reference ?? "");
const EDITABLE_ENTRY_FIELDS = ["type", "amount", "date", "category", "propertyId", "allocation", "revenueStream", "notes", "description", "reference", "currency", "reservationId", "treatment", "fxRate", "paymentStatus", "directCost", "payer", "reportCategory", "reportSource", "reportProperty", "forecastLabel", "reportDescription", "reportOrder"] as const;
const money = (r: any) => ({ ...r, amount: parseFloat(r.amount || "0"), fxRate: r.fxRate == null ? null : Number(r.fxRate), directCost: r.directCost == null ? null : Number(r.directCost), createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt });
/** USD/AED is fixed (YALLA rule 7). */
export const USD_AED_RATE = 3.6725;
export const SALARY_CATEGORY = "Salary";

/**
 * YALLA workbook fields (migration 0025): accounting treatment, FX rate and payment status.
 * treatment: company | owner_paid | pass_through, or null = follow allocation (behaviour before 0025).
 * owner_paid always means "charged to the owner"; company and pass_through are company allocation.
 * Salary is a company operating expense. USD carries the fixed 3.6725 rate; ZAR never has a rate.
 */
function applyFinanceFields(input: any): string | null {
  for (const k of ["treatment", "fxRate", "paymentStatus"]) if (input[k] === "" || input[k] === undefined) input[k] = null;
  if (input.treatment != null && !["company", "owner_paid", "pass_through"].includes(input.treatment)) return "Treatment must be company, owner paid or pass-through";
  if (input.type !== "expense" && input.treatment != null && input.treatment !== "company") return "Owner paid and pass-through apply to expenses only";
  if (input.treatment === "owner_paid") input.allocation = "owner";
  if (input.treatment === "company" || input.treatment === "pass_through") input.allocation = "company";
  if (String(input.category || "").trim().toLowerCase() === SALARY_CATEGORY.toLowerCase()) {
    input.category = SALARY_CATEGORY;
    if (input.type !== "expense") return "Salary is an expense";
    if (input.treatment && input.treatment !== "company") return "Salary is a company operating expense (not owner paid or pass-through)";
    input.allocation = "company"; input.treatment = "company"; input.propertyId = null; input.reservationId = null;
  }
  if (input.paymentStatus != null && !["paid", "pending", "unpaid", "none"].includes(input.paymentStatus)) return "Payment status must be paid, pending, unpaid or none";
  // Migration 0026: Income Input direct cost and payer (income only), and the master workbook category override.
  for (const k of ["directCost", "payer", "reportCategory", "reportSource", "reportProperty", "forecastLabel", "reportDescription"]) { if (typeof input[k] === "string") input[k] = input[k].trim(); if (input[k] === "" || input[k] === undefined) input[k] = null; }
  if (input.type !== "income" && (input.directCost != null || input.payer != null)) return "Direct cost and payer apply to income only";
  if (input.directCost != null) {
    const n = Number(input.directCost);
    if (!Number.isFinite(n) || n < 0 || !/^\d+(\.\d{1,2})?$/.test(String(input.directCost))) return "Direct cost must be zero or more, with at most 2 decimals";
    if (n > Number(input.amount)) return "Direct cost can't be more than the amount";
    input.directCost = n.toFixed(2);
  }
  if (input.payer != null && String(input.payer).length > 80) return "Payer is at most 80 characters";
  if (input.reportCategory != null && String(input.reportCategory).length > 40) return "Workbook category is at most 40 characters";
  if (input.reportSource != null && String(input.reportSource).length > 60) return "Workbook source is at most 60 characters";
  if (input.type !== "income" && (input.reportProperty != null || input.forecastLabel != null)) return "Workbook property and forecast label apply to income only";
  if (input.reportProperty != null && input.propertyId) return "Workbook property is only for income with no property";
  if (input.reportProperty != null && String(input.reportProperty).length > 60) return "Workbook property is at most 60 characters";
  if (input.forecastLabel != null && String(input.forecastLabel).length > 80) return "Forecast label is at most 80 characters";
  if (input.reportDescription != null && String(input.reportDescription).length > 120) return "Workbook description is at most 120 characters";
  if (input.reportOrder === "" || input.reportOrder === undefined) input.reportOrder = null;
  if (input.reportOrder != null) { const n = Number(input.reportOrder); if (!Number.isInteger(n) || n < 1 || n > 999) return "Workbook order must be a whole number from 1 to 999"; input.reportOrder = n; }
  return null;
}
/** Runs once the entry's currency is known. */
function applyFxRate(input: any): string | null {
  const cur = String(input.currency || "AED");
  if (input.fxRate != null) { const n = Number(input.fxRate); if (!Number.isFinite(n) || n <= 0) return "Enter a positive exchange rate"; input.fxRate = n; }
  if (cur === "AED") input.fxRate = null;
  else if (cur === "USD") { if (input.fxRate != null && Math.abs(input.fxRate - USD_AED_RATE) > 1e-9) return `USD is fixed at ${USD_AED_RATE} AED`; input.fxRate = USD_AED_RATE; }
  else if (cur === "ZAR") { if (input.fxRate != null) return "ZAR is kept separate from AED: no exchange rate"; }
  if (input.fxRate != null) input.fxRate = String(input.fxRate);
  return null;
}

/** The one set of rules for a manual income or expense entry (used by add and edit). */
async function validateEntry(body: any, existingCurrency?: string | null): Promise<{ input: any } | { status: number; error: string }> {
  const input = { ...body, amount: String(body.amount) };
  if (input.propertyId === "" || input.propertyId === undefined) input.propertyId = null;
  if (input.reservationId === "" || input.reservationId === undefined) input.reservationId = null;
  const finErr = applyFinanceFields(input); if (finErr) return { status: 400, error: finErr };
  if(input.reservationId){const [b]=await db.select().from(reservationsTable).where(eq(reservationsTable.id,Number(input.reservationId)));if(!b)return {status:400,error:'Booking not found'};if(input.propertyId&&Number(input.propertyId)!==b.propertyId)return {status:400,error:'Booking and property must match'};input.propertyId=b.propertyId;}
  input.allocation ??= input.treatment === 'owner_paid' ? 'owner' : input.treatment ? 'company' : input.propertyId ? 'owner' : 'company';
  if (input.revenueStream !== undefined && input.revenueStream !== null && typeof input.revenueStream !== 'boolean') return {status:400,error:'Revenue stream must be yes, no or not tagged'};
  if (input.type !== 'expense') input.revenueStream = null;
  if (!['income','expense'].includes(input.type) || !['company','owner'].includes(input.allocation)) return {status:400,error:'Choose income or expense and company or owner allocation'};
  if(input.propertyId){const [p]=await db.select().from(propertiesTable).where(eq(propertiesTable.id,Number(input.propertyId)));if(!p)return {status:400,error:'Property not found'};// An owner expense is in the property's currency, or in its booking's (a booking kept in the currency it was
   // recorded in), or keeps its own when edited; never another currency on the owner's statement.
   const [booking]=input.reservationId?await db.select().from(reservationsTable).where(eq(reservationsTable.id,Number(input.reservationId))):[];
   const home=booking?bookingCurrency(booking,p):(p.currency||'AED');
   input.currency ??= home;
   if(input.allocation==='owner'&&![p.currency||'AED',home,...(existingCurrency?[existingCurrency]:[])].includes(input.currency))return {status:400,error:'Owner expenses must use the property currency (or the booking\'s)'};}
  input.currency ??= 'AED';
  const fxErr = applyFxRate(input); if (fxErr) return { status: 400, error: fxErr };
  if(!/^[A-Z]{3}$/.test(input.currency)||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)return {status:400,error:'Enter a valid date, currency and positive amount'};
  if(input.allocation==='owner'&&!input.propertyId)return {status:400,error:'Choose a property for owner expenses'};
  if(input.allocation==='owner'&&input.type==='income')return {status:400,error:'Use company allocation for additional income; owner income adjustments are not supported yet'};
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date || "") || !input.description?.trim()) return {status:400,error:"Valid date, description and non-negative amount required"};
  return { input };
}

router.post("/accounting/transactions", asyncHandler(async (req, res) => {
  const v = await validateEntry(req.body);
  if ("error" in v) return res.status(v.status).json({ error: v.error });
  const { input } = v;
  if(input.allocation==='owner'&&await publishedStatement(input.propertyId,input.date))return res.status(409).json({error:'This owner month is published; use an adjustment in an open month'});
  const parsed = insertAccountingTransactionSchema.safeParse(input);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db.insert(accountingTransactionsTable).values(parsed.data).returning();
  await insertAuditLog({ action: "create", entity: "accounting_transaction", entityId: row.id, details: { after: money(row) }, performedBy: req.headers["x-user-id"] as string });
  res.status(201).json(money(row));
}));

// Edit a manual entry in place. Same rules as adding one; the Activity Log keeps the before and after.
router.patch("/accounting/transactions/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  if (automaticEntry(existing)) return res.status(400).json({ error: "This entry was recorded automatically (cleaning or maintenance). Change it at its source, not here." });
  const before = await publishedStatement(existing.allocation === "owner" ? existing.propertyId : null, existing.date);
  if (before) return res.status(409).json({ error: lockedMessage(before) });
  const merged: any = {};
  for (const f of EDITABLE_ENTRY_FIELDS) merged[f] = req.body[f] !== undefined ? req.body[f] : (existing as any)[f];
  // Changing only "charge to" moves an explicit treatment with it (owner → owner paid; company keeps pass-through).
  if (req.body.allocation !== undefined && req.body.treatment === undefined && existing.treatment) {
    if (req.body.allocation === "owner") merged.treatment = "owner_paid";
    else if (existing.treatment === "owner_paid") merged.treatment = "company";
  }
  if (req.body.currency !== undefined && req.body.fxRate === undefined) merged.fxRate = null;
  if (/^(cleaning|maintenance):/.test(merged.reference ?? "")) return res.status(400).json({ error: "That reference is reserved for automatic entries" });
  const v = await validateEntry(merged, Number(merged.propertyId) === Number(existing.propertyId) ? existing.currency : null);
  if ("error" in v) return res.status(v.status).json({ error: v.error });
  const { input } = v;
  const after = await publishedStatement(input.allocation === "owner" ? input.propertyId : null, input.date);
  if (after) return res.status(409).json({ error: lockedMessage(after) });
  const parsed = insertAccountingTransactionSchema.partial().safeParse(input);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const changes: any = {};
  for (const f of EDITABLE_ENTRY_FIELDS) changes[f] = (parsed.data as any)[f] ?? null;
  const [row] = await db.update(accountingTransactionsTable).set(changes).where(eq(accountingTransactionsTable.id, id)).returning();
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of EDITABLE_ENTRY_FIELDS) { const a = (existing as any)[f] ?? null, b = (row as any)[f] ?? null; if (String(a) !== String(b)) diff[f] = { from: a, to: b }; }
  await insertAuditLog({ action: "update", entity: "accounting_transaction", entityId: id, details: { changed: diff, before: money(existing), after: money(row) }, performedBy: req.headers["x-user-id"] as string });
  res.json(money(row));
}));

router.delete("/accounting/transactions/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [entry]=await db.select().from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id,id));
  if(entry?.allocation==='owner'&&await publishedStatement(entry.propertyId,entry.date))return res.status(409).json({error:'Published owner expenses cannot be deleted'});
  await db.delete(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id));
  if (entry) await insertAuditLog({ action: "delete", entity: "accounting_transaction", entityId: id, details: { before: money(entry) }, performedBy: req.headers["x-user-id"] as string });
  return res.status(204).send();
}));

// ── Cleaning costs (company expense paid to the cleaning company) ─────────────
router.get("/accounting/cleaning-costs", asyncHandler(async (_req, res) => {
  const [vendor, rates] = await Promise.all([cleaningVendor(db), db.select().from(cleaningCostRatesTable).orderBy(cleaningCostRatesTable.bedrooms)]);
  res.json({ vendor, rates: rates.map(r => ({ bedrooms: r.bedrooms, label: unitLabel(r.bedrooms), amount: Number(r.amount), currency: r.currency })) });
}));

const rateCardSchema = z.object({
  vendorName: z.string().trim().min(1).max(120).optional(),
  rates: z.array(z.object({ bedrooms: z.number().int().min(0).max(20), amount: z.union([z.null(), z.coerce.number().finite().min(0).max(100000)]) })).max(21).optional(),
}).strict();

router.put("/accounting/cleaning-costs", asyncHandler(async (req, res) => {
  const parsed = rateCardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a whole bedroom count (0 = studio) and a non-negative amount for each rate" });
  await db.transaction(async tx => {
    if (parsed.data.vendorName) {
      const vendor = await cleaningVendor(tx);
      if (vendor) await tx.update(vendorsTable).set({ name: parsed.data.vendorName }).where(eq(vendorsTable.id, vendor.id));
      else await tx.insert(vendorsTable).values({ name: parsed.data.vendorName, kind: "cleaning" });
    }
    for (const r of parsed.data.rates ?? []) {
      if (r.amount == null) await tx.delete(cleaningCostRatesTable).where(eq(cleaningCostRatesTable.bedrooms, r.bedrooms));
      else await tx.insert(cleaningCostRatesTable).values({ bedrooms: r.bedrooms, amount: r.amount.toFixed(2) })
        .onConflictDoUpdate({ target: cleaningCostRatesTable.bedrooms, set: { amount: r.amount.toFixed(2), updatedAt: new Date() } });
    }
  });
  await insertAuditLog({ action: "update", entity: "cleaning_cost_rates", entityId: 0, details: parsed.data, performedBy: req.headers["x-user-id"] as string });
  const [vendor, rates] = await Promise.all([cleaningVendor(db), db.select().from(cleaningCostRatesTable).orderBy(cleaningCostRatesTable.bedrooms)]);
  return res.json({ vendor, rates: rates.map(r => ({ bedrooms: r.bedrooms, label: unitLabel(r.bedrooms), amount: Number(r.amount), currency: r.currency })) });
}));

// Record cleaning expenses for all checkouts in the last N days or a given month (Dubai dates). Preview is
// the default; recording requires an administrator. Safe to run repeatedly: each checkout is expensed once.
router.post("/accounting/cleaning-expenses/backfill", asyncHandler(async (req, res) => {
  // Period: a calendar month (month=YYYY-MM, capped at today), or the last N days (days, default 30).
  const month = req.body?.month;
  if (month != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) return res.status(400).json({ error: "Month must look like 2026-09" });
  const days = req.body?.days == null ? 30 : Number(req.body.days);
  if (month == null && (!Number.isInteger(days) || days < 1 || days > 366)) return res.status(400).json({ error: "Choose between 1 and 366 days" });
  const dryRun = req.body?.dryRun !== false;
  if (!dryRun) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, Number(req.headers["x-user-id"])));
    if (!user || !["admin", "super_admin"].includes(user.role)) return res.status(403).json({ error: "Only an administrator can record cleaning expenses in bulk" });
  }
  const result = await backfillCleaningExpenses({ days, month: month ?? undefined, dryRun });
  if (result.error) return res.status(400).json({ error: result.error });
  if (!dryRun) await insertAuditLog({ action: "create", entity: "cleaning_expense_backfill", entityId: 0, details: { days: month ? null : days, month: month ?? null, recorded: result.recorded, from: result.from, to: result.to }, performedBy: req.headers["x-user-id"] as string });
  return res.json(result);
}));

router.get('/accounting/company-statement',asyncHandler(async(req,res)=>{
 const end=String(req.query.end || dubaiToday());const start=String(req.query.start || '0001-01-01');
 if(![start,end].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)||start>end)return res.status(400).json({error:'Invalid statement date range'});
 const [settings,earnings,bookings,transactions,properties,maintenance]=await Promise.all([db.select().from(propertySettingsTable),db.select().from(airbnbEarningsTable),db.select().from(reservationsTable),db.select().from(accountingTransactionsTable),db.select().from(propertiesTable),db.select().from(maintenanceTicketsTable)]);
 res.json(companyStatement({earnings,bookings,transactions,properties,maintenance,settings},start,end));
}));

// ── Owner Statements ───────────────────────────────────────────────────────────

router.get("/accounting/statements", asyncHandler(async (req, res) => {
  const drafts=await db.select({month:ownerStatementsTable.month}).from(ownerStatementsTable).where(eq(ownerStatementsTable.status,"draft"));
  for(const month of new Set(drafts.map(d=>d.month))) await refreshOwnerStatements(month);
  const { month, ownerId, status, propertyId } = req.query as { month?: string; ownerId?: string; status?: string; propertyId?: string };
  const p = pageParams(req.query as Record<string, unknown>);
  const conds = [];
  if (month) conds.push(eq(ownerStatementsTable.month, month));
  if (ownerId) conds.push(eq(ownerStatementsTable.ownerId, parseInt(ownerId)));
  if (p && status && status !== "all") conds.push(eq(ownerStatementsTable.status, status));
  if (p && propertyId) conds.push(eq(ownerStatementsTable.propertyId, parseInt(propertyId)));
  const where = conds.length ? and(...conds) : undefined;
  let summary: unknown = null, total = 0;
  if (p) {
    // Totals per currency over every statement that matches the filters, not just the visible page.
    const cur = sql<string>`coalesce(${ownerStatementsTable.currency}, 'AED')`;
    const agg = await db.select({
      currency: cur,
      count: sql<number>`count(*)::int`,
      grossRevenue: sql<string>`coalesce(sum(${ownerStatementsTable.grossRevenue}),0)`,
      managementFee: sql<string>`coalesce(sum(${ownerStatementsTable.managementFee}),0)`,
      ownerPayout: sql<string>`coalesce(sum(${ownerStatementsTable.ownerPayout}),0)`,
    }).from(ownerStatementsTable).where(where).groupBy(cur).orderBy(cur);
    total = agg.reduce((n, a) => n + a.count, 0);
    summary = { total, currencies: agg.map(a => ({ currency: a.currency, count: a.count, grossRevenue: Number(a.grossRevenue), managementFee: Number(a.managementFee), ownerPayout: Number(a.ownerPayout) })) };
  }

  const query = db
    .select({
      tourismFee: ownerStatementsTable.tourismFee,
      bookingDetails: ownerStatementsTable.bookingDetails,
      currency: ownerStatementsTable.currency,
      id: ownerStatementsTable.id,
      ownerId: ownerStatementsTable.ownerId,
      propertyId: ownerStatementsTable.propertyId,
      propertyName: propertiesTable.name,
      ownerName: ownersTable.name,
      month: ownerStatementsTable.month,
      grossRevenue: ownerStatementsTable.grossRevenue,
      platformFees: ownerStatementsTable.platformFees,
      managementFee: ownerStatementsTable.managementFee,
      cleaningCosts: ownerStatementsTable.cleaningCosts,
      maintenanceCosts: ownerStatementsTable.maintenanceCosts,
      otherExpenses: ownerStatementsTable.otherExpenses,
      vatAmount: ownerStatementsTable.vatAmount,
      ownerPayout: ownerStatementsTable.ownerPayout,
      paidByAirbnb: ownerStatementsTable.paidByAirbnb,
      feeBasis: ownerStatementsTable.feeBasis,
      nightsOccupied: ownerStatementsTable.nightsOccupied,
      bookingsCount: ownerStatementsTable.bookingsCount,
      status: ownerStatementsTable.status,
      sentAt: ownerStatementsTable.sentAt,
      paidAt: ownerStatementsTable.paidAt,
      notes: ownerStatementsTable.notes,
      createdAt: ownerStatementsTable.createdAt,
      autoGeneratedAt: ownerStatementsTable.autoGeneratedAt,
      emailedAt: ownerStatementsTable.emailedAt,
    })
    .from(ownerStatementsTable)
    .leftJoin(propertiesTable, eq(ownerStatementsTable.propertyId, propertiesTable.id))
    .leftJoin(ownersTable, eq(ownerStatementsTable.ownerId, ownersTable.id))
    .where(where)
    .orderBy(sql`${ownerStatementsTable.month} DESC, ${propertiesTable.name} ASC, ${ownerStatementsTable.id} ASC`);
  const rows = p ? await query.limit(p.pageSize).offset(p.offset) : await query;

  const items = rows.map(r => ({
    ...r,
    tourismFee: Number(r.tourismFee || 0),
    grossRevenue: parseFloat(r.grossRevenue || "0"),
    platformFees: parseFloat(r.platformFees || "0"),
    managementFee: parseFloat(r.managementFee || "0"),
    cleaningCosts: parseFloat(r.cleaningCosts || "0"),
    maintenanceCosts: parseFloat(r.maintenanceCosts || "0"),
    otherExpenses: parseFloat(r.otherExpenses || "0"),
    vatAmount: parseFloat(r.vatAmount || "0"),
    ownerPayout: parseFloat(r.ownerPayout || "0"),
    paidByAirbnb: parseFloat(r.paidByAirbnb || "0"),
    createdAt: r.createdAt.toISOString(),
  }));
  const payouts = await payoutsFor(items.map(i => i.id));
  const withPayouts = items.map(i => { const list = payouts.filter(x => x.statementId === i.id); return { ...i, payouts: list, paidTotal: list.reduce((n, x) => n + Math.round(x.amount * 100), 0) / 100 }; });
  res.json(p ? paged(withPayouts, total, p, summary) : withPayouts);
}));

// Property/month pairs holding more than one statement (only possible in data from before the unique rule).
router.get("/accounting/statements/duplicates", asyncHandler(async (_req, res) => {
  res.json(await duplicateOwnerStatements());
}));

router.post("/accounting/statements/generate", asyncHandler(async (req,res)=>{
 const {month} = req.body;
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return res.status(400).json({error:"Valid month required (YYYY-MM)"});
 // Optional: one property only (any month, e.g. a past month of an owner's history).
 const propertyId = req.body?.propertyId == null || req.body.propertyId === "" ? null : parseId(String(req.body.propertyId));
 if (req.body?.propertyId != null && req.body.propertyId !== "" && propertyId === null) return res.status(400).json({error:"Invalid property"});
 const result=await refreshOwnerStatements(month, propertyId ? { propertyIds: [propertyId] } : {});
 return res.json(result);
}));

// ── Owner payouts: money paid against a statement, with date, method and bank reference ──
export const PAYOUT_METHODS = ["bank_transfer", "cash", "cheque", "other"] as const;
async function payoutsFor(statementIds: number[]) {
  if (!statementIds.length) return [];
  const rows = await db.select().from(ownerPayoutsTable).where(inArray(ownerPayoutsTable.statementId, statementIds)).orderBy(ownerPayoutsTable.paidOn, ownerPayoutsTable.id);
  return rows.map(r => ({ id: r.id, statementId: r.statementId, amount: Number(r.amount), currency: r.currency, paidOn: r.paidOn, method: r.method, reference: r.reference, notes: r.notes, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() }));
}
const statementSettled = (s: { paidByAirbnb: string | null; ownerPayout: string | null }) => Number(s.paidByAirbnb) > 0 && Math.abs(Math.round(Number(s.ownerPayout) * 100)) < 100;
const payoutSchema = z.object({
  amount: z.coerce.number().finite().positive("Enter the amount paid").refine(n => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimals"),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the money was paid"),
  method: z.enum(PAYOUT_METHODS, { message: "Choose how it was paid" }),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const money2 = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

router.get("/accounting/statements/:id/payouts", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  res.json(await payoutsFor([id]));
}));

router.post("/accounting/statements/:id/payouts", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid payout" });
  const v = parsed.data, reference = v.reference || null, notes = v.notes || null;
  if (new Date(v.paidOn + "T00:00:00Z").toISOString().slice(0, 10) !== v.paidOn) return res.status(400).json({ error: "Enter a real date" });
  if (v.paidOn > dubaiToday()) return res.status(400).json({ error: "The payout date can't be in the future" });
  if ((v.method === "bank_transfer") && !reference) return res.status(400).json({ error: "Enter the bank reference for the transfer" });
  if ((v.method === "cheque") && !reference) return res.status(400).json({ error: "Enter the cheque number" });
  if (v.method === "other" && !reference && !notes) return res.status(400).json({ error: "Say how it was paid (reference or note)" });
  const [st] = await db.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id, id));
  if (!st) return res.status(404).json({ error: "Not found" });
  const twins = await db.select({ id: ownerStatementsTable.id }).from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId, st.propertyId), eq(ownerStatementsTable.month, st.month), ne(ownerStatementsTable.id, id)));
  if (twins.length) return res.status(409).json({ error: `This property already has another statement for ${st.month}. Resolve the duplicate first.` });
  if (v.paidOn < `${st.month}-01`) return res.status(400).json({ error: `The payout date is before ${st.month}, the statement's month` });
  const result = await db.transaction(async tx => {
    const [locked] = await tx.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id, id)).for("update");
    if (locked.status === "draft") return { status: 409, error: "Send the statement to the owner before recording a payout" };
    if (locked.status === "paid") return { status: 409, error: "This statement is already marked paid" };
    if (statementSettled(locked) || Number(locked.ownerPayout) <= 0) return { status: 400, error: "Nothing is owed to the owner on this statement, so there is no payout to record" };
    const currency = locked.currency || "AED";
    const before = await tx.select({ amount: ownerPayoutsTable.amount }).from(ownerPayoutsTable).where(eq(ownerPayoutsTable.statementId, id));
    const paid = before.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0), balance = Math.round(Number(locked.ownerPayout) * 100), add = Math.round(v.amount * 100);
    if (paid + add > balance) return { status: 400, error: `That would pay ${money2((paid + add) / 100, currency)}, more than the ${money2(balance / 100, currency)} balance${paid ? ` (${money2(paid / 100, currency)} already recorded)` : ""}` };
    const label = { bank_transfer: "bank transfer", cash: "cash", cheque: "cheque", other: "other" }[v.method];
    const [pay] = await tx.insert(paymentsTable).values({ type: "owner_payout", propertyId: locked.propertyId, ownerId: locked.ownerId, amount: (add / 100).toFixed(2), status: "paid", paidAt: v.paidOn, dueDate: v.paidOn, description: `Owner statement #${id} · ${locked.month} · ${label}${reference ? ` ${reference}` : ""}` }).returning({ id: paymentsTable.id });
    const [row] = await tx.insert(ownerPayoutsTable).values({ statementId: id, propertyId: locked.propertyId, ownerId: locked.ownerId, amount: (add / 100).toFixed(2), currency, paidOn: v.paidOn, method: v.method, reference, notes, paymentId: pay.id, createdBy: res.locals.user?.email ?? null }).returning();
    return { row, remaining: (balance - paid - add) / 100 };
  });
  if ("error" in result) return res.status(result.status!).json({ error: result.error });
  await insertAuditLog({ action: "create", entity: "owner_payout", entityId: result.row!.id, details: { statementId: id, amount: Number(result.row!.amount), currency: result.row!.currency, paidOn: v.paidOn, method: v.method, reference }, performedBy: res.locals.user?.email });
  res.status(201).json({ payouts: await payoutsFor([id]), remaining: result.remaining });
}));

router.delete("/accounting/statements/:id/payouts/:payoutId", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id), pid = parseId(req.params.payoutId);
  if (id === null || pid === null) return res.status(400).json({ error: "Invalid id" });
  const result = await db.transaction(async tx => {
    const [locked] = await tx.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id, id)).for("update");
    if (!locked) return { status: 404, error: "Not found" };
    if (locked.status === "paid") return { status: 409, error: "The statement is paid, so its payout records are kept" };
    const [row] = await tx.delete(ownerPayoutsTable).where(and(eq(ownerPayoutsTable.id, pid), eq(ownerPayoutsTable.statementId, id))).returning();
    if (!row) return { status: 404, error: "Payout record not found" };
    if (row.paymentId) await tx.delete(paymentsTable).where(eq(paymentsTable.id, row.paymentId));
    return { row };
  });
  if ("error" in result) return res.status(result.status!).json({ error: result.error });
  await insertAuditLog({ action: "delete", entity: "owner_payout", entityId: pid, details: { statementId: id, amount: Number(result.row!.amount), currency: result.row!.currency, paidOn: result.row!.paidOn, method: result.row!.method, reference: result.row!.reference }, performedBy: res.locals.user?.email });
  res.json({ payouts: await payoutsFor([id]) });
}));

router.patch("/accounting/statements/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  let [existing] = await db.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id,id));
  if(!existing) return res.status(404).json({error:"Not found"});
  const twins=await db.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,existing.propertyId),eq(ownerStatementsTable.month,existing.month),ne(ownerStatementsTable.id,id)));
  if(twins.length) return res.status(409).json({error:`This property already has another statement for ${existing.month} (#${twins.map(t=>t.id).join(", #")}). Resolve the duplicate before sending or paying either one.`,duplicateOf:twins.map(t=>t.id)});
  if(existing.status==='draft'){
   const refreshed=await refreshOwnerStatements(existing.month);
   if(!refreshed.statements.some(s=>s.id===id))return res.status(409).json({error:'Statement cannot be published: verify every booking, owner and financial breakdown first'});
   [existing]=await db.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id,id));
  }
  const status = req.body.status ?? existing.status;
  if(!["draft","sent","paid"].includes(status) || (existing.status==="paid" && status!=="paid") || (existing.status==="sent" && status==="draft")) return res.status(400).json({error:"Invalid statement transition"});
  // Co-host payouts Airbnb paid the owner leave the balance at about 0: under 1.00 either way is rounding,
  // the statement is settled and no payout is recorded.
  const settled = statementSettled(existing);
  if(status==="paid" && Number(existing.ownerPayout)<0 && !settled) return res.status(400).json({error:"A negative balance cannot be marked as a payout"});
  const today=dubaiToday();
  const row = await db.transaction(async tx=>{
    const [locked]=await tx.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id,id)).for("update");
    if(locked.status==="paid") return locked;
    // Paid only with proof: the payout records (date, method, reference) must add up to the balance. A settled
    // statement (Airbnb already paid the owner; the rest is rounding) has nothing to pay.
    let paidAt=today;
    if(status==="paid" && !settled){
      const pays=await tx.select({amount:ownerPayoutsTable.amount,paidOn:ownerPayoutsTable.paidOn}).from(ownerPayoutsTable).where(eq(ownerPayoutsTable.statementId,id));
      const cur=locked.currency||"AED", paid=pays.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0), balance=Math.round(Number(locked.ownerPayout)*100);
      if(!pays.length) return {error:"Record the payout first (date, method and bank reference). A statement is only marked paid once the payout is recorded."};
      if(paid!==balance) return {error:`Payouts recorded: ${money2(paid/100,cur)} of ${money2(balance/100,cur)}. Record the remaining ${money2((balance-paid)/100,cur)} before marking it paid.`};
      paidAt=pays.map(p=>p.paidOn).sort().at(-1)!;
    }
    const [updated]=await tx.update(ownerStatementsTable).set({status,notes: req.body.notes ?? locked.notes,...(status==="sent"?{sentAt:today}:{}),...(status==="paid"?{paidAt}:{})}).where(eq(ownerStatementsTable.id,id)).returning();
    return updated;
  });
  if("error" in row) return res.status(400).json({error:row.error});
  return res.json({...row,ownerPayout:Number(row.ownerPayout),grossRevenue:Number(row.grossRevenue)});
}));

export default router;
