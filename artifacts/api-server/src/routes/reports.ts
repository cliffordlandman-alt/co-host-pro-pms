import { financialTotals } from "../../../../lib/reservation-financials.mjs";
import { earningsDate } from "../../../../lib/company-statement.mjs";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, paymentsTable, cleaningTasksTable, maintenanceTicketsTable, airbnbEarningsTable } from "@workspace/db";
import { eq, ne, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

// Keep imported channel earnings separate from full accommodation revenue.
router.get('/reports/revenue',async(req,res)=>{
 const currency=String(req.query.currency || 'AED');
 const [bookings,earnings,properties]=await Promise.all([db.select().from(reservationsTable),db.select().from(airbnbEarningsTable),db.select().from(propertiesTable)]);
 const now=new Date();const months=[];
 for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
 const bs=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.checkIn.startsWith(month));
 const verified=bookings.filter(b=>!['cancelled','blocked'].includes(b.status)&&b.financeMode==='inclusive-v1'&&b.checkOut.startsWith(month)&&(properties.find(p=>p.id===b.propertyId)?.currency||'AED')===currency);
 const es=earnings.filter(e=>e.status==='paid'&&earningsDate(e)?.startsWith(month)&&e.currency===currency);
 months.push({month,currency,bookings:bs.length,revenue:financialTotals(verified,[],properties).totals.find((t:any)=>t.currency===currency)?.accommodationRevenue || 0,airbnbIncome:es.reduce((n,e)=>n+Number(e.amount),0)});
 }res.json(months);
});

// Occupancy rate per property (last 30 days)
router.get("/reports/occupancy", async (req, res) => {
  const props = await db.select().from(propertiesTable).where(eq(propertiesTable.status, "active"));
  const today = new Date(new Date().toISOString().slice(0,10));
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
  const startStr = thirtyDaysAgo.toISOString().split("T")[0];
  const endStr = today.toISOString().split("T")[0];
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
    const start = new Date(startStr);
    for (let d = new Date(start); d < today; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().split("T")[0];
      if (rows.some(r => r.checkIn <= ds && r.checkOut > ds)) occupiedDays++;
    }
    return { propertyId: p.id, propertyName: p.name, occupancyRate: Math.round((occupiedDays / 30) * 100), occupiedDays };
  }));
  res.json(result);
});

// P&L per property
router.get("/reports/pnl", async (req, res) => {
  const props = await db.select().from(propertiesTable);
  const result = await Promise.all(props.map(async (p) => {
    const [rev] = await db.select({ total: sql<string>`coalesce(sum(revenue),0)` })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.propertyId, p.id), ne(reservationsTable.status, "cancelled")));
    const [maint] = await db.select({ total: sql<string>`coalesce(sum(cost),0)` })
      .from(maintenanceTicketsTable)
      .where(eq(maintenanceTicketsTable.propertyId, p.id));
    const [cleaning] = await db.select({ total: sql<string>`coalesce(sum(amount),0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.propertyId, p.id), eq(paymentsTable.type, "cleaning_cost")));
    const revenue = parseFloat(rev.total);
    const expenses = parseFloat(maint.total) + parseFloat(cleaning.total);
    return { propertyId: p.id, propertyName: p.name, revenue, expenses, net: revenue - expenses };
  }));
  res.json(result);
});

// Platform split
router.get("/reports/platforms", async (req, res) => {
  const rows = await db
    .select({ platform: reservationsTable.platform, count: sql<number>`count(*)`, revenue: sql<string>`coalesce(sum(revenue),0)` })
    .from(reservationsTable)
    .where(ne(reservationsTable.status, "cancelled"))
    .groupBy(reservationsTable.platform);
  res.json(rows.map(r => ({ platform: r.platform, count: Number(r.count), revenue: parseFloat(r.revenue) })));
});

export default router;
