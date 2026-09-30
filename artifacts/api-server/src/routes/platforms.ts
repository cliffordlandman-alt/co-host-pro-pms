import { Router } from "express";
import { db, reservationsTable, propertiesTable, ownersTable, importLogsTable, appSettingsTable } from "@workspace/db";
import { eq, ne, sql, desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";
import { syncPropertyIcal } from "../lib/sync-scheduler";

const router = Router();

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  airbnb:      { label: "Airbnb",          color: "#FF5A5F" },
  booking_com: { label: "Booking.com",     color: "#003580" },
  vrbo:        { label: "Vrbo",            color: "#195591" },
  direct:      { label: "Direct Bookings", color: "#10b981" },
  expedia:     { label: "Expedia",         color: "#FFC107" },
};

// Platform-level stats + property connections
router.get("/platforms", async (_req, res) => {
  // Aggregate from reservations
  const stats = await db
    .select({
      platform: reservationsTable.platform,
      bookings: sql<number>`count(*)`,
      revenue: sql<string>`coalesce(sum(revenue), 0)`,
      nights: sql<number>`coalesce(sum(nights), 0)`,
    })
    .from(reservationsTable)
    .where(ne(reservationsTable.status, "cancelled"))
    .groupBy(reservationsTable.platform);

  // Properties with their iCal URLs
  const properties = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      unitNumber: propertiesTable.unitNumber,
      building: propertiesTable.building,
      status: propertiesTable.status,
      airbnbIcalUrl: propertiesTable.airbnbIcalUrl,
      airbnbListingId: propertiesTable.airbnbListingId,
      bookingComIcalUrl: propertiesTable.bookingComIcalUrl,
      bookingComPropertyId: propertiesTable.bookingComPropertyId,
      vrboIcalUrl: propertiesTable.vrboIcalUrl,
      vrboListingId: propertiesTable.vrboListingId,
      ownerName: ownersTable.name,
    })
    .from(propertiesTable)
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .orderBy(propertiesTable.name);

  // Build platform list — always include the big 4
  const allPlatforms = ["airbnb", "booking_com", "vrbo", "direct"];
  const statMap = Object.fromEntries(stats.map(s => [s.platform, s]));

  const platforms = allPlatforms.map(key => {
    const s = statMap[key];
    const connectedCount = properties.filter(p => {
      if (key === "airbnb") return !!p.airbnbIcalUrl || !!p.airbnbListingId;
      if (key === "booking_com") return !!p.bookingComIcalUrl || !!p.bookingComPropertyId;
      if (key === "vrbo") return !!p.vrboIcalUrl || !!p.vrboListingId;
      if (key === "direct") return true; // always on
      return false;
    }).length;

    return {
      key,
      ...PLATFORM_META[key],
      bookings: s ? Number(s.bookings) : 0,
      revenue: s ? parseFloat(s.revenue) : 0,
      nights: s ? Number(s.nights) : 0,
      connectedCount,
      totalProperties: properties.filter(p => p.status === "active").length,
    };
  });

  res.json({ platforms, properties });
});

// System health — per-property sync status
router.get("/channels/health", async (_req, res) => {
  const properties = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      airbnbListingId: propertiesTable.airbnbListingId,
      airbnbIcalUrl: propertiesTable.airbnbIcalUrl,
      bookingComIcalUrl: propertiesTable.bookingComIcalUrl,
      importStatus: propertiesTable.importStatus,
      photos: propertiesTable.photos,
      status: propertiesTable.status,
    })
    .from(propertiesTable)
    .where(ne(propertiesTable.status, "archived"))
    .orderBy(propertiesTable.name);

  // Last sync times stored in app_settings by key ical_sync_<id>
  const syncKeys = properties.map(p => `ical_sync_${p.id}`);
  const syncSettings = syncKeys.length > 0
    ? await db.select().from(appSettingsTable).where(inArray(appSettingsTable.key, syncKeys))
    : [];
  const syncMap = Object.fromEntries(syncSettings.map(s => [s.key, s.value as any]));

  // Most recent import log per property
  const allLogs = await db
    .select()
    .from(importLogsTable)
    .orderBy(desc(importLogsTable.attemptedAt))
    .limit(200);
  const logMap: Record<number, typeof allLogs[0]> = {};
  for (const log of allLogs) {
    if (log.propertyId && !logMap[log.propertyId]) logMap[log.propertyId] = log;
  }

  const health = properties.map(p => {
    const syncData = syncMap[`ical_sync_${p.id}`];
    const log = logMap[p.id];
    let photoCount = 0;
    try {
      const parsed = JSON.parse(p.photos || "[]");
      photoCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {}
    return {
      id: p.id,
      name: p.name,
      airbnbConnected: !!(p.airbnbListingId || p.airbnbIcalUrl),
      airbnbListingId: p.airbnbListingId,
      iCalConnected: !!p.airbnbIcalUrl,
      bookingComConnected: !!p.bookingComIcalUrl,
      lastSync: syncData?.lastSyncAt ?? null,
      syncCreated: syncData?.created ?? null,
      importStatus: p.importStatus ?? "not_imported",
      photoCount,
      missingPhotos: photoCount === 0,
      lastImportLog: log
        ? {
            status: log.status,
            attemptedAt: log.attemptedAt?.toISOString() ?? null,
            error: log.errorMessage,
            photosImported: log.photosImported === "yes",
            pricesImported: log.pricesImported === "yes",
            amenitiesImported: log.amenitiesImported === "yes",
          }
        : null,
    };
  });

  res.json({ health });
});

// Import audit log
router.get("/channels/import-logs", async (_req, res) => {
  const logs = await db
    .select()
    .from(importLogsTable)
    .orderBy(desc(importLogsTable.attemptedAt))
    .limit(100);
  res.json({ logs: logs.map(l => ({ ...l, attemptedAt: l.attemptedAt?.toISOString() ?? null })) });
});

// ── System Health / QA endpoint ──────────────────────────────────────────────
router.get("/system-health", requireAdmin, async (_req, res) => {
  try {
    const [properties, allImportLogs, reservationRows] = await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(importLogsTable).orderBy(desc(importLogsTable.attemptedAt)).limit(200),
      db.select({ count: sql<number>`count(*)::int` }).from(reservationsTable),
    ]);

    const reservationCount = reservationRows[0]?.count ?? 0;

    const issues: { severity: "critical" | "warning" | "info"; rule: string; propertyId?: number; propertyName?: string; detail: string }[] = [];

    const propAudit = properties.map(p => {
      let photoCount = 0;
      try { photoCount = JSON.parse(p.photos || "[]").length; } catch {}

      const hasListingId = !!p.airbnbListingId;
      const hasIcal = !!p.airbnbIcalUrl || !!p.bookingComIcalUrl;
      const hasPhotos = photoCount > 0;
      const hasPrice = !!p.baseNightlyPrice;
      const hasDescription = !!(p.description && p.description.trim().length > 20);
      const isActive = p.status === "active";
      const hasHtmlEntities = (p.description || "").includes("&amp;") || (p.photos || "").includes("&amp;");
      const unitIsPlaceholder = p.unitNumber === "TBC" || p.unitNumber === "";
      const buildingIsBlank = !p.building;

      if (isActive && !hasListingId && !hasIcal) {
        issues.push({ severity: "critical", rule: "NO_CHANNEL", propertyId: p.id, propertyName: p.name, detail: "Active property has no channel connection (no Airbnb listing ID or iCal URL)" });
      }
      if (!hasPhotos) {
        issues.push({ severity: "critical", rule: "NO_PHOTOS", propertyId: p.id, propertyName: p.name, detail: "No photos imported — listing will appear blank" });
      }
      if (!hasPrice) {
        issues.push({ severity: "warning", rule: "NO_PRICE", propertyId: p.id, propertyName: p.name, detail: "Base nightly price not set — Dynamic Pricing cannot calculate suggestions" });
      }
      if (!hasIcal) {
        issues.push({ severity: "warning", rule: "NO_ICAL", propertyId: p.id, propertyName: p.name, detail: "No iCal URL — reservations cannot sync automatically" });
      }
      if (!hasDescription) {
        issues.push({ severity: "warning", rule: "NO_DESCRIPTION", propertyId: p.id, propertyName: p.name, detail: "Description missing or too short" });
      }
      if (hasHtmlEntities) {
        issues.push({ severity: "critical", rule: "HTML_ENTITIES", propertyId: p.id, propertyName: p.name, detail: "Property data contains raw HTML entities (&amp; etc.) — data was imported with a bug; re-import to fix" });
      }
      if (unitIsPlaceholder) {
        issues.push({ severity: "warning", rule: "PLACEHOLDER_UNIT", propertyId: p.id, propertyName: p.name, detail: `Unit number is "${p.unitNumber || "empty"}" — needs real unit number` });
      }
      if (buildingIsBlank && hasListingId) {
        issues.push({ severity: "info", rule: "NO_BUILDING", propertyId: p.id, propertyName: p.name, detail: "Building name not set — enter the building name for staff clarity" });
      }

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        importStatus: p.importStatus,
        hasListingId,
        hasIcal,
        hasPhotos,
        hasPrice,
        hasDescription,
        hasHtmlEntities,
        unitIsPlaceholder,
        photoCount,
        airbnbListingId: p.airbnbListingId,
        airbnbIcalUrl: p.airbnbIcalUrl,
        building: p.building,
        unitNumber: p.unitNumber,
        bedroomType: p.bedroomType,
        area: p.area,
        createdAt: p.createdAt.toISOString(),
      };
    });

    if (properties.length === 0) {
      issues.push({ severity: "critical", rule: "NO_PROPERTIES", detail: "No properties in the system — import from Airbnb or create manually" });
    }
    if (reservationCount === 0 && properties.length > 0) {
      issues.push({ severity: "info", rule: "NO_RESERVATIONS", detail: "No reservations found — add iCal URLs to sync existing bookings" });
    }

    const importSummary = {
      total: allImportLogs.length,
      successful: allImportLogs.filter(l => l.status === "imported_successfully").length,
      partial: allImportLogs.filter(l => l.status === "partially_imported").length,
      failed: allImportLogs.filter(l => l.status === "failed_import").length,
      lastAttemptAt: allImportLogs[0]?.attemptedAt?.toISOString() ?? null,
    };

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const warningCount = issues.filter(i => i.severity === "warning").length;
    const healthScore = properties.length === 0 ? 0 : Math.max(0,
      Math.round(100 - (criticalCount * 20) - (warningCount * 5))
    );

    res.json({
      healthScore,
      db: { status: "connected", propertyCount: properties.length, reservationCount },
      issues,
      propAudit,
      importSummary,
      importLogs: allImportLogs.slice(0, 50).map(l => ({ ...l, attemptedAt: l.attemptedAt?.toISOString() ?? null })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update a single property's platform connection fields
router.patch("/platforms/property/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const allowed = ["airbnbIcalUrl", "airbnbListingId", "bookingComIcalUrl", "bookingComPropertyId", "vrboIcalUrl", "vrboListingId"];
  const update: Record<string, any> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k] || null;
  }
  const [row] = await db.update(propertiesTable).set(update).where(eq(propertiesTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  // Trigger iCal sync immediately when a URL is saved
  if (update.airbnbIcalUrl)     syncPropertyIcal(id, "airbnb").catch(() => {});
  if (update.bookingComIcalUrl) syncPropertyIcal(id, "booking_com").catch(() => {});

  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

export default router;
