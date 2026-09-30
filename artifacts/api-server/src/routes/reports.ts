import { financialTotals } from "../../../../lib/reservation-financials.mjs";
import { dubaiToday, addDays, addMonths } from "../lib/dubai-date";
import { earningsDate } from "../../../../lib/company-statement.mjs";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, maintenanceTicketsTable, airbnbEarningsTable, accountingTransactionsTable } from "@workspace/db";
import { eq, ne, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Keep imported channel earnings separate from full accommodation revenue.
router.get('/reports/revenue',async(req,res)=>{
 const currency=String(req.query.currency || 'AED');
 const [bookings,earnings,properties]=await Promise.all([db.select().from(reservationsTable),db.select().from(airbnbEarningsTable),db.select().from(propertiesTable)]);
 const thisMonth=dubaiToday().slice(0,7);const months=[];
 for(let i=11;i>=0;i--){const month=addMonths(thisMonth,-i);
 const bs=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.checkIn.startsWith(month));
 const verified=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financeMode==='inclusive-v1'&&b.checkOut.startsWith(month)&&(properties.find(p=>p.id===b.propertyId)?.currency||'AED')===currency);
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

// P&L per property: verified bookings only, each property in its own currency.
router.get("/reports/pnl", async (_req, res) => {
  const [props, bookings, tickets, expenses] = await Promise.all([db.select().from(propertiesTable), db.select().from(reservationsTable), db.select().from(maintenanceTicketsTable), db.select().from(accountingTransactionsTable)]);
  const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
  res.json(props.map(p => {
    const own = bookings.filter(b => b.propertyId === p.id && !["cancelled", "blocked"].includes(b.status));
    const verified = own.filter(b => b.financeMode === "inclusive-v1");
    const revenue = verified.reduce((n, b) => n + cents(b.revenue), 0);
    const maintenance = tickets.filter(t => t.propertyId === p.id && t.status === "completed").reduce((n, t) => n + cents(t.cost), 0);
    const other = expenses.filter(t => t.propertyId === p.id && t.type === "expense" && t.allocation === "owner").reduce((n, t) => n + cents(t.amount), 0);
    return { propertyId: p.id, propertyName: p.name, currency: p.currency || "AED", revenue: revenue / 100, expenses: (maintenance + other) / 100, net: (revenue - maintenance - other) / 100, unverifiedBookings: own.length - verified.length };
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
    if (b.financeMode === "inclusive-v1" && (props.find(p => p.id === b.propertyId)?.currency || "AED") === currency) r.revenue += Math.round(Number(b.revenue || 0) * 100);
    else if (b.financeMode !== "inclusive-v1") r.unverified++;
  }
  res.json(Object.values(rows).map(r => ({ platform: r.platform, count: r.count, currency, revenue: r.revenue / 100, unverifiedBookings: r.unverified })));
});

export default router;
