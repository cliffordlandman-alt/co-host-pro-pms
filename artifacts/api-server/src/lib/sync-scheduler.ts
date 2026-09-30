import { db, propertiesTable, reservationsTable, cleaningTasksTable, appSettingsTable, notificationsTable, ownerStatementsTable } from "@workspace/db";
import { dubaiToday } from "./dubai-date";
import { eq, and, ne } from "drizzle-orm";
import { parseIcalEvents, planIcalSync, type IcalFlag } from "../../../../lib/ical-sync.mjs";

type Platform = "airbnb" | "booking_com" | "vrbo";
const FEEDS: Record<Platform, { column: "airbnbIcalUrl" | "bookingComIcalUrl" | "vrboIcalUrl"; hosts: string[]; label: string }> = {
  airbnb: { column: "airbnbIcalUrl", hosts: ["airbnb.com", "airbnb.ae", "airbnb.co.in", "airbnb.co.uk"], label: "Airbnb" },
  booking_com: { column: "bookingComIcalUrl", hosts: ["booking.com"], label: "Booking.com" },
  vrbo: { column: "vrboIcalUrl", hosts: ["vrbo.com", "homeaway.com"], label: "Vrbo" },
};

async function raiseOnce(tx: any, flag: IcalFlag, reservationId: number | undefined, propertyName: string) {
  const entityId = reservationId ? String(reservationId) : null;
  if (entityId) {
    const [open] = await tx.select({ id: notificationsTable.id }).from(notificationsTable)
      .where(and(eq(notificationsTable.type, flag.type), eq(notificationsTable.entityId, entityId), eq(notificationsTable.read, false))).limit(1);
    if (open) return;
  }
  const titles: Record<string, string> = { ical_overlap: "Possible double booking", ical_missing: "Booking missing from channel calendar", ical_reappeared: "Cancelled stay still on channel calendar", ical_dates_changed: "Channel changed booking dates", ical_locked: "Channel change needs an adjustment" };
  await tx.insert(notificationsTable).values({ type: flag.type, title: `${titles[flag.type] || "Channel calendar"} · ${propertyName}`, message: flag.message, link: reservationId ? `/reservations/${reservationId}` : null, entityType: "reservation", entityId });
}

export async function syncPropertyIcal(propertyId: number, platform: Platform) {
  const feed = FEEDS[platform];
  if (!feed) return { error: "Unsupported channel" };
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return { error: "Property not found" };
  const url = property[feed.column];
  if (!url) return { error: `No ${feed.label} iCal URL configured` };

  let icalText: string;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || (parsedUrl.port && parsedUrl.port !== "443") || !feed.hosts.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith("." + h))) throw new Error("Use an official HTTPS channel calendar export URL");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    icalText = await response.text();
    if (!/BEGIN:VCALENDAR/.test(icalText)) throw new Error("The link did not return a calendar");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return { error: `Failed to fetch iCal feed: ${msg}` };
  }

  const events = parseIcalEvents(icalText);
  const today = dubaiToday();
  const result = await db.transaction(async tx => {
    // Same lock as manual booking saves, so a sync and a manual edit cannot interleave on one property.
    await tx.select({ id: propertiesTable.id }).from(propertiesTable).where(eq(propertiesTable.id, propertyId)).for("update");
    const existing = await tx.select().from(reservationsTable).where(eq(reservationsTable.propertyId, propertyId));
    const plan = planIcalSync({ platform, events, existing, today });
    const lockedMonths = new Set((await tx.select({ month: ownerStatementsTable.month }).from(ownerStatementsTable)
      .where(and(eq(ownerStatementsTable.propertyId, propertyId), ne(ownerStatementsTable.status, "draft")))).map(s => s.month));
    let created = 0, updated = 0, released = 0, flagged = 0;
    for (const row of plan.inserts) {
      const { flag, ...values } = row;
      const [inserted] = await tx.insert(reservationsTable).values({ ...values, propertyId, cleaningFee: values.status === "blocked" ? null : property.cleaningFee ?? null } as any).onConflictDoNothing({ target: reservationsTable.externalId }).returning();
      if (!inserted) continue;
      created++;
      if (inserted.status !== "blocked" && inserted.checkOut >= today) await tx.insert(cleaningTasksTable).values({ propertyId, reservationId: inserted.id, status: "dirty", scheduledDate: inserted.checkOut, scheduledTime: "11:00", price: inserted.cleaningFee });
      if (flag) { await raiseOnce(tx, flag, inserted.id, property.name); flagged++; }
    }
    for (const u of plan.updates) {
      const target = existing.find(r => r.id === u.id)!;
      const newCheckOut = u.patch.checkOut ?? target.checkOut;
      const moves = u.patch.checkIn !== undefined || u.patch.status !== undefined;
      if (moves && target.financeMode === "inclusive-v1" && (lockedMonths.has(target.checkOut.slice(0, 7)) || lockedMonths.has(newCheckOut.slice(0, 7)))) {
        await raiseOnce(tx, { type: "ical_locked", message: `${feed.label} changed ${target.checkIn} → ${target.checkOut} to ${u.patch.checkIn ?? target.checkIn} → ${newCheckOut}, but the stay is on a published owner statement. Record an adjustment.` }, u.id, property.name);
        flagged++; continue;
      }
      await tx.update(reservationsTable).set(u.patch).where(eq(reservationsTable.id, u.id));
      if (u.released) released++; else updated++;
      const tasks = await tx.select().from(cleaningTasksTable).where(eq(cleaningTasksTable.reservationId, u.id));
      for (const t of tasks) {
        if (["approved", "completed"].includes(t.status)) continue;
        if (u.patch.status === "cancelled") await tx.update(cleaningTasksTable).set({ status: "cancelled" }).where(eq(cleaningTasksTable.id, t.id));
        else if (u.patch.checkOut) await tx.update(cleaningTasksTable).set({ scheduledDate: u.patch.checkOut }).where(eq(cleaningTasksTable.id, t.id));
      }
    }
    for (const f of plan.flags) { await raiseOnce(tx, f, f.reservationId, property.name); flagged++; }
    return { created, updated, released, flagged, unchanged: plan.unchanged, total: events.length };
  });

  const status = { ...result, platform, lastSyncAt: new Date().toISOString() };
  const syncStatusKey = `ical_sync_${propertyId}`;
  const existingSetting = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, syncStatusKey)).limit(1);
  if (existingSetting.length > 0) await db.update(appSettingsTable).set({ value: status, updatedAt: new Date() }).where(eq(appSettingsTable.key, syncStatusKey));
  else await db.insert(appSettingsTable).values({ key: syncStatusKey, value: status });
  return { ...status, skipped: result.unchanged };
}

export async function runAllSyncs() {
  console.log(`[iCal Sync] Starting scheduled sync at ${new Date().toISOString()}`);
  const properties = await db.select().from(propertiesTable);
  for (const prop of properties) {
    for (const platform of Object.keys(FEEDS) as Platform[]) {
      if (!prop[FEEDS[platform].column]) continue;
      try {
        const res: any = await syncPropertyIcal(prop.id, platform);
        console.log(`[iCal Sync] ${prop.name} (${FEEDS[platform].label}) - ${res.error ? "Error: " + res.error : `Created ${res.created}, updated ${res.updated}, released ${res.released}, flagged ${res.flagged}`}`);
      } catch (err) {
        console.error(`[iCal Sync] ${prop.name} (${FEEDS[platform].label}) failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(`[iCal Sync] Finished scheduled sync at ${new Date().toISOString()}`);
}

export function startSyncScheduler() {
  // Run every 15 minutes
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  setInterval(runAllSyncs, FIFTEEN_MINUTES);
  
  // Also run once on startup after a short delay
  setTimeout(runAllSyncs, 10000);
}
