import { db, accountingTransactionsTable, cleaningTasksTable, cleaningCostRatesTable, notificationsTable, propertiesTable, propertySettingsTable, reservationsTable, vendorsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, like, lte, notInArray, or } from "drizzle-orm";
import { defaultFeeSettings } from "./fee-config";
import { addDays, dubaiToday } from "./dubai-date";

/**
 * Cleaning cost = company expense paid to the external cleaning company, one per checkout clean.
 *
 * WHEN it is recorded: when a checkout cleaning task (a task linked to a reservation) is first
 * marked completed or approved. Never at task creation (bookings are often cancelled or moved), and
 * never twice: accounting_transactions.cleaning_task_id is unique. The expense is dated on the clean's
 * scheduled date (the checkout day), so it lands in the same period as the booking's cleaning fee
 * income. Manual (non-checkout) cleaning tasks are not priced by the rate card.
 *
 * HOW MUCH: the property's cleaning cost override (Fee settings) if set, otherwise - only for
 * properties on the rate card - the rate card amount for the unit size (bedroom count; 0 = studio).
 * Otherwise "no rate set": nothing is recorded and the clean is flagged.
 */
type Q = Pick<typeof db, "select" | "insert">;
type Property = typeof propertiesTable.$inferSelect;

export const unitLabel = (n: number | null) => n == null ? "Unknown size" : n === 0 ? "Studio" : `${n}BR`;

/** Unit size from the property's bedroom count (0 = studio); falls back to the unit type / name text. */
export function cleaningUnitSize(p: Pick<Property, "bedrooms" | "bedroomType" | "name">): number | null {
  if (Number.isInteger(p.bedrooms) && (p.bedrooms as number) > 0) return p.bedrooms as number;
  for (const label of [p.bedroomType, p.name]) {
    if (/\bstudio\b/i.test(label || "")) return 0;
    const m = (label || "").match(/\b(\d+)\s*[- ]?\s*(?:bedrooms?|beds?|br)\b/i);
    if (m) return Number(m[1]);
  }
  return p.bedrooms === 0 ? 0 : null;
}

export async function cleaningVendor(q: Q) {
  const [vendor] = await q.select().from(vendorsTable).where(and(eq(vendorsTable.kind, "cleaning"), eq(vendorsTable.active, true))).orderBy(asc(vendorsTable.id)).limit(1);
  return vendor ?? null;
}

type Cost = { amount: string; currency: string; unitSize: number | null; source: "property override" | "rate card" } | { reason: string; unitSize: number | null; noRate?: boolean };
type CostSettings = { cleaningCostOverride?: string | null; cleaningRateCard?: boolean | null; cleaningCostCurrency?: string | null } | null | undefined;

/**
 * Which cost applies, in this order: the property's override (in its cleaning cost currency, else the
 * property's currency); otherwise, only if the property is on the cleaning company's rate card, the
 * rate for its unit size. Anything else is "no rate set": skipped and flagged, never guessed.
 */
export function cleaningCostFor(property: Property, settings: CostSettings, rates: (typeof cleaningCostRatesTable.$inferSelect)[]): Cost {
  const currency = settings?.cleaningCostCurrency || property.currency || "AED";
  const unitSize = cleaningUnitSize(property);
  if (settings?.cleaningCostOverride != null) return { amount: Number(settings.cleaningCostOverride).toFixed(2), currency, unitSize, source: "property override" };
  const onRateCard = settings ? !!settings.cleaningRateCard : defaultFeeSettings(property).cleaningRateCard;
  if (!onRateCard) return { reason: "not on the cleaning company's rate card and no cleaning cost override", unitSize, noRate: true };
  if (unitSize == null) return { reason: "Unit size unknown: set the property's bedroom count (0 = studio) or a cleaning cost override", unitSize };
  const rate = rates.find(r => r.bedrooms === unitSize);
  if (!rate) return { reason: `the rate card has no ${unitLabel(unitSize)} rate: add one or set a cleaning cost override`, unitSize, noRate: true };
  if (rate.currency !== currency) return { reason: `Rate card is in ${rate.currency} but this property's cleaning is paid in ${currency}: set a cleaning cost override`, unitSize };
  return { amount: Number(rate.amount).toFixed(2), currency, unitSize, source: "rate card" };
}

type Plan = { taskId: number | null; reservationId: number; propertyId: number; property: string; checkout: string; unitSize: string; amount: number | null; currency: string | null; action: "record" | "already recorded" | "skip"; reason?: string; noRate?: boolean };
type Booking = typeof reservationsTable.$inferSelect;
type Task = typeof cleaningTasksTable.$inferSelect;

/** Existing automatic cleaning cost for this clean or this checkout (one per booking). */
async function existingCost(q: Q, taskId: number | null, reservationId: number) {
  const [row] = await q.select().from(accountingTransactionsTable).where(or(
    taskId != null ? eq(accountingTransactionsTable.cleaningTaskId, taskId) : undefined,
    and(eq(accountingTransactionsTable.reservationId, reservationId), like(accountingTransactionsTable.reference, "cleaning:%")),
  ));
  return row ?? null;
}

async function planCheckout(q: Q, booking: Booking | undefined, task: Task | null, ctx: { rates: any[]; vendor: any }) {
  const reservationId = (booking?.id ?? task?.reservationId) as number;
  const propertyId = booking?.propertyId ?? (task as Task).propertyId;
  const [property] = await q.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  const plan: Plan = { taskId: task?.id ?? null, reservationId, propertyId, checkout: task?.scheduledDate ?? (booking as Booking).checkOut, property: property?.name ?? `Property #${propertyId}`, unitSize: unitLabel(property ? cleaningUnitSize(property) : null), amount: null, currency: null, action: "skip" };
  const existing = reservationId ? await existingCost(q, plan.taskId, reservationId) : null;
  if (existing) return { ...plan, amount: Number(existing.amount), currency: existing.currency, action: "already recorded" as const };
  if (!reservationId) return { ...plan, reason: "Not a checkout clean" };
  if (task?.status === "cancelled") return { ...plan, reason: "Cleaning task cancelled" };
  if (!booking || ["cancelled", "blocked"].includes(booking.status)) return { ...plan, reason: "Booking cancelled or blocked dates" };
  if (!property) return { ...plan, reason: "Property not found" };
  if (!ctx.vendor) return { ...plan, reason: "No active cleaning company (vendor) set up" };
  const [settings] = await q.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, property.id));
  const cost = cleaningCostFor(property, settings, ctx.rates);
  if ("reason" in cost) return { ...plan, reason: cost.reason, noRate: cost.noRate };
  return { ...plan, amount: Number(cost.amount), currency: cost.currency, action: "record" as const, reason: task ? cost.source : `${cost.source}; past checkout with no cleaning task` };
}

async function insertExpense(q: Q, plan: Plan, vendorId: number) {
  if (plan.action !== "record" || plan.amount == null) return false;
  const rows = await q.insert(accountingTransactionsTable).values({
    date: plan.checkout, propertyId: plan.propertyId, reservationId: plan.reservationId, type: "expense", category: "Cleaning",
    description: `Checkout clean · ${plan.property} · ${plan.unitSize}`, amount: plan.amount.toFixed(2), currency: plan.currency ?? "AED",
    allocation: "company", reference: plan.taskId != null ? `cleaning:${plan.taskId}` : `cleaning:booking:${plan.reservationId}`, vendorId, cleaningTaskId: plan.taskId,
    notes: `Automatic cleaning cost (${plan.reason}).`,
  }).onConflictDoNothing().returning({ id: accountingTransactionsTable.id });
  return rows.length > 0;
}

async function context(q: Q) {
  return { rates: await q.select().from(cleaningCostRatesTable), vendor: await cleaningVendor(q) };
}

/** Record the cleaning expense for one task (idempotent). Raises one notification if it cannot be priced. */
export async function recordCleaningExpenseForTask(taskId: number) {
  const [task] = await db.select().from(cleaningTasksTable).where(eq(cleaningTasksTable.id, taskId));
  if (!task || !task.reservationId || !["completed", "approved"].includes(task.status)) return null;
  const ctx = await context(db);
  const [booking] = await db.select().from(reservationsTable).where(eq(reservationsTable.id, task.reservationId));
  const plan = await planCheckout(db, booking, task, ctx);
  if (plan.action === "record") { await insertExpense(db, plan, ctx.vendor.id); return plan; }
  if (plan.action === "skip") {
    const [already] = await db.select({ id: notificationsTable.id }).from(notificationsTable).where(and(eq(notificationsTable.type, "cleaning_cost"), eq(notificationsTable.entityType, "cleaning"), eq(notificationsTable.entityId, String(task.id))));
    if (!already) await db.insert(notificationsTable).values({ type: "cleaning_cost", title: "Cleaning cost not recorded", message: `${plan.property} (checkout ${plan.checkout}): ${plan.noRate ? "no rate set, " : ""}${plan.reason}`, link: `/cleaning?task=${task.id}`, entityType: "cleaning", entityId: String(task.id) });
  }
  return plan;
}

/**
 * Backfill: one cleaning expense for every checkout in the period (Dubai dates): the last `days` days
 * (today included) or a calendar month (up to today). A checkout with a cleaning task is costed on that
 * task; a past checkout without one (e.g. imported history) is costed on the booking. Either way, one
 * cost per checkout. Idempotent; dryRun only previews. "No rate set" checkouts are skipped and flagged.
 */
export async function backfillCleaningExpenses({ days = 30, month, dryRun = true, today = dubaiToday() }: { days?: number; month?: string; dryRun?: boolean; today?: string }) {
  let from = addDays(today, -days), to = today;
  if (month) {
    from = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
    if (to > today) to = today;
    if (from > today) return { error: "That month has not started yet (Dubai time)" } as const;
  }
  return db.transaction(async tx => {
    const ctx = await context(tx);
    const bookings = await tx.select().from(reservationsTable).where(and(gte(reservationsTable.checkOut, from), lte(reservationsTable.checkOut, to), notInArray(reservationsTable.status, ["cancelled", "blocked"]))).orderBy(asc(reservationsTable.checkOut), asc(reservationsTable.id));
    const tasks = bookings.length ? await tx.select().from(cleaningTasksTable).where(inArray(cleaningTasksTable.reservationId, bookings.map(b => b.id))).orderBy(asc(cleaningTasksTable.id)) : [];
    const items: Plan[] = [];
    for (const b of bookings) {
      const task = tasks.find(t => t.reservationId === b.id && t.status !== "cancelled") ?? tasks.find(t => t.reservationId === b.id) ?? null;
      items.push(await planCheckout(tx, b, task, ctx));
    }
    let recorded = 0;
    if (!dryRun) for (const item of items) if (await insertExpense(tx, item, ctx.vendor?.id)) recorded++;
    const totals: Record<string, number> = {};
    for (const i of items) if (i.action === "record" && i.amount != null) totals[i.currency ?? "AED"] = Math.round(((totals[i.currency ?? "AED"] ?? 0) + i.amount) * 100) / 100;
    return { error: null, from, to, month: month ?? null, dryRun, vendor: ctx.vendor?.name ?? null, items, toRecord: items.filter(i => i.action === "record").length, alreadyRecorded: items.filter(i => i.action === "already recorded").length, skipped: items.filter(i => i.action === "skip").length, noRateSet: items.filter(i => i.noRate).length, totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount })), recorded };
  });
}
