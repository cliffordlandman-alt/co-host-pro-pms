import { Router } from "express";
import { db, propertiesTable, ownersTable, insertPropertySchema, appSettingsTable, importLogsTable } from "@workspace/db";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { syncPropertyIcal } from "../lib/sync-scheduler";
import { insertAuditLog } from "../lib/audit";
import { checkPropertyLimit } from "../lib/auth-middleware";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";

const router = Router();

// ─── Shared column selections ─────────────────────────────────────────────────

const propertyBaseSelect = {
  id: propertiesTable.id,
  name: propertiesTable.name,
  unitNumber: propertiesTable.unitNumber,
  building: propertiesTable.building,
  area: propertiesTable.area,
  ownerId: propertiesTable.ownerId,
  ownerName: ownersTable.name,
  bedroomType: propertiesTable.bedroomType,
  status: propertiesTable.status,
  airbnbIcalUrl: propertiesTable.airbnbIcalUrl,
  bookingComIcalUrl: propertiesTable.bookingComIcalUrl,
  listingUrl: propertiesTable.listingUrl,
  photos: propertiesTable.photos,
  description: propertiesTable.description,
  createdAt: propertiesTable.createdAt,
} as const;

const propertyListSelect = {
  city: propertiesTable.city, country: propertiesTable.country, currency: propertiesTable.currency, bedrooms: propertiesTable.bedrooms, cleaningFee: propertiesTable.cleaningFee, managementFee: propertiesTable.managementFee,
  ...propertyBaseSelect,
  airbnbListingId: propertiesTable.airbnbListingId,
  importStatus: propertiesTable.importStatus,
} as const;

const propertyDetailSelect = {
  airbnbSnapshot: propertiesTable.airbnbSnapshot,
  currency: propertiesTable.currency,
  beds: propertiesTable.beds,
  city: propertiesTable.city,
  country: propertiesTable.country,
  houseRules: propertiesTable.houseRules,
  baseNightlyPrice: propertiesTable.baseNightlyPrice,
  ...propertyBaseSelect,
  amenities: propertiesTable.amenities,
  bedrooms: propertiesTable.bedrooms,
  bathrooms: propertiesTable.bathrooms,
  guestCapacity: propertiesTable.guestCapacity,
  checkInInstructions: propertiesTable.checkInInstructions,
  wifiDetails: propertiesTable.wifiDetails,
  accessDetails: propertiesTable.accessDetails,
  cleaningFee: propertiesTable.cleaningFee,
  managementFee: propertiesTable.managementFee,
  importedOwnerName: propertiesTable.importedOwnerName,
  importedOwnerEmail: propertiesTable.importedOwnerEmail,
} as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/properties", asyncHandler(async (req, res) => {
  const { ownerId } = req.query as { ownerId?: string };
  const base = db
    .select(propertyListSelect)
    .from(propertiesTable)
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .orderBy(propertiesTable.name);
  const rows = ownerId
    ? await base.where(eq(propertiesTable.ownerId, parseInt(ownerId)))
    : await base;
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
}));

router.get("/properties/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
    .select(propertyDetailSelect)
    .from(propertiesTable)
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .where(eq(propertiesTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ ...row, createdAt: row.createdAt.toISOString() });
}));

router.post("/properties", checkPropertyLimit, asyncHandler(async (req, res) => {
  const parsed = insertPropertySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(propertiesTable).values(parsed.data).returning();

  await insertAuditLog({
    action: "create",
    entity: "property",
    entityId: row.id,
    details: row,
    performedBy: req.headers["x-user-id"] as string,
  });

  let reservationsImported = 0;
  if (row.airbnbIcalUrl) {
    const syncRes = await syncPropertyIcal(row.id, "airbnb").catch(() => ({ created: 0 }));
    reservationsImported += (syncRes as { created?: number }).created ?? 0;
  }
  if (row.bookingComIcalUrl) {
    const syncRes = await syncPropertyIcal(row.id, "booking_com").catch(() => ({ created: 0 }));
    reservationsImported += (syncRes as { created?: number }).created ?? 0;
  }

  return res.status(201).json({ ...row, createdAt: row.createdAt.toISOString(), reservationsImported });
}));

router.post("/properties/batch", checkPropertyLimit, asyncHandler(async (req, res) => {
  const { properties } = req.body as { properties?: unknown[] };
  if (!Array.isArray(properties) || properties.length === 0) {
    return res.status(400).json({ error: "properties array is required" });
  }

  const incomingIds = (properties as Record<string, unknown>[])
    .map(p => p.airbnbListingId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const existingDuplicates = new Set<string>();
  if (incomingIds.length > 0) {
    const existing = await db
      .select({ airbnbListingId: propertiesTable.airbnbListingId })
      .from(propertiesTable)
      .where(inArray(propertiesTable.airbnbListingId, incomingIds));
    for (const row of existing) {
      if (row.airbnbListingId) existingDuplicates.add(row.airbnbListingId);
    }
  }

  const created: object[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  let reservationsImported = 0;

  for (const prop of properties) {
    const parsed = insertPropertySchema.safeParse(prop);
    if (parsed.success) {
      const listingId = parsed.data.airbnbListingId;
      if (listingId && existingDuplicates.has(listingId)) {
        duplicates.push(listingId);
        continue;
      }
      const [row] = await db.insert(propertiesTable).values(parsed.data).returning();
      created.push({ ...row, createdAt: row.createdAt.toISOString() });

      if (row.airbnbListingId) {
        await db.update(importLogsTable)
          .set({ propertyId: row.id })
          .where(and(
            eq(importLogsTable.listingId, row.airbnbListingId),
            isNull(importLogsTable.propertyId)
          ))
          .catch(() => {});
      }

      if (row.airbnbIcalUrl) {
        const syncRes = await syncPropertyIcal(row.id, "airbnb").catch(() => ({ created: 0 }));
        reservationsImported += (syncRes as { created?: number }).created ?? 0;
      }
      if (row.bookingComIcalUrl) {
        const syncRes = await syncPropertyIcal(row.id, "booking_com").catch(() => ({ created: 0 }));
        reservationsImported += (syncRes as { created?: number }).created ?? 0;
      }
    } else {
      errors.push(parsed.error.message);
    }
  }

  return res.status(201).json({ created, errors, duplicates, reservationsImported });
}));

router.patch("/properties/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const parsed=insertPropertySchema.partial().safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db
    .update(propertiesTable)
    .set(parsed.data)
    .where(eq(propertiesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  await insertAuditLog({
    action: "update",
    entity: "property",
    entityId: id,
    details: req.body,
    performedBy: req.headers["x-user-id"] as string,
  });

  // Trigger iCal sync whenever a URL is saved/updated
  const body = req.body as Record<string, unknown>;
  if (body.airbnbIcalUrl)      syncPropertyIcal(id, "airbnb").catch(() => {});
  if (body.bookingComIcalUrl)  syncPropertyIcal(id, "booking_com").catch(() => {});

  return res.json({ ...row, createdAt: row.createdAt.toISOString() });
}));

router.delete("/properties/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  await db.delete(propertiesTable).where(eq(propertiesTable.id, id));

  await insertAuditLog({
    action: "delete",
    entity: "property",
    entityId: id,
    performedBy: req.headers["x-user-id"] as string,
  });

  return res.status(204).send();
}));

router.get("/properties/:id/sync-status", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const syncStatusKey = `ical_sync_${id}`;
  const [setting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, syncStatusKey)).limit(1);
  if (!setting) return res.json({ lastSyncAt: null, lastSyncResult: null });
  return res.json(setting.value);
}));

// ─── Sync iCal endpoint ────────────────────────────────────────────────────────

router.post("/properties/:id/sync-ical", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid property id" });

  const airbnbRes = await syncPropertyIcal(id, "airbnb");
  const bookingRes = await syncPropertyIcal(id, "booking_com");
  const vrboRes = await syncPropertyIcal(id, "vrbo");

  return res.json({ airbnb: airbnbRes, booking: bookingRes, vrbo: vrboRes });
}));

export default router;
