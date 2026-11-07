import { financialTotals } from "../../../../lib/reservation-financials.mjs";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { toAed, aedCents } from "../../../../lib/fx.mjs";
import { presentIncome, presentDetail } from "../../../../lib/fx-present.mjs";
import { getFxBook } from "../lib/fx";
import { dubaiToday, addDays, addMonths } from "../lib/dubai-date";
import { earningsDate } from "../../../../lib/company-statement.mjs";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, maintenanceTicketsTable, airbnbEarningsTable, accountingTransactionsTable, propertySettingsTable, ownerStatementsTable, ownersTable, airbnbPayoutLinesTable } from "@workspace/db";
import { exportModel, toXlsx, toPdf, exportFileName } from "../../../../lib/income-export.mjs";
import { incomeReport, incomePropertyDetail, periodOf } from "../../../../lib/income-report.mjs";
import { airbnbSplit, addSplitTotals, presentSplit } from "../../../../lib/airbnb-split.mjs";
import { reconcilePayouts } from "../../../../lib/payout-recon.mjs";
import { asyncHandler } from "../lib/asyncHandler";
import { eq, ne, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Keep imported channel earnings separate from full accommodation revenue. Both series are in dirhams.
router.get('/reports/revenue',async(_req,res)=>{
 const book=await getFxBook();
 const [bookings,earnings,properties]=await Promise.all([db.select().from(reservationsTable),db.select().from(airbnbEarningsTable),db.select().from(propertiesTable)]);
 const thisMonth=dubaiToday().slice(0,7);const months=[];
 for(let i=11;i>=0;i--){const month=addMonths(thisMonth,-i);
 const bs=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.checkIn.startsWith(month));
 const verified=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financeMode==='inclusive-v1'&&b.checkOut.startsWith(month));
 const es=earnings.filter(e=>e.status==='paid'&&earningsDate(e)?.startsWith(month));
 const revenue=financialTotals(verified,[],properties,`${month}-01`,`${month}-31`,book).totals.find((t:any)=>t.currency==='AED')?.accommodationRevenue || 0;
 const airbnbIncome=es.reduce((n,e)=>n+(toAed(e.amount,e.currency,earningsDate(e),book)||0),0);
 months.push({month,currency:'AED',bookings:bs.length,revenue,airbnbIncome});
 }res.json(months);
});

// Occupancy rate per property (last 30 days)
router.get("/reports/occupancy", async (req, res) => {
  const props = await db.select().from(propertiesTable).where(eq(propertiesTable.status, "active"));
  const endStr = dubaiToday();
  const startStr = addDays(endStr, -30);
  const result = await Promise.all(props.map(async (p) => {
    const rows = await db.select({ checkIn: reservationsTable.checkIn, checkOut: reservationsTable.checkOut })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.propertyId, p.id),
        ne(reservationsTable.status, "cancelled"),
        ne(reservationsTable.status, "blocked"),
        lte(reservationsTable.checkIn, endStr),
        gte(reservationsTable.checkOut, startStr),
      ));
    let occupiedDays = 0;
    for (let ds = startStr; ds < endStr; ds = addDays(ds, 1)) {
      if (rows.some(r => r.checkIn <= ds && r.checkOut > ds)) occupiedDays++;
    }
    return { propertyId: p.id, propertyName: p.name, occupancyRate: Math.round((occupiedDays / 30) * 100), occupiedDays };
  }));
  res.json(result);
});

// P&L per property in dirhams. Saved amounts stay in their own currency.
router.get("/reports/pnl", async (_req, res) => {
  const book = await getFxBook();
  const [props, bookings, tickets, expenses] = await Promise.all([db.select().from(propertiesTable), db.select().from(reservationsTable), db.select().from(maintenanceTicketsTable), db.select().from(accountingTransactionsTable)]);
  res.json(props.map(p => {
    const home = p.currency || "AED";
    const own = bookings.filter(b => b.propertyId === p.id && !["cancelled", "blocked"].includes(b.status));
    const verified = own.filter(b => b.financeMode === "inclusive-v1");
    let revenue = 0, maintenance = 0, other = 0;
    for (const b of verified) revenue += aedCents(b.revenue, bookingCurrency(b, p), b.checkOut, book);
    for (const t of tickets) if (t.propertyId === p.id && t.status === "completed") maintenance += aedCents(t.cost, home, String(t.completedAt || "").slice(0, 10), book);
    for (const t of expenses) if (t.propertyId === p.id && t.type === "expense" && t.allocation === "owner" && t.paymentStatus !== "void") other += aedCents(t.amount, t.currency || home, t.date, book);
    return { propertyId: p.id, propertyName: p.name, currency: "AED", revenue: revenue / 100, expenses: (maintenance + other) / 100, net: (revenue - maintenance - other) / 100, unverifiedBookings: own.length - verified.length };
  }));
});

// Platform split: booking counts; verified accommodation revenue in dirhams.
router.get("/reports/platforms", async (_req, res) => {
  const book = await getFxBook();
  const [bookings, props] = await Promise.all([db.select().from(reservationsTable), db.select().from(propertiesTable)]);
  const rows: Record<string, { platform: string; count: number; revenue: number; unverified: number }> = {};
  for (const b of bookings) {
    if (["cancelled", "blocked"].includes(b.status)) continue;
    const r = rows[b.platform] ??= { platform: b.platform, count: 0, revenue: 0, unverified: 0 };
    r.count++;
    if (b.financeMode === "inclusive-v1") r.revenue += aedCents(b.revenue, bookingCurrency(b, props.find(p => p.id === b.propertyId)), b.checkOut, book);
    else r.unverified++;
  }
  res.json(Object.values(rows).map(r => ({ platform: r.platform, count: r.count, currency: "AED", revenue: r.revenue / 100, unverifiedBookings: r.unverified })));
});

// Income per property (month or calendar year). Read only: owner figures come from the owner-statement
// calculation (or the published statement as stored), company figures from the company statement.
function incomePeriod(q: any): { month?: string; year?: string } | { error: string } {
  if (q.year != null && q.year !== "") return /^(20\d\d)$/.test(String(q.year)) ? { year: String(q.year) } : { error: "Valid year required (YYYY)" };
  const month = String(q.month || dubaiToday().slice(0, 7));
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { month } : { error: "Valid month required (YYYY-MM)" };
}
async function incomeData() {
  const [properties, settings, bookings, transactions, tickets, earnings, statements, owners] = await Promise.all([db.select().from(propertiesTable), db.select().from(propertySettingsTable), db.select().from(reservationsTable),
    db.select().from(accountingTransactionsTable), db.select().from(maintenanceTicketsTable), db.select().from(airbnbEarningsTable), db.select().from(ownerStatementsTable), db.select({ id: ownersTable.id, name: ownersTable.name }).from(ownersTable)]);
  return { properties: properties.sort((a, b) => a.name.localeCompare(b.name)), settings, bookings, transactions, tickets, earnings, statements, owners };
}
/** Full Airbnb earnings (total, co-host payout to the owner, company's share) for co-host-payout properties. */
async function splitsFor(data: Awaited<ReturnType<typeof incomeData>>, period: { month?: string; year?: string }, ids: number[], book: Awaited<ReturnType<typeof getFxBook>>) {
  const lines = (await db.select().from(airbnbPayoutLinesTable)).map(l => ({ ...l, amount: Number(l.amount), cohostPayout: l.cohostPayout == null ? null : Number(l.cohostPayout) }));
  const p = periodOf(period);
  // Which account each payout reached (from the transfer it was tied to in the payout check).
  const paidTo: Record<string, string> = {};
  if (lines.length) for (const r of reconcilePayouts({ lines, bookings: data.bookings, properties: data.properties, today: dubaiToday() }).rows) if (r.transfer?.destination) paidTo[r.code] = r.transfer.destination;
  const out = new Map<number, ReturnType<typeof airbnbSplit>>();
  for (const property of data.properties.filter(x => ids.includes(x.id))) {
    const split = airbnbSplit({ property, rules: data.settings.find(x => x.propertyId === property.id), bookings: data.bookings, lines, period: { start: p.start, end: p.end }, paidTo });
    if (split) out.set(property.id, presentSplit(split, book, p.end));
  }
  return out;
}
router.get("/reports/income", asyncHandler(async (req, res) => {
  const period = incomePeriod(req.query);
  if ("error" in period) return res.status(400).json(period);
  const data = await incomeData();
  const book = await getFxBook();
  const report = presentIncome(incomeReport(data, period), book);
  const splits = await splitsFor(data, period, report.properties.map((x: any) => x.propertyId), book);
  res.json({ ...report, airbnbSplit: report.properties.filter((x: any) => splits.has(x.propertyId)).map((x: any) => ({ propertyId: x.propertyId, name: x.name, ...splits.get(x.propertyId)!, rows: undefined })),
    airbnbSplitTotals: addSplitTotals([...splits.values()]) });
}));
// Export of the Income per property page (read-only): same report, plus each property's bookings.
router.get("/reports/income/export", asyncHandler(async (req, res) => {
  const period = incomePeriod(req.query);
  if ("error" in period) return res.status(400).json(period);
  const format = String(req.query.format || "xlsx");
  if (!["xlsx", "pdf"].includes(format)) return res.status(400).json({ error: "format must be xlsx or pdf" });
  const data = await incomeData();
  const report: any = presentIncome(incomeReport(data, period), await getFxBook());
  const months: string[] = (periodOf(period) as any).months;
  const bookings: Record<number, any[]> = {};
  for (const p of report.properties) bookings[p.propertyId] = months.flatMap(month => (incomePropertyDetail(data, p.propertyId, { month }) as any)?.bookings ?? []);
  const model = exportModel(report, bookings);
  const name = exportFileName(report.period, format);
  res.setHeader("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(format === "xlsx" ? toXlsx(model) : toPdf(model));
}));
router.get("/reports/income/:propertyId", asyncHandler(async (req, res) => {
  const period = incomePeriod(req.query);
  if ("error" in period) return res.status(400).json(period);
  const id = Number(req.params.propertyId);
  const data = await incomeData();
  const book = await getFxBook();
  const detail = Number.isInteger(id) && id > 0 ? presentDetail(incomePropertyDetail(data, id, period) as any, book) : null;
  if (!detail) return res.status(404).json({ error: "Property not found" });
  res.json({ ...detail, airbnbSplit: (await splitsFor(data, period, [id], book)).get(id) ?? null });
}));

export default router;
