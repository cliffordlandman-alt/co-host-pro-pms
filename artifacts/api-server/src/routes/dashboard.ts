import { financialTotals } from "../../../../lib/reservation-financials.mjs";
import { Router } from "express";
import {
  db, propertiesTable, reservationsTable, cleaningTasksTable,
  maintenanceTicketsTable, paymentsTable, ownersTable,
} from "@workspace/db";
import { eq, and, gte, lte, ne, gt, lt, sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const monthStart = today.slice(0, 7) + "-01";

  const [financialBookings,financialProperties]=await Promise.all([db.select().from(reservationsTable),db.select().from(propertiesTable)]);
  const allFinance=financialTotals(financialBookings,[],financialProperties);
  const monthFinance=financialTotals(financialBookings,[],financialProperties,monthStart,today.slice(0,7)+"-31");

  // Counts
  const [[totalProps], [cleaningPending], [maintenanceOpen], [urgentIssues], [paymentsPending], [revenueAll], [revenueMonth]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(propertiesTable),
    db.select({ count: sql<number>`count(*)` }).from(cleaningTasksTable).where(and(ne(cleaningTasksTable.status, "approved"), ne(cleaningTasksTable.status,"cancelled"))),
    db.select({ count: sql<number>`count(*)` }).from(maintenanceTicketsTable).where(ne(maintenanceTicketsTable.status, "completed")),
    db.select({ count: sql<number>`count(*)` }).from(maintenanceTicketsTable).where(and(eq(maintenanceTicketsTable.priority, "emergency"), ne(maintenanceTicketsTable.status, "completed"))),
    db.select({ count: sql<number>`count(*)` }).from(paymentsTable).where(eq(paymentsTable.status, "pending")),
    db.select({ total: sql<string>`coalesce(sum(revenue),0)` }).from(reservationsTable).where(and(ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked"))),
    db.select({ total: sql<string>`coalesce(sum(revenue),0)` }).from(reservationsTable).where(and(ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked"), gte(reservationsTable.checkOut, monthStart), lte(reservationsTable.checkOut, today.slice(0,7)+"-31"))),
  ]);

  // Today's arrivals (check-ins)
  const todayArrivals = await db
    .select({
      id: reservationsTable.id,
      guestName: reservationsTable.guestName,
      platform: reservationsTable.platform,
      propertyName: propertiesTable.name,
      unitNumber: propertiesTable.unitNumber,
      nights: reservationsTable.nights,
      revenue: reservationsTable.revenue,
      paymentStatus: reservationsTable.paymentStatus,
    })
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(and(eq(reservationsTable.checkIn, today), ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked")));

  // Today's departures (check-outs)
  const todayDepartures = await db
    .select({
      id: reservationsTable.id,
      guestName: reservationsTable.guestName,
      platform: reservationsTable.platform,
      propertyName: propertiesTable.name,
      unitNumber: propertiesTable.unitNumber,
      nights: reservationsTable.nights,
      revenue: reservationsTable.revenue,
      paymentStatus: reservationsTable.paymentStatus,
    })
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(and(eq(reservationsTable.checkOut, today), ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked")));

  // Next 7 days arrivals
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];
  const upcomingArrivals = await db
    .select({
      id: reservationsTable.id,
      guestName: reservationsTable.guestName,
      platform: reservationsTable.platform,
      propertyName: propertiesTable.name,
      checkIn: reservationsTable.checkIn,
      checkOut: reservationsTable.checkOut,
      nights: reservationsTable.nights,
    })
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(and(gte(reservationsTable.checkIn, today), lte(reservationsTable.checkIn, nextWeekStr), ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked")))
    .orderBy(reservationsTable.checkIn)
    .limit(6);

  // Property occupancy grid
  const allProps = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      unitNumber: propertiesTable.unitNumber,
      building: propertiesTable.building,
      bedroomType: propertiesTable.bedroomType,
      status: propertiesTable.status,
      ownerName: ownersTable.name,
    })
    .from(propertiesTable)
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .where(eq(propertiesTable.status, "active"));

  const occupiedRes = await db
    .select({ propertyId: reservationsTable.propertyId, guestName: reservationsTable.guestName, checkOut: reservationsTable.checkOut })
    .from(reservationsTable)
    .where(and(lte(reservationsTable.checkIn, today), gt(reservationsTable.checkOut, today), ne(reservationsTable.status, "cancelled"), ne(reservationsTable.status, "blocked")));

  const propertyGrid = allProps.map(p => {
    const res = occupiedRes.find(r => r.propertyId === p.id);
    return { ...p, occupied: !!res, currentGuest: res?.guestName ?? null, checkOut: res?.checkOut ?? null };
  });

  const occupiedCount = propertyGrid.filter(p=>p.occupied).length;
  const totalPropsCount = allProps.length;
  const availableCount = Math.max(0, totalPropsCount - occupiedCount);

  // Urgent cleaning & maintenance alerts
  const urgentCleaning = await db
    .select({ id: cleaningTasksTable.id, propertyName: propertiesTable.name, scheduledDate: cleaningTasksTable.scheduledDate, status: cleaningTasksTable.status })
    .from(cleaningTasksTable)
    .leftJoin(propertiesTable, eq(cleaningTasksTable.propertyId, propertiesTable.id))
    .where(and(and(ne(cleaningTasksTable.status, "approved"), ne(cleaningTasksTable.status,"cancelled")), lte(cleaningTasksTable.scheduledDate, today)))
    .limit(3);

  const urgentMaintenance = await db
    .select({ id: maintenanceTicketsTable.id, issue: maintenanceTicketsTable.issue, propertyName: propertiesTable.name, priority: maintenanceTicketsTable.priority })
    .from(maintenanceTicketsTable)
    .leftJoin(propertiesTable, eq(maintenanceTicketsTable.propertyId, propertiesTable.id))
    .where(and(ne(maintenanceTicketsTable.status, "completed"), eq(maintenanceTicketsTable.priority, "emergency")))
    .limit(3);

  res.json({
    todayCheckIns: todayArrivals.length,
    todayCheckOuts: todayDepartures.length,
    occupiedUnits: occupiedCount,
    availableUnits: availableCount,
    cleaningPending: Number(cleaningPending.count),
    maintenanceOpen: Number(maintenanceOpen.count),
    paymentsPending: Number(paymentsPending.count),
    urgentIssues: Number(urgentIssues.count),
    totalRevenue: allFinance.totals.find((t:any)=>t.currency==="AED")?.accommodationRevenue || 0,
    financialTotals:allFinance,
    monthRevenue: monthFinance.totals.find((t:any)=>t.currency==="AED")?.accommodationRevenue || 0,
    monthFinancialTotals:monthFinance,
    totalProperties: totalPropsCount,
    todayArrivals: todayArrivals.map(r => ({ ...r, revenue: parseFloat(r.revenue || "0") })),
    todayDepartures: todayDepartures.map(r => ({ ...r, revenue: parseFloat(r.revenue || "0") })),
    upcomingArrivals: upcomingArrivals,
    propertyGrid,
    urgentCleaning,
    urgentMaintenance,
  });
});

export default router;
