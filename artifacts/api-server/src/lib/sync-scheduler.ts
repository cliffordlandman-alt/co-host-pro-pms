import { db, propertiesTable, reservationsTable, cleaningTasksTable, appSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

function unfoldIcal(raw: string): string {
  return raw.replace(/\r?\n[ \t]/g, "");
}

function parseIcalDate(value: string): string | null {
  const clean = value.replace(/;[^:]*:/g, ":").replace(/^[^:]*:/, "").trim();
  const basic = clean.replace(/[TZ]/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(basic)) return null;
  return `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}`;
}

interface IcalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
}

function parseIcalEvents(raw: string): IcalEvent[] {
  const text = unfoldIcal(raw);
  const events: IcalEvent[] = [];
  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match: RegExpExecArray | null;

  while ((match = veventRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (key: string): string => {
      const re = new RegExp(`^${key}[^:]*:(.*)$`, "im");
      const m = re.exec(block);
      return m ? m[1].trim() : "";
    };

    const uid = get("UID");
    const summary = get("SUMMARY") || "Guest";
    const dtstartRaw = get("DTSTART");
    const dtendRaw = get("DTEND");

    const dtstart = parseIcalDate(dtstartRaw);
    const dtend = parseIcalDate(dtendRaw);

    if (uid && dtstart && dtend && dtstart < dtend) {
      events.push({ uid, summary, dtstart, dtend });
    }
  }

  return events;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const msPerDay = 86400000;
  return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / msPerDay);
}

export async function syncPropertyIcal(propertyId: number, platform: "airbnb" | "booking_com") {
  const [property] = await db
    .select({ 
      id: propertiesTable.id, 
      name: propertiesTable.name,
      airbnbIcalUrl: propertiesTable.airbnbIcalUrl, 
      bookingComIcalUrl: propertiesTable.bookingComIcalUrl,
      cleaningFee: propertiesTable.cleaningFee 
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));

  if (!property) return { error: "Property not found" };
  
  const url = platform === "airbnb" ? property.airbnbIcalUrl : property.bookingComIcalUrl;
  if (!url) return { error: `No ${platform} iCal URL configured` };

  let icalText: string;
  try {
    const parsedUrl = new URL(url);
    const hosts = platform === "airbnb" ? ["airbnb.com","airbnb.co.in","airbnb.co.uk"] : ["booking.com"];
    if(parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || (parsedUrl.port && parsedUrl.port !== "443") || !hosts.some(h=>parsedUrl.hostname===h || parsedUrl.hostname.endsWith('.'+h))) throw new Error("Use an official HTTPS channel calendar export URL");
    const response = await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    icalText = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return { error: `Failed to fetch iCal feed: ${msg}` };
  }

  const events = parseIcalEvents(icalText);
  if (events.length === 0) {
    return { created: 0, skipped: 0, total: 0, message: "No events found in iCal feed" };
  }

  const existing = await db
    .select({ checkIn: reservationsTable.checkIn, notes: reservationsTable.notes })
    .from(reservationsTable)
    .where(and(eq(reservationsTable.propertyId, propertyId), eq(reservationsTable.platform, platform)));

  const existingUids = new Set(
    existing
      .map(r => { const m = r.notes?.match(/ical-uid:([^\s]+)/); return m ? m[1] : null; })
      .filter(Boolean) as string[]
  );
  const existingCheckIns = new Set(existing.map(r => r.checkIn));

  let created = 0;
  let skipped = 0;

  for (const event of events) {
    if (existingUids.has(event.uid) || existingCheckIns.has(event.dtstart)) {
      skipped++;
      continue;
    }

    const nights = nightsBetween(event.dtstart, event.dtend);
    if (nights <= 0) { skipped++; continue; }

    const guestName = platform === "airbnb" 
      ? (event.summary.replace(/\s*-?\s*Airbnb\s*\(.*?\)/i, "").trim() || "Airbnb Guest")
      : (event.summary.trim() || "Booking.com Guest");

    const [row] = await db.insert(reservationsTable).values({
      propertyId,
      guestName,
      platform,
      checkIn: event.dtstart,
      checkOut: event.dtend,
      nights,
      revenue: "0",
      paymentStatus: "pending",
      status: "confirmed",
      notes: `ical-uid:${event.uid}`,
      cleaningFee: property.cleaningFee ?? null,
    }).returning();

    await db.insert(cleaningTasksTable).values({
      propertyId,
      reservationId: row.id,
      status: "dirty",
      scheduledDate: event.dtend,
    });

    existingCheckIns.add(event.dtstart);
    existingUids.add(event.uid);
    created++;
  }

  const result = { created, skipped, total: events.length, lastSyncAt: new Date().toISOString() };
  
  // Update sync status in app_settings
  const syncStatusKey = `ical_sync_${propertyId}`;
  const existingSetting = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, syncStatusKey)).limit(1);
  
  if (existingSetting.length > 0) {
    await db.update(appSettingsTable)
      .set({ value: result, updatedAt: new Date() })
      .where(eq(appSettingsTable.key, syncStatusKey));
  } else {
    await db.insert(appSettingsTable).values({
      key: syncStatusKey,
      value: result
    });
  }

  return result;
}

export async function runAllSyncs() {
  console.log(`[iCal Sync] Starting scheduled sync at ${new Date().toISOString()}`);
  const properties = await db.select().from(propertiesTable);
  
  for (const prop of properties) {
    if (prop.airbnbIcalUrl) {
      const res = await syncPropertyIcal(prop.id, "airbnb");
      console.log(`[iCal Sync] Property: ${prop.name} (Airbnb) - Created: ${res.created}, Skipped: ${res.skipped}`);
    }
    if (prop.bookingComIcalUrl) {
      const res = await syncPropertyIcal(prop.id, "booking_com");
      console.log(`[iCal Sync] Property: ${prop.name} (Booking.com) - Created: ${res.created}, Skipped: ${res.skipped}`);
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
