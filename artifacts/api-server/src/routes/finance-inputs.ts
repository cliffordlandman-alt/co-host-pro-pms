// YALLA monthly workbook inputs (M1), the Income/Expense Input export (M2) and the M3 sheets (Monthly Summary,
// Apartment Performance, Dashboard). Approved by Clifford on 9 Oct 2026
// (via Raju). Rules: /workspace/finance/yalla_export_spec.md. Mounted under /accounting so the accounting roles apply.
import { Router } from "express";
import { z } from "zod";
import { eq, asc, and } from "drizzle-orm";
import {
  db, depositsTable, leaseSchedulesTable, leaseChequesTable, bankBalancesTable, propertiesTable, ownersTable,
  accountingTransactionsTable, reservationsTable, airbnbEarningsTable, airbnbPayoutsTable, ownerStatementsTable, maintenanceTicketsTable, ownerPayoutsTable, appSettingsTable,
} from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";
import { insertAuditLog } from "../lib/audit";
import { leaseAccruals } from "../../../../lib/lease-schedule.mjs";
import { buildWorkbookRows, companyMonthSummary, workbookXlsx, monthEnd } from "../../../../lib/yalla-workbook.mjs";
import { reservationFinancials } from "../../../../lib/reservation-financials.mjs";
import { dubaiToday } from "../lib/dubai-date";
import { documentCompanyName } from "./app-settings";

const router = Router();
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const date = z.string().refine(realDate, "Enter a real date (YYYY-MM-DD)");
const optDate = z.union([z.null(), z.literal("").transform(() => null), date]).optional();
const money = z.coerce.number().finite().positive("Enter an amount above 0").refine(n => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimals");
const optText = (max = 500) => z.union([z.null(), z.string().trim().max(max).transform(s => s || null)]).optional();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as AED").optional();
const who = (req: any, res: any) => res.locals.user?.email ?? (req.headers["x-user-id"] as string);
const num = (v: unknown) => (v == null ? null : Number(v));
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input";

// ── Deposits register (balance sheet only; never P&L) ──
const depositSchema = z.object({
  kind: z.enum(["asset", "liability"], { message: "Choose asset (we paid it) or liability (we hold it)" }),
  propertyId: z.union([z.null(), z.coerce.number().int().positive()]).optional(),
  counterparty: z.string().trim().min(1, "Say who paid it or who holds it").max(120),
  amount: money,
  currency,
  date,
  method: optText(60),
  status: z.enum(["held", "refunded", "kept"]).optional(),
  settledOn: optDate,
  keptAmount: z.union([z.null(), z.literal("").transform(() => null), money]).optional(),
  keptReason: optText(300),
  leaseId: z.union([z.null(), z.coerce.number().int().positive()]).optional(),
  notes: optText(),
}).strict();
function checkDeposit(d: any): string | null {
  const status = d.status ?? "held";
  if (status === "held" && (d.settledOn || d.keptAmount)) return "A held deposit has no settled date or kept amount";
  if (status !== "held" && !d.settledOn) return "Enter the date it was refunded or kept";
  if (d.settledOn && d.settledOn < d.date) return "The settled date is before the deposit date";
  if (status === "kept" && !d.keptAmount) return "Enter the amount kept against damage";
  if (status === "kept" && !d.keptReason) return "Say why it was kept (e.g. the damage)";
  if (status !== "kept" && d.keptAmount) return "Only a kept deposit has a kept amount";
  if (d.keptAmount && Number(d.keptAmount) > Number(d.amount)) return "The kept amount is more than the deposit";
  return null;
}
const depositOut = (r: any) => ({ ...r, amount: Number(r.amount), keptAmount: num(r.keptAmount), refundedAmount: r.status === "refunded" ? Number(r.amount) : r.status === "kept" ? Math.round((Number(r.amount) - Number(r.keptAmount || 0)) * 100) / 100 : 0 });
const depositRow = (d: any) => ({ ...d, amount: d.amount.toFixed(2), keptAmount: d.keptAmount == null ? d.keptAmount : Number(d.keptAmount).toFixed(2) });

router.get("/accounting/deposits", asyncHandler(async (_req, res) => {
  const rows = await db.select({ d: depositsTable, propertyName: propertiesTable.name, reportName: propertiesTable.reportName }).from(depositsTable).leftJoin(propertiesTable, eq(depositsTable.propertyId, propertiesTable.id)).orderBy(asc(depositsTable.date), asc(depositsTable.id));
  const items = rows.map(r => ({ ...depositOut(r.d), propertyName: r.reportName || r.propertyName }));
  const held: Record<string, { asset: number; liability: number }> = {};
  for (const d of items) if (d.status === "held") { const t = held[d.currency] ??= { asset: 0, liability: 0 }; t[d.kind as "asset" | "liability"] = Math.round((t[d.kind as "asset" | "liability"] + d.amount) * 100) / 100; }
  res.json({ items, held: Object.entries(held).map(([currency, t]) => ({ currency, ...t })) });
}));
router.post("/accounting/deposits", asyncHandler(async (req, res) => {
  const p = depositSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const err = checkDeposit(p.data); if (err) return res.status(400).json({ error: err });
  const [row] = await db.insert(depositsTable).values(depositRow(p.data) as any).returning();
  await insertAuditLog({ action: "create", entity: "deposit", entityId: row.id, details: { after: depositOut(row) }, performedBy: who(req, res) });
  res.status(201).json(depositOut(row));
}));
router.patch("/accounting/deposits/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(depositsTable).where(eq(depositsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Deposit not found" });
  const p = depositSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const merged: any = { ...depositOut(existing), ...p.data };
  if (p.data.status === "held") { merged.settledOn = p.data.settledOn ?? null; merged.keptAmount = null; merged.keptReason = null; }
  if (p.data.status === "refunded") { merged.keptAmount = null; merged.keptReason = null; }
  const err = checkDeposit(merged); if (err) return res.status(400).json({ error: err });
  const { id: _i, createdAt: _c, refundedAmount: _r, ...rest } = merged;
  const [row] = await db.update(depositsTable).set({ ...depositRow(rest), updatedAt: new Date() }).where(eq(depositsTable.id, id)).returning();
  await insertAuditLog({ action: "update", entity: "deposit", entityId: id, details: { before: depositOut(existing), after: depositOut(row) }, performedBy: who(req, res) });
  res.json(depositOut(row));
}));
router.delete("/accounting/deposits/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.delete(depositsTable).where(eq(depositsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Deposit not found" });
  await insertAuditLog({ action: "delete", entity: "deposit", entityId: id, details: { before: depositOut(row) }, performedBy: who(req, res) });
  res.status(204).send();
}));

// ── Lease schedules: P&L accrual (derived) + cash cheques ──
const chequeSchema = z.object({ seq: z.coerce.number().int().min(1).max(60), dueDate: date, amount: money, months: z.coerce.number().int().min(1).max(12).optional(), paidOn: optDate, reference: optText(120) }).strict();
const leaseSchema = z.object({
  propertyId: z.union([z.null(), z.coerce.number().int().positive()]).optional(),
  name: z.string().trim().min(1, "Name the lease").max(120),
  landlord: optText(120),
  startDate: date, endDate: date,
  annualRent: money, currency,
  agencyFee: z.union([z.null(), z.literal("").transform(() => null), money]).optional(),
  agencyFeeDate: optDate, agencyFeeNote: optText(300), notes: optText(),
  cheques: z.array(chequeSchema).max(60).optional(),
}).strict();
function checkLease(l: any): string | null {
  if (l.endDate <= l.startDate) return "The lease must end after it starts";
  if ((l.agencyFee == null) !== (l.agencyFeeDate == null)) return "Enter both the agency fee and the date it was paid";
  const seqs = new Set<number>();
  for (const c of l.cheques ?? []) { if (seqs.has(c.seq)) return `Cheque ${c.seq} is listed twice`; seqs.add(c.seq); }
  return null;
}
const leaseOut = (l: any, cheques: any[]) => {
  const cs = cheques.filter(c => c.leaseId === l.id).sort((a, b) => a.seq - b.seq).map(c => ({ ...c, amount: Number(c.amount) }));
  const accruals = leaseAccruals(l, cs);
  const total = Math.round(cs.reduce((n, c) => n + c.amount * 100, 0)) / 100;
  return { ...l, annualRent: Number(l.annualRent), agencyFee: num(l.agencyFee), cheques: cs, accruals, chequesTotal: total, chequesMatchRent: Math.round(total * 100) === Math.round(Number(l.annualRent) * 100) };
};
async function saveCheques(tx: any, leaseId: number, cheques: any[] | undefined) {
  if (!cheques) return;
  await tx.delete(leaseChequesTable).where(eq(leaseChequesTable.leaseId, leaseId));
  if (cheques.length) await tx.insert(leaseChequesTable).values(cheques.map(c => ({ leaseId, seq: c.seq, dueDate: c.dueDate, amount: c.amount.toFixed(2), months: c.months ?? 3, paidOn: c.paidOn ?? null, reference: c.reference ?? null })));
}
const leaseRow = (l: any) => { const { cheques: _c, ...rest } = l; return { ...rest, annualRent: rest.annualRent.toFixed(2), ...(rest.agencyFee !== undefined ? { agencyFee: rest.agencyFee == null ? null : Number(rest.agencyFee).toFixed(2) } : {}) }; };

router.get("/accounting/leases", asyncHandler(async (_req, res) => {
  const [leases, cheques] = await Promise.all([db.select().from(leaseSchedulesTable).orderBy(asc(leaseSchedulesTable.id)), db.select().from(leaseChequesTable)]);
  res.json(leases.map(l => leaseOut(l, cheques)));
}));
router.get("/accounting/leases/:id/schedule", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [l] = await db.select().from(leaseSchedulesTable).where(eq(leaseSchedulesTable.id, id));
  if (!l) return res.status(404).json({ error: "Lease not found" });
  res.json(leaseOut(l, await db.select().from(leaseChequesTable).where(eq(leaseChequesTable.leaseId, id))));
}));
router.post("/accounting/leases", asyncHandler(async (req, res) => {
  const p = leaseSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const err = checkLease(p.data); if (err) return res.status(400).json({ error: err });
  const row = await db.transaction(async tx => { const [l] = await tx.insert(leaseSchedulesTable).values(leaseRow(p.data) as any).returning(); await saveCheques(tx, l.id, p.data.cheques); return l; });
  const out = leaseOut(row, await db.select().from(leaseChequesTable).where(eq(leaseChequesTable.leaseId, row.id)));
  await insertAuditLog({ action: "create", entity: "lease", entityId: row.id, details: { after: { ...out, accruals: undefined } }, performedBy: who(req, res) });
  res.status(201).json(out);
}));
router.patch("/accounting/leases/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(leaseSchedulesTable).where(eq(leaseSchedulesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Lease not found" });
  const p = leaseSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const oldCheques = await db.select().from(leaseChequesTable).where(eq(leaseChequesTable.leaseId, id));
  const merged: any = { ...existing, annualRent: Number(existing.annualRent), agencyFee: num(existing.agencyFee), cheques: oldCheques.map(c => ({ ...c, amount: Number(c.amount) })), ...p.data };
  const err = checkLease(merged); if (err) return res.status(400).json({ error: err });
  const { id: _i, createdAt: _c, cheques, ...rest } = merged;
  const row = await db.transaction(async tx => { const [l] = await tx.update(leaseSchedulesTable).set(leaseRow(rest)).where(eq(leaseSchedulesTable.id, id)).returning(); await saveCheques(tx, id, p.data.cheques); return l; });
  const out = leaseOut(row, await db.select().from(leaseChequesTable).where(eq(leaseChequesTable.leaseId, id)));
  await insertAuditLog({ action: "update", entity: "lease", entityId: id, details: { before: { ...leaseOut(existing, oldCheques), accruals: undefined }, after: { ...out, accruals: undefined } }, performedBy: who(req, res) });
  res.json(out);
}));
router.delete("/accounting/leases/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id); if (id === null) return res.status(400).json({ error: "Invalid id" });
  const linked = await db.select({ id: depositsTable.id }).from(depositsTable).where(eq(depositsTable.leaseId, id));
  if (linked.length) return res.status(409).json({ error: "A deposit is linked to this lease. Unlink or delete the deposit first." });
  const [row] = await db.delete(leaseSchedulesTable).where(eq(leaseSchedulesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Lease not found" });
  await insertAuditLog({ action: "delete", entity: "lease", entityId: id, details: { before: row }, performedBy: who(req, res) });
  res.status(204).send();
}));

// ── Bank balance: month-end closing balances (history) and one dated latest balance per account ──
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const amount2 = z.coerce.number().finite().refine(n => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimals");
const bankSchema = z.object({ account: z.string().trim().min(1).max(60).optional(), balance: amount2, currency, source: z.enum(["manual", "statement"]).optional(), notes: optText() }).strict();
const latestSchema = bankSchema.extend({ balanceDate: date }).strict();
const bankOut = (r: any) => ({ ...r, balance: Number(r.balance), updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt });
router.get("/accounting/bank-balances", asyncHandler(async (_req, res) => {
  res.json((await db.select().from(bankBalancesTable).orderBy(asc(bankBalancesTable.month), asc(bankBalancesTable.account), asc(bankBalancesTable.kind))).map(bankOut));
}));
/** Insert or replace the one row matching (account, kind[, month]). */
async function upsertBank(values: any, req: any, res: any) {
  const { row, before } = await db.transaction(async tx => {
    const where = values.kind === "latest" ? and(eq(bankBalancesTable.account, values.account), eq(bankBalancesTable.kind, "latest"))
      : and(eq(bankBalancesTable.account, values.account), eq(bankBalancesTable.kind, "month_end"), eq(bankBalancesTable.month, values.month));
    const [before] = await tx.select().from(bankBalancesTable).where(where).for("update");
    const [row] = before ? await tx.update(bankBalancesTable).set(values).where(eq(bankBalancesTable.id, before.id)).returning() : await tx.insert(bankBalancesTable).values(values).returning();
    return { row, before };
  });
  await insertAuditLog({ action: before ? "update" : "create", entity: "bank_balance", entityId: row.id, details: { before: before ? bankOut(before) : null, after: bankOut(row) }, performedBy: who(req, res) });
  return bankOut(row);
}
// The latest balance (any day, e.g. 9 Oct); the Dashboard shows it with its date. Registered before /:month.
router.put("/accounting/bank-balances/latest", asyncHandler(async (req, res) => {
  const p = latestSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  if (p.data.balanceDate > dubaiToday()) return res.status(400).json({ error: "The balance date can't be in the future" });
  res.json(await upsertBank({ account: p.data.account ?? "ADIB 19589605", kind: "latest", month: p.data.balanceDate.slice(0, 7), balanceDate: p.data.balanceDate, balance: p.data.balance.toFixed(2), currency: p.data.currency ?? "AED", source: p.data.source ?? "manual", notes: p.data.notes ?? null, updatedAt: new Date() }, req, res));
}));
router.put("/accounting/bank-balances/:month", asyncHandler(async (req, res) => {
  const month = String(req.params.month);
  if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-09" });
  const p = bankSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  res.json(await upsertBank({ account: p.data.account ?? "ADIB 19589605", kind: "month_end", month, balanceDate: monthEnd(month), balance: p.data.balance.toFixed(2), currency: p.data.currency ?? "AED", source: p.data.source ?? "manual", notes: p.data.notes ?? null, updatedAt: new Date() }, req, res));
}));
router.delete("/accounting/bank-balances/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.delete(bankBalancesTable).where(eq(bankBalancesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  await insertAuditLog({ action: "delete", entity: "bank_balance", entityId: id, details: { before: bankOut(row) }, performedBy: who(req, res) });
  res.status(204).send();
}));

// ── Workbook property names ──
router.get("/accounting/report-names", asyncHandler(async (_req, res) => {
  res.json(await db.select({ id: propertiesTable.id, name: propertiesTable.name, unitNumber: propertiesTable.unitNumber, status: propertiesTable.status, reportName: propertiesTable.reportName, showInReport: propertiesTable.showInReport }).from(propertiesTable).orderBy(asc(propertiesTable.id)));
}));
const namesSchema = z.array(z.object({ id: z.coerce.number().int().positive(), reportName: z.union([z.null(), z.string().trim().max(80).transform(s => s || null)]).optional(), showInReport: z.boolean().optional() }).strict()).max(500);
router.put("/accounting/report-names", asyncHandler(async (req, res) => {
  const p = namesSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const changed: any[] = [];
  await db.transaction(async tx => {
    for (const r of p.data) {
      const [before] = await tx.select({ reportName: propertiesTable.reportName, showInReport: propertiesTable.showInReport }).from(propertiesTable).where(eq(propertiesTable.id, r.id));
      if (!before) continue;
      const set: any = {};
      if (r.reportName !== undefined && before.reportName !== r.reportName) set.reportName = r.reportName;
      if (r.showInReport !== undefined && before.showInReport !== r.showInReport) set.showInReport = r.showInReport;
      if (!Object.keys(set).length) continue;
      await tx.update(propertiesTable).set(set).where(eq(propertiesTable.id, r.id));
      changed.push({ id: r.id, from: Object.fromEntries(Object.keys(set).map(k => [k, (before as any)[k]])), to: set });
    }
  });
  if (changed.length) await insertAuditLog({ action: "update", entity: "property_report_names", entityId: 0, details: { changed }, performedBy: who(req, res) });
  res.json({ changed: changed.length });
}));

// ── Q5: a booking's management fee received (e.g. netted from an owner payout that left the bank) ──
const feeSchema = z.object({ receivedOn: z.union([z.null(), z.literal("").transform(() => null), date]), note: optText(300) }).strict();
router.put("/accounting/workbook/fee-received/:reservationId", asyncHandler(async (req, res) => {
  const id = parseId(req.params.reservationId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const p = feeSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  if (p.data.receivedOn && p.data.receivedOn > dubaiToday()) return res.status(400).json({ error: "The date can't be in the future" });
  const [before] = await db.select({ id: reservationsTable.id, feeReceivedOn: reservationsTable.feeReceivedOn }).from(reservationsTable).where(eq(reservationsTable.id, id));
  if (!before) return res.status(404).json({ error: "Booking not found" });
  await db.update(reservationsTable).set({ feeReceivedOn: p.data.receivedOn }).where(eq(reservationsTable.id, id));
  await insertAuditLog({ action: "update", entity: "reservation_fee_received", entityId: id, details: { from: before.feeReceivedOn, to: p.data.receivedOn, note: p.data.note ?? null }, performedBy: who(req, res) });
  res.json({ id, feeReceivedOn: p.data.receivedOn });
}));

// ── M2 + M3: the workbook export ──
async function workbookData() {
  const [properties, owners, transactions, bookings, earnings, payouts, statements, leases, cheques, deposits, maintenance, ownerPayouts, bankBalances] = await Promise.all([
    db.select().from(propertiesTable), db.select().from(ownersTable), db.select().from(accountingTransactionsTable), db.select().from(reservationsTable),
    db.select().from(airbnbEarningsTable), db.select().from(airbnbPayoutsTable), db.select().from(ownerStatementsTable), db.select().from(leaseSchedulesTable),
    db.select().from(leaseChequesTable), db.select().from(depositsTable), db.select().from(maintenanceTicketsTable), db.select().from(ownerPayoutsTable), db.select().from(bankBalancesTable)]);
  const prop = (id: number) => properties.find(p => p.id === id);
  return {
    properties, owners, transactions, earnings, payouts, statements, deposits, maintenance, ownerPayouts, bankBalances,
    // Management amount exactly as the owner statement and company statement compute it.
    bookings: bookings.map(b => b.financeMode === "inclusive-v1" ? { ...b, managementAmount: reservationFinancials(b, earnings, prop(b.propertyId)).managementAmount } : b),
    leases: leases.map(l => ({ ...l, cheques: cheques.filter(c => c.leaseId === l.id) })),
  };
}
// Workbook report title (sheet titles of the export only; the app stays Co-Host Pro). Setting "workbook" =
// { reportTitle }; empty = WORKBOOK_DEFAULTS.reportTitle (the master's text).
async function workbookReportTitle(): Promise<string | undefined> {
  try {
    const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "workbook"));
    const t = (row?.value as any)?.reportTitle;
    return typeof t === "string" && t.trim() ? t.trim().slice(0, 80) : undefined;
  } catch { return undefined; }
}
router.get("/accounting/workbook-settings", asyncHandler(async (_req, res) => { res.json({ reportTitle: (await workbookReportTitle()) ?? null }); }));
router.put("/accounting/workbook-settings", asyncHandler(async (req, res) => {
  const p = z.object({ reportTitle: z.union([z.null(), z.string().trim().max(80)]) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: firstIssue(p.error) });
  const value = { reportTitle: p.data.reportTitle || null };
  const [ex] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "workbook"));
  if (ex) await db.update(appSettingsTable).set({ value, updatedAt: new Date() }).where(eq(appSettingsTable.key, "workbook"));
  else await db.insert(appSettingsTable).values({ key: "workbook", value });
  await insertAuditLog({ action: ex ? "update" : "create", entity: "workbook_settings", entityId: 0, details: { before: ex?.value ?? null, after: value }, performedBy: who(req, res) });
  res.json(value);
}));
// GET /accounting/company-month/2026-09: Accounting > Transactions month cards. Company revenue / expenses / profit
// from the same rows as the YALLA export (lib/yalla-workbook.mjs companyMonthSummary), other currencies apart.
router.get("/accounting/company-month/:month", asyncHandler(async (req, res) => {
  const month = String(req.params.month);
  if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-09" });
  res.json(companyMonthSummary(await workbookData(), month, {}, { today: dubaiToday(), companyName: await documentCompanyName() }));
}));
// GET /accounting/workbook/2026-09 (JSON) or .xlsx.
router.get(/^\/accounting\/workbook\/(\d{4}-\d{2})(\.xlsx)?$/, asyncHandler(async (req, res) => {
  const month = (req.params as any)[0] as string, xlsx = !!(req.params as any)[1];
  if (!MONTH.test(month)) return res.status(400).json({ error: "Month must look like 2026-09" });
  // Default range = the workbook's (WORKBOOK_DEFAULTS.inputFrom / inputThrough: the Monthly Summary's first month to
  // today, like the master); ?from=YYYY-MM&through=YYYY-MM-DD narrows it (e.g. one month to paste).
  const from = req.query.from == null || req.query.from === "" ? undefined : String(req.query.from);
  const through = req.query.through == null || req.query.through === "" ? undefined : String(req.query.through);
  if (from !== undefined && (!MONTH.test(from) || from > month)) return res.status(400).json({ error: "From must be a month like 2026-04, not after the reporting month" });
  if (through !== undefined && (!realDate(through) || through < monthEnd(month))) return res.status(400).json({ error: "Through must be a date (YYYY-MM-DD) on or after the reporting month end" });
  const result = buildWorkbookRows(await workbookData(), month, {}, { from, through, today: dubaiToday(), companyName: await documentCompanyName(), reportTitle: await workbookReportTitle() });
  if (!xlsx) return res.json(result);
  const buf = workbookXlsx(result);
  await insertAuditLog({ action: "create", entity: "yalla_workbook_export", entityId: 0, details: { month, from: result.from, through: result.through, incomeRows: result.income.length, expenseRows: result.expense.length, excluded: result.excluded.length, warnings: result.warnings.length }, performedBy: who(req, res) });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="YALLA_Workbook_${month}.xlsx"`);
  res.send(buf);
}));

export default router;
