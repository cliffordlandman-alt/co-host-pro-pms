// Outbound calendar (iCal export per property) and the sync-health panel for incoming channel calendars.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db, propertiesTable, reservationsTable, calendarExportsTable, channelSyncHealthTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { insertAuditLog } from "../lib/audit";
import { dubaiToday } from "../lib/dubai-date";
import { syncPropertyIcal } from "../lib/sync-scheduler";
import { outboundDeliveryEnabled } from "../lib/outbound";
import { EXPORT_TARGETS, TOKEN_RE, exportRows, buildIcal, exportPath, feedState, summarizeRows } from "../../../../lib/calendar-export.mjs";

const router = Router();
const FEEDS = [
  { platform: "airbnb", column: "airbnbIcalUrl", label: "Airbnb" },
  { platform: "booking_com", column: "bookingComIcalUrl", label: "Booking.com" },
  { platform: "vrbo", column: "vrboIcalUrl", label: "Vrbo" },
] as const;
const newToken = () => randomBytes(32).toString("base64url");
const canManage = (role?: string) => ["admin", "super_admin", "manager"].includes(role ?? "");
/** Public address of this YallaPMS, once hosted (PUBLIC_APP_URL, e.g. https://app.yallastay.com). Unset on the Mac. */
const publicBaseUrl = () => { const v = String(process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, ""); return /^https:\/\//.test(v) ? v : null; };

// ── Public feed: GET /api/ical/<token>/<airbnb|booking_com|vrbo|all>.ics (no login; the token is the secret) ──
router.get("/ical/:token/:file", asyncHandler(async (req, res) => {
  const token = String(req.params.token);
  const m = /^(airbnb|booking_com|vrbo|all)\.ics$/.exec(String(req.params.file));
  if (!TOKEN_RE.test(token) || !m) return res.status(404).type("text/plain").send("Not found");
  const [exp] = await db.select().from(calendarExportsTable).where(eq(calendarExportsTable.token, token));
  if (!exp) return res.status(404).type("text/plain").send("Not found");
  const [property] = await db.select({ id: propertiesTable.id, status: propertiesTable.status }).from(propertiesTable).where(eq(propertiesTable.id, exp.propertyId));
  if (!property) return res.status(404).type("text/plain").send("Not found");
  const reservations = await db.select({ id: reservationsTable.id, checkIn: reservationsTable.checkIn, checkOut: reservationsTable.checkOut, status: reservationsTable.status, platform: reservationsTable.platform })
    .from(reservationsTable).where(eq(reservationsTable.propertyId, exp.propertyId));
  const rows = exportRows(reservations, { includeChannelBookings: exp.includeChannelBookings, target: m[1], today: dubaiToday() });
  // The in-app "Check link" button sends this header so its own reads are not counted as a channel reading the link.
  if (req.get("x-yallapms-check") !== "1") await db.update(calendarExportsTable).set({ lastFetchedAt: new Date(), fetchCount: sql`${calendarExportsTable.fetchCount} + 1` }).where(eq(calendarExportsTable.id, exp.id));
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.type("text/calendar; charset=utf-8").send(buildIcal(rows));
}));

async function ensureExports(propertyIds: number[]) {
  const existing = await db.select().from(calendarExportsTable);
  const missing = propertyIds.filter(id => !existing.some(e => e.propertyId === id));
  if (missing.length) await db.insert(calendarExportsTable).values(missing.map(propertyId => ({ propertyId, token: newToken() }))).onConflictDoNothing();
  return missing.length ? db.select().from(calendarExportsTable) : existing;
}

// ── Panel: export links and incoming-feed health for every property ──
router.get("/calendar-sync", asyncHandler(async (_req, res) => {
  if (!canManage(res.locals.user?.role)) return res.status(403).json({ error: "Only an administrator or manager can see calendar links" });
  const properties = (await db.select().from(propertiesTable).orderBy(propertiesTable.name)).filter(p => p.status !== "archived");
  const [exports, health, reservations] = await Promise.all([
    ensureExports(properties.map(p => p.id)),
    db.select().from(channelSyncHealthTable),
    db.select({ id: reservationsTable.id, propertyId: reservationsTable.propertyId, checkIn: reservationsTable.checkIn, checkOut: reservationsTable.checkOut, status: reservationsTable.status, platform: reservationsTable.platform }).from(reservationsTable),
  ]);
  const now = new Date(); const today = dubaiToday(now);
  const out = properties.map(p => {
    const exp = exports.find(e => e.propertyId === p.id)!;
    const mine = reservations.filter(r => r.propertyId === p.id);
    const feeds = FEEDS.map(f => {
      const row = health.find(h => h.propertyId === p.id && h.platform === f.platform);
      const configured = Boolean((p as any)[f.column]);
      return { platform: f.platform, label: f.label, configured, state: feedState(row, configured, now), lastAttemptAt: row?.lastAttemptAt ?? null, lastSuccessAt: row?.lastSuccessAt ?? null,
        lastError: row?.lastError ?? null, lastErrorAt: row?.lastErrorAt ?? null, failingSince: row?.failingSince ?? null, lastSummary: row?.lastSummary ?? null };
    });
    return {
      id: p.id, name: p.name, unitNumber: p.unitNumber, status: p.status, feeds,
      export: {
        includeChannelBookings: exp.includeChannelBookings, createdAt: exp.createdAt, rotatedAt: exp.rotatedAt, lastFetchedAt: exp.lastFetchedAt, fetchCount: exp.fetchCount,
        links: EXPORT_TARGETS.map(t => ({ target: t, path: exportPath(exp.token, t), events: summarizeRows(exportRows(mine, { includeChannelBookings: exp.includeChannelBookings, target: t, today })) })),
      },
    };
  });
  const allFeeds = out.flatMap(p => p.feeds.map(f => ({ ...f, propertyId: p.id, propertyName: p.name })));
  res.json({
    publicBaseUrl: publicBaseUrl(), outboundDelivery: outboundDeliveryEnabled(), properties: out,
    summary: { connected: allFeeds.filter(f => f.configured).length, ok: allFeeds.filter(f => f.state === "ok").length, failing: allFeeds.filter(f => f.state === "failing").length,
      alerts: allFeeds.filter(f => f.state === "alert").length, stale: allFeeds.filter(f => f.state === "stale").length, never: allFeeds.filter(f => f.state === "never").length },
  });
}));

const propertyIdOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// Switch "include bookings from other channels" on or off for one property's export.
router.patch("/calendar-sync/:propertyId", asyncHandler(async (req, res) => {
  if (!canManage(res.locals.user?.role)) return res.status(403).json({ error: "Only an administrator or manager can change calendar links" });
  const id = propertyIdOf(req.params.propertyId);
  if (!id || typeof req.body?.includeChannelBookings !== "boolean") return res.status(400).json({ error: "includeChannelBookings (true or false) is required" });
  await ensureExports([id]).catch(() => null);
  const [row] = await db.update(calendarExportsTable).set({ includeChannelBookings: req.body.includeChannelBookings }).where(eq(calendarExportsTable.propertyId, id)).returning();
  if (!row) return res.status(404).json({ error: "Property not found" });
  await insertAuditLog({ action: "update", entity: "calendar_export", entityId: id, details: { includeChannelBookings: row.includeChannelBookings }, performedBy: res.locals.user?.email });
  res.json({ includeChannelBookings: row.includeChannelBookings });
}));

// New secret link: the old one stops working at once (paste the new one into each channel).
router.post("/calendar-sync/:propertyId/rotate", asyncHandler(async (req, res) => {
  if (!canManage(res.locals.user?.role)) return res.status(403).json({ error: "Only an administrator or manager can change calendar links" });
  const id = propertyIdOf(req.params.propertyId);
  if (!id) return res.status(400).json({ error: "Invalid property id" });
  const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!property) return res.status(404).json({ error: "Property not found" });
  await ensureExports([id]);
  const [before] = await db.select().from(calendarExportsTable).where(eq(calendarExportsTable.propertyId, id));
  const token = newToken();
  const [row] = await db.update(calendarExportsTable).set({ token, rotatedAt: new Date(), lastFetchedAt: null, fetchCount: 0 }).where(eq(calendarExportsTable.propertyId, id)).returning();
  // The tokens are redacted by the audit log (lib/redact.mjs): the record shows a rotation happened, never the link.
  await insertAuditLog({ action: "update", entity: "calendar_export", entityId: id, details: { rotated: true, previousToken: before?.token, token, exportLink: exportPath(token, "airbnb") }, performedBy: res.locals.user?.email });
  res.json({ rotatedAt: row.rotatedAt, links: EXPORT_TARGETS.map(t => ({ target: t, path: exportPath(token, t) })) });
}));

// "Sync now" for one incoming channel calendar (the result also lands in the health panel).
router.post("/calendar-sync/:propertyId/sync/:platform", asyncHandler(async (req, res) => {
  if (!canManage(res.locals.user?.role)) return res.status(403).json({ error: "Only an administrator or manager can run a sync" });
  const id = propertyIdOf(req.params.propertyId);
  const platform = String(req.params.platform);
  if (!id || !FEEDS.some(f => f.platform === platform)) return res.status(400).json({ error: "Unknown property or channel" });
  const result = await syncPropertyIcal(id, platform as any);
  res.status(result?.error ? 422 : 200).json(result);
}));

export default router;
