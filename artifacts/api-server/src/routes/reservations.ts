import { reservationFinancials } from "../../../../lib/reservation-financials.mjs";
import { dubaiToday } from "../lib/dubai-date";
import { airbnbEarningsTable } from "@workspace/db";
import { bedroomCount, bookingFinance } from "../../../../lib/booking-finance.mjs";
import { loadPropertyFeeSettings, ratesFromSettings } from "../lib/fee-config";
import { Router } from "express";
import { db, reservationsTable, propertiesTable, insertReservationSchema, cleaningTasksTable, propertySettingsTable, ownerStatementsTable, paymentsTable } from "@workspace/db";
import { eq, and, ne, lt, gt, inArray } from "drizzle-orm";
import { insertAuditLog } from "../lib/audit";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";

const router = Router();

// ─── Shared column selection (identical for list and detail) ──────────────────

const reservationSelect = {
  externalId: reservationsTable.externalId,
  currency: propertiesTable.currency,
  guestEmail: reservationsTable.guestEmail,
  guestPhone: reservationsTable.guestPhone,
  idCollected: reservationsTable.idCollected,
  channelPercent: reservationsTable.channelPercent,
  channelAmount: reservationsTable.channelAmount,
  tourismRate: reservationsTable.tourismRate,
  id: reservationsTable.id,
  guestName: reservationsTable.guestName,
  platform: reservationsTable.platform,
  propertyId: reservationsTable.propertyId,
  propertyName: propertiesTable.name,
  checkIn: reservationsTable.checkIn,
  checkOut: reservationsTable.checkOut,
  nights: reservationsTable.nights,
  revenue: reservationsTable.revenue,
  grossAmount: reservationsTable.grossAmount,
  managementPercent: reservationsTable.managementPercent,
  managementAmount: reservationsTable.managementAmount,
  tourismFee: reservationsTable.tourismFee,
  tourismRooms: reservationsTable.tourismRooms,
  tourismNights: reservationsTable.tourismNights,
  vatAmount: reservationsTable.vatAmount,
  vatRate: reservationsTable.vatRate,
  ownerAmount: reservationsTable.ownerAmount,
  financeMode: reservationsTable.financeMode,

  cleaningFee: reservationsTable.cleaningFee,
  balanceDue: reservationsTable.balanceDue,
  paymentStatus: reservationsTable.paymentStatus,
  notes: reservationsTable.notes,
  status: reservationsTable.status,
  createdAt: reservationsTable.createdAt,
} as const;

function formatReservation(r: {
  revenue: string | null;
  cleaningFee: string | null;
  balanceDue: string | null;
  createdAt: Date;
  [key: string]: unknown;
}, earnings: any[] = []) {
  return {
    financials: reservationFinancials(r,earnings),
    ...r,
    ...Object.fromEntries(["channelPercent", "channelAmount", "tourismRate", "grossAmount", "managementPercent", "managementAmount", "tourismFee", "vatAmount", "vatRate", "ownerAmount"].map(key => [key, r[key] == null ? null : Number(r[key])])),
    revenue: parseFloat(r.revenue || "0"),
    cleaningFee: r.cleaningFee != null ? parseFloat(r.cleaningFee) : null,
    balanceDue: r.balanceDue != null ? parseFloat(r.balanceDue) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// Rates and derived amounts are decided by the server, never taken from the browser.
const SERVER_FINANCE_FIELDS = ["managementPercent", "managementAmount", "channelPercent", "channelAmount", "vatRate", "vatAmount", "tourismRate", "tourismFee", "tourismNights", "ownerAmount", "dubaiCharges"];

/**
 * Builds the booking's financial snapshot.
 * - New calculation (new booking, first verification, property change, or refreshRates): rates come
 *   from the property's fee settings (lib/fee-config.ts).
 * - Editing an already verified booking: the rates snapshotted on that booking are kept, so a later
 *   change to the property's fee settings never rewrites past bookings.
 * The calculation itself (lib/booking-finance.mjs) is unchanged.
 */
async function prepareFinance(body: any, existing?: any) {
  const refreshRates = body.refreshRates === true;
  const tourismRoomsHint = body.tourismRooms;
  const clean: any = { ...body };
  for (const f of [...SERVER_FINANCE_FIELDS, "refreshRates", "tourismRooms"]) delete clean[f];
  const input: any = { ...(existing ?? {}), ...clean };
  if (input.financeMode !== "inclusive-v1") return input;
  const loaded = await loadPropertyFeeSettings(db, Number(input.propertyId));
  if (!loaded) throw new Error("Choose an existing property");
  const { property, settings } = loaded;
  for (const field of ["checkIn", "checkOut"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input[field]) || new Date(input[field]).toISOString().slice(0,10) !== input[field]) throw new Error("Enter valid booking dates");
  }
  const nights = (Date.parse(input.checkOut)-Date.parse(input.checkIn))/86400000;
  const keepSnapshot = !refreshRates && existing?.financeMode === "inclusive-v1" && Number(existing.propertyId) === Number(input.propertyId) && existing.managementPercent != null;
  const current = ratesFromSettings(settings, input.platform);
  const rates = keepSnapshot ? {
    managementPercent: Number(existing.managementPercent),
    channelPercent: existing.platform === input.platform && existing.channelPercent != null ? Number(existing.channelPercent) : current.channelPercent,
    vatRate: Number(existing.vatRate ?? 0),
    tourismEnabled: Number(existing.tourismRooms) > 0,
    tourismRate: Number(existing.tourismRate ?? current.tourismRate),
  } : current;
  // Cleaning fee: the amount entered for this booking, else the booking's saved snapshot, else the
  // property's cleaning fee from its fee settings (the single source), snapshotted onto the booking.
  if (clean.cleaningFee === undefined || clean.cleaningFee === null || clean.cleaningFee === "") {
    input.cleaningFee = existing?.cleaningFee ?? settings.cleaningFee ?? 0;
  }
  const rooms = bedroomCount(property) ?? Number(tourismRoomsHint ?? existing?.tourismRooms);
  const finance = bookingFinance({total: input.grossAmount, managementPercent: rates.managementPercent,
    cleaningFee: input.cleaningFee ?? 0, nights, rooms, dubai: rates.tourismEnabled,
    vatRate: rates.vatRate, tourismRate: rates.tourismRate, tourismEnabled: rates.tourismEnabled,
    channelPercent: rates.channelPercent});
  const result = {...input, ...finance, nights};
  for (const field of ["channelPercent", "channelAmount", "tourismRate", "revenue", "grossAmount", "managementPercent", "managementAmount", "tourismFee", "vatAmount", "vatRate", "ownerAmount", "cleaningFee", "balanceDue"]) {
    if (result[field] != null) result[field] = String(result[field]);
  }
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/reservations", asyncHandler(async (req, res) => {
  const { propertyId, status } = req.query as { propertyId?: string; status?: string };

  const conditions = [];
  if (propertyId) conditions.push(eq(reservationsTable.propertyId, parseInt(propertyId)));
  if (status) conditions.push(eq(reservationsTable.status, status));

  const rows = await db
    .select(reservationSelect)
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(reservationsTable.checkIn);

  // Only load the Airbnb earnings that belong to the listed bookings (not the whole earnings table on every request).
  const codes=[...new Set(rows.map(r=>r.externalId).filter((x):x is string=>!!x&&x.startsWith("airbnb:")).map(x=>x.slice(7)))];
  const earnings=codes.length?await db.select().from(airbnbEarningsTable).where(inArray(airbnbEarningsTable.confirmationCode,codes)):[];
  res.json(rows.map(r=>formatReservation(r,earnings)));
}));

// Rates the server will apply to a new calculation for this property and channel (read-only preview
// for the booking forms; available to anyone who can create reservations).
router.get("/reservations/rates", asyncHandler(async (req, res) => {
  const propertyId = parseId(String(req.query.propertyId ?? ""));
  if (propertyId === null) return res.status(400).json({ error: "Choose a property" });
  const loaded = await loadPropertyFeeSettings(db, propertyId);
  if (!loaded) return res.status(404).json({ error: "Property not found" });
  const platform = String(req.query.platform || "direct");
  return res.json({ propertyId, platform, currency: loaded.settings.currency || loaded.property.currency || "AED", ...ratesFromSettings(loaded.settings, platform) });
}));

router.get("/reservations/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db
    .select(reservationSelect)
    .from(reservationsTable)
    .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
    .where(eq(reservationsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  const code=row.externalId?.startsWith("airbnb:")?row.externalId.slice(7):null;
  return res.json(formatReservation(row,code?await db.select().from(airbnbEarningsTable).where(eq(airbnbEarningsTable.confirmationCode,code)):[]));
}));


function validateBooking(input: any) {
  if (!input.guestName?.trim()) throw new Error("Guest name is required");
  input.guestName = input.guestName.trim();
  for (const key of ["checkIn", "checkOut"]) {
    const date = new Date(input[key]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input[key]) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input[key]) throw new Error("Enter valid booking dates");
  }
  input.nights = (Date.parse(input.checkOut)-Date.parse(input.checkIn))/86400000;
  if (input.nights <= 0) throw new Error("Checkout must be after check-in");
  if (!["confirmed","checked_in","checked_out","cancelled","blocked"].includes(input.status ?? "confirmed")) throw new Error("Invalid reservation status");
  if (!["pending","partial","paid","unknown"].includes(input.paymentStatus ?? "pending")) throw new Error("Invalid payment status");
  for (const key of ["revenue","cleaningFee","balanceDue"]) {
    if (input[key] != null) {
      if (!/^\d+(\.\d{1,2})?$/.test(String(input[key]))) throw new Error("Enter valid non-negative amounts");
      input[key] = String(input[key]);
    }
  }
  if (input.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.guestEmail)) throw new Error("Enter a valid guest email");
  return input;
}
async function saveBooking(input: any, id?: number) {
 return db.transaction(async tx => {
  const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id,Number(input.propertyId))).for("update");
  if (!property) throw new Error("Choose an existing property");
  const [existing] = id ? await tx.select().from(reservationsTable).where(eq(reservationsTable.id,id)).for("update") : [];
  const availabilityChanged = !existing || ["propertyId","checkIn","checkOut","status"].some(k=>(existing as any)[k]!==input[k]);
  if (input.status !== "cancelled" && availabilityChanged) {
   const conflicts = await tx.select({id:reservationsTable.id}).from(reservationsTable).where(and(eq(reservationsTable.propertyId,input.propertyId), ne(reservationsTable.status,"cancelled"),lt(reservationsTable.checkIn,input.checkOut),gt(reservationsTable.checkOut,input.checkIn),id ? ne(reservationsTable.id,id) : undefined));
   if (conflicts.length) throw new Error("These dates overlap an existing reservation or blocked dates");
  }
  const locked = await tx.select({id:ownerStatementsTable.id}).from(ownerStatementsTable).where(and(inArray(ownerStatementsTable.propertyId,[input.propertyId,...(existing?[existing.propertyId]:[])]),inArray(ownerStatementsTable.month,[input.checkOut.slice(0,7),...(existing?[existing.checkOut.slice(0,7)]:[])]),ne(ownerStatementsTable.status,"draft")));
  if (locked.length && (!existing || ["propertyId","financeMode","grossAmount","revenue","managementPercent","managementAmount","cleaningFee","channelPercent","channelAmount","vatRate","vatAmount","tourismRate","tourismFee","ownerAmount","checkIn","checkOut","status"].some(k=>String((existing as any)[k])!==String(input[k])))) throw new Error("This booking belongs to a published statement. Finance changes require an adjustment.");
  const [row] = id ? await tx.update(reservationsTable).set(input).where(eq(reservationsTable.id,id)).returning() : await tx.insert(reservationsTable).values(input).returning();
  // Keep the payments ledger and the booking balance in step: a balance change made on the booking itself
  // (e.g. choosing "Paid") is posted as a payment or reversal, so the two can never disagree.
  if (row.financeMode==="inclusive-v1" && row.balanceDue!=null && (!existing || (existing.financeMode==="inclusive-v1" && existing.balanceDue!=null))) {
   const cents=(v:unknown)=>Math.round(Number(v||0)*100);
   const paidNow=cents(row.grossAmount)-cents(row.balanceDue), paidBefore=existing ? cents(existing.grossAmount)-cents(existing.balanceDue) : 0;
   const delta=paidNow-paidBefore, today=dubaiToday();
   if (delta!==0) await tx.insert(paymentsTable).values({type:delta>0?"guest_payment":"guest_refund",reservationId:row.id,propertyId:row.propertyId,amount:(Math.abs(delta)/100).toFixed(2),status:"paid",paidAt:today,dueDate:today,description:delta>0?`Recorded from booking #${row.id} payment status`:`Reversal recorded from booking #${row.id} payment status`});
  }
  const tasks = await tx.select().from(cleaningTasksTable).where(eq(cleaningTasksTable.reservationId,row.id));
  if (["cancelled","blocked"].includes(row.status)) {
   for (const task of tasks) if (!["approved","completed"].includes(task.status)) await tx.update(cleaningTasksTable).set({status:"cancelled"}).where(eq(cleaningTasksTable.id,task.id));
  } else if (!tasks.length) {
   await tx.insert(cleaningTasksTable).values({propertyId:row.propertyId,reservationId:row.id,status:"dirty",scheduledDate:row.checkOut,scheduledTime:"11:00"});
  } else {
   for (const task of tasks) if (!["approved","completed"].includes(task.status)) await tx.update(cleaningTasksTable).set({propertyId:row.propertyId,scheduledDate:row.checkOut,status:task.status==="cancelled"?"dirty":task.status}).where(eq(cleaningTasksTable.id,task.id));
  }
  return row;
 });
}
router.post("/reservations", asyncHandler(async (req, res) => {
 try {
  let input = validateBooking(await prepareFinance({...req.body}));
  const total = Number(input.grossAmount ?? input.revenue ?? 0);
  input.balanceDue = input.paymentStatus === "unknown" ? null : String(input.paymentStatus === "paid" ? 0 : input.balanceDue ?? total);
  if (Number(input.balanceDue)>total) throw new Error("Balance cannot exceed booking total");
  const parsed = insertReservationSchema.safeParse(input);
  if (!parsed.success) return res.status(400).json({error:parsed.error.message});
  const row = await saveBooking(parsed.data);
  await insertAuditLog({action:"create",entity:"reservation",entityId:row.id,performedBy:req.headers["x-user-id"] as string});
  return res.status(201).json(formatReservation(row));
 } catch(e) { return res.status(400).json({error:(e as Error).message}); }
}));
router.patch("/reservations/:id", asyncHandler(async (req,res)=>{
 const id = parseId(req.params.id);
 if (!id) return res.status(400).json({error:"Invalid id"});
 const [existing] = await db.select().from(reservationsTable).where(eq(reservationsTable.id,id));
 if (!existing) return res.status(404).json({error:"Not found"});
 try {
  let input = validateBooking(await prepareFinance({...req.body}, existing));
  if (existing.financeMode === "inclusive-v1" && input.financeMode !== "inclusive-v1") throw new Error("Financial calculation cannot be removed");
  const total = Number(input.grossAmount ?? input.revenue ?? 0);
  const previousPaid = Math.max(0,Number(existing.grossAmount ?? existing.revenue)-Number(existing.balanceDue ?? 0));
  input.balanceDue = input.paymentStatus === "unknown" ? null : String(input.paymentStatus === "paid" ? 0 : req.body.balanceDue ?? (input.paymentStatus === "pending" ? total : Math.max(0,total-previousPaid)));
  if (Number(input.balanceDue)>total || (input.paymentStatus==="partial" && (Number(input.balanceDue)<=0 || Number(input.balanceDue)>=total))) throw new Error("Enter the outstanding balance for a partial payment");
  delete input.id; delete input.createdAt;
  const parsed = insertReservationSchema.safeParse(input);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const row = await saveBooking(parsed.data,id);
  await insertAuditLog({action:"update",entity:"reservation",entityId:id,performedBy:req.headers["x-user-id"] as string});
  return res.json(formatReservation(row));
 } catch(e) {return res.status(400).json({error:(e as Error).message});}
}));
router.delete("/reservations/:id", (_req,res)=>res.status(409).json({error:"Cancel the reservation instead to preserve its payment and cleaning history"}));
export default router;
