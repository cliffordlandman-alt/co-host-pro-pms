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
import { cleaningCostRatesTable, vendorsTable, usersTable } from "@workspace/db";

const router = Router();

// ── Validation schema for property accounting settings ────────────────────────

// Coerce numbers to strings so Drizzle decimal columns always receive string values
const toDecimalStr = z.coerce.number().finite().min(0).max(100).transform(String).optional();

const accountingSettingsSchema = z.object({
  tourismRate: z.coerce.number().finite().min(0).max(1000).transform(String).optional(),
  tourismEnabled: z.boolean().optional(),
  vatEnabled: z.boolean().optional(),
  managementFeePercent: toDecimalStr,
  platformFeeAirbnb: toDecimalStr,
  platformFeeBookingCom: toDecimalStr,
  platformFeeDirect: toDecimalStr,
  platformFeeVrbo: toDecimalStr,
  ownerSplitPercent: toDecimalStr,
  vatPercent: toDecimalStr,
  includeCleaning: z.boolean().optional(),
  includeMaintenance: z.boolean().optional(),
  currency: z.string().max(3).optional(),
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
  const existing = await db.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, propertyId));
  if (existing.length > 0) {
    const result = await db.transaction(async tx => {
      const [row] = await tx.update(propertySettingsTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(propertySettingsTable.propertyId, propertyId))
        .returning();
      const changed = data.includeCleaning !== undefined && data.includeCleaning !== (existing[0].includeCleaning !== false);
      return { row, cleaning: changed ? await applyIncludeCleaning(tx, propertyId, data.includeCleaning !== false) : null };
    });
    return res.json({ ...result.row, ...(result.cleaning ? { bookingsRecalculated: result.cleaning.updated, bookingsInPublishedMonths: result.cleaning.locked } : {}) });
  }
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const d = defaultFeeSettings(property);
  const [row] = await db.insert(propertySettingsTable).values({ propertyId, tourismEnabled: d.tourismEnabled, vatEnabled: d.vatEnabled, currency: d.currency, cleaningRateCard: d.cleaningRateCard, ...data }).returning();
  return res.status(201).json(row);
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
      createdAt: accountingTransactionsTable.createdAt,
    })
    .from(accountingTransactionsTable)
    .leftJoin(propertiesTable, eq(accountingTransactionsTable.propertyId, propertiesTable.id))
    .leftJoin(vendorsTable, eq(accountingTransactionsTable.vendorId, vendorsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${accountingTransactionsTable.date} DESC`);

  res.json(rows.map(r => ({ ...r, amount: parseFloat(r.amount || "0"), createdAt: r.createdAt.toISOString() })));
}));

router.post("/accounting/transactions", asyncHandler(async (req, res) => {
  const input = {...req.body, amount:String(req.body.amount)};
  if(input.reservationId){const [b]=await db.select().from(reservationsTable).where(eq(reservationsTable.id,Number(input.reservationId)));if(!b)return res.status(400).json({error:'Booking not found'});if(input.propertyId&&Number(input.propertyId)!==b.propertyId)return res.status(400).json({error:'Booking and property must match'});input.propertyId=b.propertyId;}
  input.allocation ??= input.propertyId ? 'owner' : 'company';
  if (input.revenueStream !== undefined && input.revenueStream !== null && typeof input.revenueStream !== 'boolean') return res.status(400).json({error:'Revenue stream must be yes, no or not tagged'});
  if (input.type !== 'expense') input.revenueStream = null;
  if (!['income','expense'].includes(input.type) || !['company','owner'].includes(input.allocation)) return res.status(400).json({error:'Choose income or expense and company or owner allocation'});
  if(input.propertyId){const [p]=await db.select().from(propertiesTable).where(eq(propertiesTable.id,Number(input.propertyId)));if(!p)return res.status(400).json({error:'Property not found'});input.currency ??= p.currency || 'AED';if(input.allocation==='owner'&&input.currency!==(p.currency||'AED'))return res.status(400).json({error:'Owner expenses must use the property currency'});}
  input.currency ??= 'AED';
  if(!/^[A-Z]{3}$/.test(input.currency)||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)return res.status(400).json({error:'Enter a valid date, currency and positive amount'});
  if(input.allocation==='owner'&&!input.propertyId)return res.status(400).json({error:'Choose a property for owner expenses'});
  if(input.allocation==='owner'&&input.type==='income')return res.status(400).json({error:'Use company allocation for additional income; owner income adjustments are not supported yet'});
  if(input.allocation==='owner'){const locked=await db.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,input.propertyId),eq(ownerStatementsTable.month,input.date.slice(0,7)),ne(ownerStatementsTable.status,'draft')));if(locked.length)return res.status(409).json({error:'This owner month is published; use an adjustment in an open month'});}
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date || "") || !input.description?.trim()) return res.status(400).json({error:"Valid date, description and non-negative amount required"});
  const parsed = insertAccountingTransactionSchema.safeParse(input);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db.insert(accountingTransactionsTable).values(parsed.data).returning();
  res.status(201).json({ ...row, amount: parseFloat(row.amount || "0"), createdAt: row.createdAt.toISOString() });
}));

router.delete("/accounting/transactions/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [entry]=await db.select().from(accountingTransactionsTable).where(eq(accountingTransactionsTable.id,id));
  if(entry?.allocation==='owner'&&entry.propertyId){const locks=await db.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,entry.propertyId),eq(ownerStatementsTable.month,entry.date.slice(0,7)),ne(ownerStatementsTable.status,'draft')));if(locks.length)return res.status(409).json({error:'Published owner expenses cannot be deleted'});}
  await db.delete(accountingTransactionsTable).where(eq(accountingTransactionsTable.id, id));
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
      nightsOccupied: ownerStatementsTable.nightsOccupied,
      bookingsCount: ownerStatementsTable.bookingsCount,
      status: ownerStatementsTable.status,
      sentAt: ownerStatementsTable.sentAt,
      paidAt: ownerStatementsTable.paidAt,
      notes: ownerStatementsTable.notes,
      createdAt: ownerStatementsTable.createdAt,
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
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(p ? paged(items, total, p, summary) : items);
}));

// Property/month pairs holding more than one statement (only possible in data from before the unique rule).
router.get("/accounting/statements/duplicates", asyncHandler(async (_req, res) => {
  res.json(await duplicateOwnerStatements());
}));

router.post("/accounting/statements/generate", asyncHandler(async (req,res)=>{
 const {month} = req.body;
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return res.status(400).json({error:"Valid month required (YYYY-MM)"});
 const result=await refreshOwnerStatements(month);
 return res.json(result);
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
  if(status==="paid" && Number(existing.ownerPayout)<0) return res.status(400).json({error:"A negative balance cannot be marked as a payout"});
  const today=dubaiToday();
  const row = await db.transaction(async tx=>{
    const [locked]=await tx.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.id,id)).for("update");
    if(locked.status==="paid") return locked;
    const [updated]=await tx.update(ownerStatementsTable).set({status,notes: req.body.notes ?? locked.notes,...(status==="sent"?{sentAt:today}:{}),...(status==="paid"?{paidAt:today}:{})}).where(eq(ownerStatementsTable.id,id)).returning();
    if(status==="paid") await tx.insert(paymentsTable).values({type:"owner_payout",propertyId:locked.propertyId,ownerId:locked.ownerId,amount:locked.ownerPayout,status:"paid",paidAt:today,dueDate:today,description:`Owner statement #${id} · ${locked.month}`});
    return updated;
  });
  return res.json({...row,ownerPayout:Number(row.ownerPayout),grossRevenue:Number(row.grossRevenue)});
}));

export default router;
