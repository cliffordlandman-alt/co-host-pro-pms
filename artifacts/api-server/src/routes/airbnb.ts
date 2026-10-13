import { Router } from "express";
import { db, importLogsTable } from "@workspace/db";

// The Airbnb link import (reading public Airbnb listing pages for photos, descriptions and amenities) is switched
// off at Clifford's request (4 Oct 2026). Nothing in YallaPMS fetches airbnb.com listing pages any more.
// Properties it created, and their import logs, are kept. Calendars still sync through the Airbnb iCal link, and
// reservations and earnings still come in through the CSV imports.
const router = Router();
export const AIRBNB_LINK_IMPORT_OFF = "Importing from Airbnb listing links has been switched off, and LaunchRiot no longer reads Airbnb listing pages. Add a property on the Properties page, connect its Airbnb calendar with the iCal link (Platforms or Calendar sync), and bring in reservations and earnings with the CSV imports.";
const gone = (_req: any, res: any) => res.status(410).json({ error: AIRBNB_LINK_IMPORT_OFF });
router.post("/airbnb/import", gone);
router.post("/airbnb/check-duplicates", gone);
// Was a manual iCal resync for Airbnb and Booking.com; the same sync is "Sync now" on Calendar sync (or POST /properties/:id/sync-ical).
router.post("/airbnb/resync/:propertyId", (_req, res) => res.status(410).json({ error: "This address was removed with the Airbnb link import. Use Sync now on the Calendar sync page; calendar sync itself is unchanged." }));

// History of past link imports (read only), still shown on System Health.
router.get("/airbnb/import-logs", async (_req, res) => {
  const logs = await db.select().from(importLogsTable).orderBy(importLogsTable.attemptedAt);
  res.json(logs.map(l => ({ ...l, attemptedAt: l.attemptedAt.toISOString() })));
});

export default router;
