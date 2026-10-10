// An owner's statements over the full history of a property (or any range of months): every month with stays,
// each from the one owner-statement calculation (lib/owner-statement-calc.mjs) or, for a published (sent/paid)
// month, the statement as stored. Totals per year and overall, per currency; amounts in different currencies are
// never added (a USD PayPal payout is listed as sent in USD, for reference only). Read-only, plus a button to
// generate the stored monthly drafts for every past month with stays. Also the monthly automatic statements status.
import { Router } from "express";
import { db, propertiesTable, ownersTable, reservationsTable, accountingTransactionsTable, maintenanceTicketsTable, propertySettingsTable, ownerStatementsTable, airbnbBookingPayoutsTable, appSettingsTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { ownerStatementCalc } from "../../../../lib/owner-statement-calc.mjs";
import { autoStatementDecision } from "../../../../lib/auto-statements.mjs";
import { confirmationCode } from "../../../../lib/booking-currency.mjs";
import { refreshOwnerStatements } from "../lib/owner-statements";
import { runAutoStatements } from "../lib/auto-statements";
import { outboundDeliveryEnabled } from "../lib/outbound";
import { dubaiToday } from "../lib/dubai-date";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";
import { insertAuditLog } from "../lib/audit";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const nextMonth = (m: string) => { const [y, n] = m.split("-").map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, "0")}`; };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function loadHistory(propertyId: number) {
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return null;
  const [owner] = property.ownerId ? await db.select().from(ownersTable).where(eq(ownersTable.id, property.ownerId)) : [];
  const [rules] = await db.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, propertyId));
  const bookings = (await db.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId, propertyId), ne(reservationsTable.status, "cancelled")))).filter(r => r.status !== "blocked");
  const expenses = (await db.select().from(accountingTransactionsTable).where(and(eq(accountingTransactionsTable.propertyId, propertyId), eq(accountingTransactionsTable.type, "expense"), eq(accountingTransactionsTable.allocation, "owner")))).filter(t => t.paymentStatus !== "void");
  const tickets = await db.select().from(maintenanceTicketsTable).where(and(eq(maintenanceTicketsTable.propertyId, propertyId), eq(maintenanceTicketsTable.status, "completed")));
  const payouts = await db.select().from(airbnbBookingPayoutsTable);
  const statements = await db.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.propertyId, propertyId));
  return { property, owner: owner ?? null, rules: rules ?? null, bookings, expenses, tickets, payouts: payouts.filter(p => bookings.some(b => b.id === p.reservationId)), statements };
}

/** Months from the first to the last month with a stay, owner entry or statement (bounded by from/to). */
function activeMonths(h: NonNullable<Awaited<ReturnType<typeof loadHistory>>>, from?: string, to?: string) {
  const set = new Set<string>([...h.bookings.map(b => b.checkOut.slice(0, 7)), ...h.expenses.map(e => String(e.date).slice(0, 7)), ...h.tickets.map(t => String(t.completedAt ?? "").slice(0, 7)).filter(Boolean), ...h.statements.map(s => s.month)]);
  return [...set].filter(m => MONTH.test(m) && (!from || m >= from) && (!to || m <= to)).sort();
}

router.get("/accounting/owner-history", asyncHandler(async (req, res) => {
  const propertyId = parseId(String(req.query.propertyId ?? ""));
  if (!propertyId) return res.status(400).json({ error: "Choose a property" });
  const from = MONTH.test(String(req.query.from ?? "")) ? String(req.query.from) : undefined, to = MONTH.test(String(req.query.to ?? "")) ? String(req.query.to) : undefined;
  const h = await loadHistory(propertyId);
  if (!h) return res.status(404).json({ error: "Property not found" });
  const months = activeMonths(h, from, to).map(month => {
    const found = h.statements.filter(s => s.month === month);
    const published = found.length === 1 && found[0].status !== "draft" ? found[0] : null;
    const calc = ownerStatementCalc({ property: h.property, rules: h.rules, bookings: h.bookings, expenses: h.expenses, tickets: h.tickets, month, payouts: h.payouts });
    const details = published?.bookingDetails ?? calc.statement?.bookingDetails ?? null;
    const stays = details ? JSON.parse(details) : calc.recognized.map(r => ({ id: r.id, code: confirmationCode(r.externalId), guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform, verified: r.financeMode === "inclusive-v1" }));
    const fig = published ? { currency: published.currency || "AED", gross: cents(published.grossRevenue), channel: cents(published.platformFees), management: cents(published.managementFee), cleaning: cents(published.cleaningCosts),
      expenses: cents(published.maintenanceCosts) + cents(published.otherExpenses), taxes: cents(published.vatAmount) + cents(published.tourismFee), paidByAirbnb: cents(published.paidByAirbnb), balance: cents(published.ownerPayout), bookings: Number(published.bookingsCount), nights: Number(published.nightsOccupied) }
      : calc.hold ? null : (() => { const g = calc.groups[0]; return { currency: g.currency, gross: g.gross, channel: g.channel, management: g.management, cleaning: g.cleaning, expenses: g.maintenance + g.other, taxes: g.vat + g.tourism, paidByAirbnb: g.paidByAirbnb, balance: g.ownerPayout, bookings: calc.recognized.length, nights: calc.recognized.reduce((n, r) => n + Number(r.nights || 0), 0) }; })();
    return { month, statement: found.length === 1 ? { id: found[0].id, status: found[0].status } : found.length ? { status: "duplicate" } : null, held: published ? null : calc.hold?.reason ?? null, figures: fig, stays };
  });
  const totals: any[] = [], years: any[] = [];
  const add = (list: any[], key: Record<string, string>, f: any) => {
    let t = list.find(x => x.currency === f.currency && Object.entries(key).every(([k, v]) => x[k] === v));
    if (!t) list.push(t = { ...key, currency: f.currency, months: 0, bookings: 0, nights: 0, gross: 0, channel: 0, management: 0, cleaning: 0, expenses: 0, taxes: 0, paidByAirbnb: 0, balance: 0 });
    t.months++; for (const k of ["bookings", "nights", "gross", "channel", "management", "cleaning", "expenses", "taxes", "paidByAirbnb", "balance"]) t[k] += f[k];
  };
  for (const m of months) if (m.figures) { add(totals, {}, m.figures); add(years, { year: m.month.slice(0, 4) }, m.figures); }
  // Payouts Airbnb sent in another currency than the booking (e.g. USD to PayPal): listed with their own currency only.
  const sentOther: Record<string, number> = {};
  for (const p of h.payouts) if (p.sentCurrency && p.sentAmount != null) sentOther[p.sentCurrency] = (sentOther[p.sentCurrency] ?? 0) + cents(p.sentAmount);
  const asMoney = (t: any) => ({ ...t, ...Object.fromEntries(["gross", "channel", "management", "cleaning", "expenses", "taxes", "paidByAirbnb", "balance"].map(k => [k, t[k] / 100])), ownerShare: (t.balance + t.paidByAirbnb) / 100 });
  res.json({ property: { id: h.property.id, name: h.property.name, currency: h.property.currency }, owner: h.owner ? { id: h.owner.id, name: h.owner.name, email: h.owner.email } : null,
    settings: { feeBasis: h.rules?.feeBasis ?? "gross", payoutToOwner: !!h.rules?.payoutToOwner, managementFeePercent: h.rules ? Number(h.rules.managementFeePercent) : null, includeCleaning: h.rules?.includeCleaning !== false },
    months: months.map(m => ({ ...m, figures: m.figures ? asMoney(m.figures) : null })), years: years.sort((a, b) => a.year.localeCompare(b.year) || a.currency.localeCompare(b.currency)).map(asMoney), totals: totals.map(asMoney),
    held: months.filter(m => m.held).length, sentInOtherCurrency: Object.entries(sentOther).map(([currency, n]) => ({ currency, amount: n / 100, transfers: h.payouts.filter(p => p.sentCurrency === currency).length })) });
}));

// Stored monthly drafts for every past month with stays (never the current month; published months are left alone).
router.post("/accounting/owner-history/generate", asyncHandler(async (req, res) => {
  const propertyId = parseId(String(req.body?.propertyId ?? ""));
  if (!propertyId) return res.status(400).json({ error: "Choose a property" });
  const h = await loadHistory(propertyId);
  if (!h) return res.status(404).json({ error: "Property not found" });
  if (!h.property.ownerId) return res.status(409).json({ error: "Link an owner to this property first" });
  const current = dubaiToday().slice(0, 7);
  const months = activeMonths(h).filter(m => m < current);
  let generated = 0, locked = 0; const skipped: any[] = [];
  for (const m of months) {
    const r = await refreshOwnerStatements(m, { propertyIds: [propertyId], onlyWithActivity: true });
    generated += r.generated; for (const s of r.skipped) if (s.locked) locked++; else skipped.push({ month: m, ...s });
  }
  await insertAuditLog({ action: "create", entity: "owner_statement_history", entityId: propertyId, details: { months: months.length, generated, skipped: skipped.length }, performedBy: req.headers["x-user-id"] as string });
  res.json({ months: months.length, generated, skipped, locked });
}));

// Monthly automatic statements: each owner's setting and what the next run would do (read-only).
router.get("/accounting/auto-statements", asyncHandler(async (_req, res) => {
  const owners = await db.select().from(ownersTable).orderBy(ownersTable.name);
  const statements = await db.select({ ownerId: ownerStatementsTable.ownerId, month: ownerStatementsTable.month, status: ownerStatementsTable.status, autoGeneratedAt: ownerStatementsTable.autoGeneratedAt }).from(ownerStatementsTable);
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "autoStatementsLastRun"));
  const runs = (row?.value ?? {}) as Record<string, string>;
  const today = dubaiToday(), outbound = outboundDeliveryEnabled();
  res.json({ today, outbound, owners: owners.map(o => {
    const d = autoStatementDecision({ today: today.slice(0, 8) + "28", owner: { ...o, autoStatements: true }, statements: statements.filter(s => s.ownerId === o.id), outbound });
    return { id: o.id, name: o.name, email: o.email, autoStatements: o.autoStatements, autoSend: o.autoSend, lastRun: runs[String(o.id)] ?? null, wouldEmail: o.autoStatements && d.run && d.send, waitReason: d.run ? d.waitReason : null };
  }) });
}));

// Runs the monthly check now (admins). `today` (YYYY-MM-DD) is accepted for testing a date; it never sends with OUTBOUND_DELIVERY off.
router.post("/accounting/auto-statements/run", requireAdmin, asyncHandler(async (req, res) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.today ?? "")) ? String(req.body.today) : dubaiToday();
  res.json({ today, report: await runAutoStatements(today) });
}));

export default router;
