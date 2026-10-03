import { financialTotals } from "../../../../lib/reservation-financials.mjs";
import { bookingCurrency } from "../../../../lib/booking-currency.mjs";
import { dubaiToday, addDays, addMonths } from "../lib/dubai-date";
import { earningsDate } from "../../../../lib/company-statement.mjs";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, maintenanceTicketsTable, airbnbEarningsTable, accountingTransactionsTable, propertySettingsTable, ownerStatementsTable, ownersTable } from "@workspace/db";
import { incomeReport, incomePropertyDetail } from "../../../../lib/income-report.mjs";
import { asyncHandler } from "../lib/asyncHandler";
import { eq, ne, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Keep imported channel earnings separate from full accommodation revenue.
router.get('/reports/revenue',async(req,res)=>{
 const currency=String(req.query.currency || 'AED');
 const [bookings,earnings,properties]=await Promise.all([db.select().from(reservationsTable),db.select().from(airbnbEarningsTable),db.select().from(propertiesTable)]);
 const thisMonth=dubaiToday().slice(0,7);const months=[];
 for(let i=11;i>=0;i--){const month=addMonths(thisMonth,-i);
 const bs=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.checkIn.startsWith(month));
 const verified=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financeMode==='inclusive-v1'&&b.checkOut.startsWith(month)&&bookingCurrency(b,properties.find(p=>p.id===b.propertyId))===currency);
 const es=earnings.filter(e=>e.status==='paid'&&earningsDate(e)?.startsWith(month)&&e.currency===currency);
 months.push({month,currency,bookings:bs.length,revenue:financialTotals(verified,[],properties).totals.find((t:any)=>t.currency===currency)?.accommodationRevenue || 0,airbnbIncome:es.reduce((n,e)=>n+Number(e.amount),0)});
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

// P&L per property: verified bookings only, each property in its own currency. A property whose currency was
// changed can have amounts in more than one currency: one row per currency, never added together.
router.get("/reports/pnl", async (_req, res) => {
  const [props, bookings, tickets, expenses] = await Promise.all([db.select().from(propertiesTable), db.select().from(reservationsTable), db.select().from(maintenanceTicketsTable), db.select().from(accountingTransactionsTable)]);
  const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
  res.json(props.flatMap(p => {
    const home = p.currency || "AED";
    const own = bookings.filter(b => b.propertyId === p.id && !["cancelled", "blocked"].includes(b.status));
    const verified = own.filter(b => b.financeMode === "inclusive-v1");
    const rows = new Map<string, { revenue: number; maintenance: number; other: number }>([[home, { revenue: 0, maintenance: 0, other: 0 }]]);
    const row = (c: string) => { let r = rows.get(c); if (!r) rows.set(c, r = { revenue: 0, maintenance: 0, other: 0 }); return r; };
    for (const b of verified) row(bookingCurrency(b, p)).revenue += cents(b.revenue);
    for (const t of tickets) if (t.propertyId === p.id && t.status === "completed") row(home).maintenance += cents(t.cost);
    for (const t of expenses) if (t.propertyId === p.id && t.type === "expense" && t.allocation === "owner") row(t.currency || home).other += cents(t.amount);
    return [...rows.entries()].map(([currency, r]) => ({ propertyId: p.id, propertyName: p.name, currency, revenue: r.revenue / 100, expenses: (r.maintenance + r.other) / 100, net: (r.revenue - r.maintenance - r.other) / 100, unverifiedBookings: currency === home ? own.length - verified.length : 0 }));
  }));
});

// Platform split: booking counts; revenue is verified net accommodation revenue in the requested currency.
router.get("/reports/platforms", async (req, res) => {
  const currency = String(req.query.currency || "AED");
  const [bookings, props] = await Promise.all([db.select().from(reservationsTable), db.select().from(propertiesTable)]);
  const rows: Record<string, { platform: string; count: number; revenue: number; unverified: number }> = {};
  for (const b of bookings) {
    if (["cancelled", "blocked"].includes(b.status)) continue;
    const r = rows[b.platform] ??= { platform: b.platform, count: 0, revenue: 0, unverified: 0 };
    r.count++;
    if (b.financeMode === "inclusive-v1" && bookingCurrency(b, props.find(p => p.id === b.propertyId)) === currency) r.revenue += Math.round(Number(b.revenue || 0) * 100);
    else if (b.financeMode !== "inclusive-v1") r.unverified++;
  }
  res.json(Object.values(rows).map(r => ({ platform: r.platform, count: r.count, currency, revenue: r.revenue / 100, unverifiedBookings: r.unverified })));
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
router.get("/reports/income", asyncHandler(async (req, res) => {
  const period = incomePeriod(req.query);
  if ("error" in period) return res.status(400).json(period);
  res.json(incomeReport(await incomeData(), period));
}));
router.get("/reports/income/:propertyId", asyncHandler(async (req, res) => {
  const period = incomePeriod(req.query);
  if ("error" in period) return res.status(400).json(period);
  const id = Number(req.params.propertyId);
  const detail = Number.isInteger(id) && id > 0 ? incomePropertyDetail(await incomeData(), id, period) : null;
  if (!detail) return res.status(404).json({ error: "Property not found" });
  res.json(detail);
}));

export default router;
