// Dubai compliance pack: permit records and renewals, DTCM guest registration per booking, the monthly
// Tourism Dirham and VAT report (CSV) and the record of filed returns.
import { Router } from "express";
import { db, propertiesTable, propertySettingsTable, reservationsTable, propertyPermitsTable, complianceFilingsTable } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { insertAuditLog } from "../lib/audit";
import { addDays, dubaiToday } from "../lib/dubai-date";
import { filingReminder, isDubai, registrationOptions, registrationStatus, renewalReminders, taxReport, taxReportCsv, validatePermit, REGISTRATION_LABEL } from "../../../../lib/compliance.mjs";

const router = Router();
const role = (res: any) => String(res.locals.user?.role ?? "");
const MANAGE = ["admin", "super_admin", "manager"];
const MONEY = [...MANAGE, "accountant"];
const BOOKINGS = [...MANAGE, "reservations", "operations"];
const deny = (res: any, roles: string[]) => (roles.includes(role(res)) ? false : (res.status(403).json({ error: "Your role does not have access to this" }), true));
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const idOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// ── Overview: permits, renewals, filing reminder ──
router.get("/compliance/permits", asyncHandler(async (_req, res) => {
  if (deny(res, MONEY)) return;
  const [properties, permits, filings] = await Promise.all([db.select().from(propertiesTable).orderBy(propertiesTable.name), db.select().from(propertyPermitsTable), db.select().from(complianceFilingsTable)]);
  const today = dubaiToday();
  const active = properties.filter(p => p.status !== "archived");
  const reminders = renewalReminders(permits, active, today);
  res.json({
    today, uploads: false,
    uploadsNote: "Document uploads come with hosting (file storage). Until then, record the reference numbers and dates here and keep the documents where they are now.",
    properties: active.map(p => ({ id: p.id, name: p.name, unitNumber: p.unitNumber, city: p.city, dubai: isDubai(p), permit: permits.find(x => x.propertyId === p.id) ?? null, reminders: reminders.filter(r => r.propertyId === p.id) })),
    reminders,
    filing: filingReminder({ today, filings, hasDubai: active.some(isDubai) }),
    filings: filings.sort((a, b) => b.period.localeCompare(a.period)).slice(0, 24),
  });
}));

router.put("/compliance/permits/:propertyId", asyncHandler(async (req, res) => {
  if (deny(res, MANAGE)) return;
  const id = idOf(req.params.propertyId);
  if (!id) return res.status(400).json({ error: "Invalid property id" });
  const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!property) return res.status(404).json({ error: "Property not found" });
  const v = validatePermit(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const values = { ...v.values, updatedAt: new Date(), updatedBy: res.locals.user?.email ?? null } as any;
  const [before] = await db.select().from(propertyPermitsTable).where(eq(propertyPermitsTable.propertyId, id));
  const [row] = before
    ? await db.update(propertyPermitsTable).set(values).where(eq(propertyPermitsTable.id, before.id)).returning()
    : await db.insert(propertyPermitsTable).values({ propertyId: id, ...values }).returning();
  await insertAuditLog({ action: before ? "update" : "create", entity: "property_permit", entityId: id, details: { before: before ?? null, after: v.values }, performedBy: res.locals.user?.email });
  res.json(row);
}));

// ── Filed returns ──
router.post("/compliance/filings", asyncHandler(async (req, res) => {
  if (deny(res, MONEY)) return;
  const { kind = "tourism_dirham", period, filedOn, reference } = req.body ?? {};
  if (kind !== "tourism_dirham") return res.status(400).json({ error: "Unknown return" });
  if (!MONTH.test(String(period))) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
  const today = dubaiToday();
  const on = filedOn ? String(filedOn) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) return res.status(400).json({ error: "Filed on must be a date, not in the future" });
  if (String(period) >= today.slice(0, 7)) return res.status(400).json({ error: "A month's return can only be filed after the month has ended" });
  const [row] = await db.insert(complianceFilingsTable).values({ kind, period: String(period), filedOn: on, reference: reference ? String(reference).trim().slice(0, 200) : null, filedBy: res.locals.user?.email ?? null }).onConflictDoNothing().returning();
  if (!row) return res.status(409).json({ error: `The ${period} return is already recorded as filed` });
  await insertAuditLog({ action: "create", entity: "compliance_filing", entityId: row.id, details: { kind, period, filedOn: on, reference: row.reference }, performedBy: res.locals.user?.email });
  res.status(201).json(row);
}));
router.delete("/compliance/filings/:id", asyncHandler(async (req, res) => {
  if (deny(res, MANAGE)) return;
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.delete(complianceFilingsTable).where(eq(complianceFilingsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  await insertAuditLog({ action: "delete", entity: "compliance_filing", entityId: id, details: { kind: row.kind, period: row.period, filedOn: row.filedOn, reference: row.reference }, performedBy: res.locals.user?.email });
  res.json({ ok: true });
}));

// ── Monthly Tourism Dirham and VAT report ──
async function reportFor(month: string) {
  const [properties, settings, bookings] = await Promise.all([db.select().from(propertiesTable), db.select().from(propertySettingsTable),
    db.select().from(reservationsTable).where(and(gte(reservationsTable.checkOut, `${month}-01`), lte(reservationsTable.checkOut, `${month}-31`)))]);
  return taxReport({ properties, settings, bookings, month });
}
router.get("/compliance/tax-report", asyncHandler(async (req, res) => {
  if (deny(res, MONEY)) return;
  const month = String(req.query.month ?? dubaiToday().slice(0, 7));
  if (!MONTH.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const [filing] = await db.select().from(complianceFilingsTable).where(and(eq(complianceFilingsTable.kind, "tourism_dirham"), eq(complianceFilingsTable.period, month)));
  res.json({ ...(await reportFor(month)), filing: filing ?? null });
}));
router.get("/compliance/tax-report.csv", asyncHandler(async (req, res) => {
  if (deny(res, MONEY)) return;
  const month = String(req.query.month ?? "");
  if (!MONTH.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  res.setHeader("Content-Disposition", `attachment; filename="tourism-dirham-vat-${month}.csv"`);
  res.type("text/csv; charset=utf-8").send(taxReportCsv(await reportFor(month)));
}));

// ── DTCM guest registration per booking ──
function registrationView(b: any, property: any) {
  const status = registrationStatus(b, property);
  return { reservationId: b.id, status, label: status ? REGISTRATION_LABEL[status] : null, setByHand: Boolean(b.dtcmRegistration) && status === b.dtcmRegistration,
    options: status ? registrationOptions(b).map(v => ({ value: v, label: REGISTRATION_LABEL[v] })) : [], dubai: isDubai(property) };
}
// Dubai bookings from yesterday's check-outs to check-ins in the next 30 days.
router.get("/compliance/registrations", asyncHandler(async (_req, res) => {
  if (deny(res, BOOKINGS)) return;
  const today = dubaiToday();
  const [properties, bookings] = await Promise.all([db.select().from(propertiesTable), db.select().from(reservationsTable).where(and(gte(reservationsTable.checkOut, addDays(today, -1)), lte(reservationsTable.checkIn, addDays(today, 30))))]);
  const rows = bookings.map(b => ({ b, p: properties.find(p => p.id === b.propertyId) })).filter(x => x.p && isDubai(x.p) && registrationStatus(x.b, x.p))
    .sort((a, z) => a.b.checkIn.localeCompare(z.b.checkIn) || a.b.id - z.b.id)
    .map(({ b, p }) => ({ ...registrationView(b, p), guestName: b.guestName, platform: b.platform, checkIn: b.checkIn, checkOut: b.checkOut, propertyId: p!.id, propertyName: p!.name }));
  res.json({ today, bookings: rows, pending: rows.filter(r => r.status === "pending").length });
}));
router.get("/compliance/registrations/:reservationId", asyncHandler(async (req, res) => {
  if (deny(res, [...BOOKINGS, "accountant"])) return;
  const id = idOf(req.params.reservationId);
  const [b] = id ? await db.select().from(reservationsTable).where(eq(reservationsTable.id, id)) : [];
  if (!b) return res.status(404).json({ error: "Booking not found" });
  const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, b.propertyId));
  res.json(registrationView(b, p));
}));
// Registration status is not a money field: it can be changed on any booking, including months already on a sent statement.
router.patch("/compliance/registrations/:reservationId", asyncHandler(async (req, res) => {
  if (deny(res, BOOKINGS)) return;
  const id = idOf(req.params.reservationId);
  const [b] = id ? await db.select().from(reservationsTable).where(eq(reservationsTable.id, id)) : [];
  if (!b) return res.status(404).json({ error: "Booking not found" });
  if (["cancelled", "blocked"].includes(b.status)) return res.status(400).json({ error: "Blocks and cancelled bookings have no guest registration" });
  const status = String(req.body?.status ?? "");
  if (!registrationOptions(b).includes(status)) return res.status(400).json({ error: b.platform === "airbnb" && status === "pending" ? "Airbnb bookings are never 'pending': Airbnb verifies the guest's ID. Choose Airbnb-verified ID, Registered or Not needed." : `Status must be one of: ${registrationOptions(b).join(", ")}` });
  const [row] = await db.update(reservationsTable).set({ dtcmRegistration: status }).where(eq(reservationsTable.id, b.id)).returning();
  await insertAuditLog({ action: "patch", entity: "reservation", entityId: b.id, details: { dtcmRegistration: { from: b.dtcmRegistration ?? null, to: status } }, performedBy: res.locals.user?.email });
  const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, b.propertyId));
  res.json(registrationView(row, p));
}));

export default router;
