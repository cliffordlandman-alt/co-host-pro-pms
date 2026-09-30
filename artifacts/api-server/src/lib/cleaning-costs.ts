import { db, accountingTransactionsTable, cleaningTasksTable, cleaningCostRatesTable, notificationsTable, propertiesTable, propertySettingsTable, reservationsTable, vendorsTable } from "@workspace/db";
import { and, asc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
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
 * HOW MUCH: the property's cleaning cost override (Fee settings) if set, otherwise the rate card
 * amount for the unit size (bedroom count; 0 = studio).
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

type Cost = { amount: string; currency: string; unitSize: number | null; source: "property override" | "rate card" } | { reason: string; unitSize: number | null };

export function cleaningCostFor(property: Property, settings: { cleaningCostOverride?: string | null } | null | undefined, rates: (typeof cleaningCostRatesTable.$inferSelect)[]): Cost {
  const currency = property.currency || "AED";
  const unitSize = cleaningUnitSize(property);
  if (settings?.cleaningCostOverride != null) return { amount: Number(settings.cleaningCostOverride).toFixed(2), currency, unitSize, source: "property override" };
  if (unitSize == null) return { reason: "Unit size unknown: set the property's bedroom count (0 = studio) or a cleaning cost override", unitSize };
  const rate = rates.find(r => r.bedrooms === unitSize);
  if (!rate) return { reason: `No rate card amount for ${unitLabel(unitSize)}: add one or set a cleaning cost override`, unitSize };
  if (rate.currency !== currency) return { reason: `Rate card is in ${rate.currency} but the property uses ${currency}: set a cleaning cost override`, unitSize };
  return { amount: Number(rate.amount).toFixed(2), currency, unitSize, source: "rate card" };
}

type Plan = { taskId: number | null; reservationId: number; propertyId: number; property: string; checkout: string; unitSize: string; amount: number | null; currency: string | null; action: "record" | "already recorded" | "skip"; reason?: string };

async function planForTask(q: Q, task: typeof cleaningTasksTable.$inferSelect, ctx: { rates: any[]; vendor: any }) {
  const base = { taskId: task.id, reservationId: task.reservationId as number, propertyId: task.propertyId, checkout: task.scheduledDate };
  const [property] = await q.select().from(propertiesTable).where(eq(propertiesTable.id, task.propertyId));
  const plan: Plan = { ...base, property: property?.name ?? `Property #${task.propertyId}`, unitSize: unitLabel(property ? cleaningUnitSize(property) : null), amount: null, currency: null, action: "skip" };
  const [existing] = await q.select().from(accountingTransactionsTable).where(eq(accountingTransactionsTable.cleaningTaskId, task.id));
  if (existing) return { ...plan, amount: Number(existing.amount), currency: existing.currency, action: "already recorded" as const };
  if (!task.reservationId) return { ...plan, reason: "Not a checkout clean" };
  if (task.status === "cancelled") return { ...plan, reason: "Cleaning task cancelled" };
  const [booking] = await q.select().from(reservationsTable).where(eq(reservationsTable.id, task.reservationId));
  if (!booking || ["cancelled", "blocked"].includes(booking.status)) return { ...plan, reason: "Booking cancelled or blocked dates" };
  if (!property) return { ...plan, reason: "Property not found" };
  if (!ctx.vendor) return { ...plan, reason: "No active cleaning company (vendor) set up" };
  const [settings] = await q.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, property.id));
  const cost = cleaningCostFor(property, settings, ctx.rates);
  if ("reason" in cost) return { ...plan, reason: cost.reason };
  return { ...plan, amount: Number(cost.amount), currency: cost.currency, action: "record" as const, reason: cost.source };
}

async function insertExpense(q: Q, plan: Plan, vendorId: number) {
  if (plan.action !== "record" || plan.taskId == null || plan.amount == null) return false;
  const rows = await q.insert(accountingTransactionsTable).values({
    date: plan.checkout, propertyId: plan.propertyId, reservationId: plan.reservationId, type: "expense", category: "Cleaning",
    description: `Checkout clean · ${plan.property} · ${plan.unitSize}`, amount: plan.amount.toFixed(2), currency: plan.currency ?? "AED",
    allocation: "company", reference: `cleaning:${plan.taskId}`, vendorId, cleaningTaskId: plan.taskId,
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
  const plan = await planForTask(db, task, ctx);
  if (plan.action === "record") { await insertExpense(db, plan, ctx.vendor.id); return plan; }
  if (plan.action === "skip") {
    const [already] = await db.select({ id: notificationsTable.id }).from(notificationsTable).where(and(eq(notificationsTable.type, "cleaning_cost"), eq(notificationsTable.entityType, "cleaning"), eq(notificationsTable.entityId, String(task.id))));
    if (!already) await db.insert(notificationsTable).values({ type: "cleaning_cost", title: "Cleaning cost not recorded", message: `${plan.property} (checkout ${plan.checkout}): ${plan.reason}`, link: `/cleaning?task=${task.id}`, entityType: "cleaning", entityId: String(task.id) });
  }
  return plan;
}

/**
 * Backfill: one cleaning expense for every checkout in the last `days` days (Dubai dates, today
 * included) that has a checkout cleaning task and no expense yet. Idempotent; dryRun only previews.
 */
export async function backfillCleaningExpenses({ days = 30, dryRun = true, today = dubaiToday() }: { days?: number; dryRun?: boolean; today?: string }) {
  const from = addDays(today, -days);
  return db.transaction(async tx => {
    const ctx = await context(tx);
    const bookings = await tx.select().from(reservationsTable).where(and(gte(reservationsTable.checkOut, from), lte(reservationsTable.checkOut, today), notInArray(reservationsTable.status, ["cancelled", "blocked"]))).orderBy(asc(reservationsTable.checkOut), asc(reservationsTable.id));
    const tasks = bookings.length ? await tx.select().from(cleaningTasksTable).where(inArray(cleaningTasksTable.reservationId, bookings.map(b => b.id))).orderBy(asc(cleaningTasksTable.id)) : [];
    const properties = await tx.select().from(propertiesTable);
    const items: Plan[] = [];
    for (const b of bookings) {
      const task = tasks.find(t => t.reservationId === b.id && t.status !== "cancelled") ?? tasks.find(t => t.reservationId === b.id);
      if (!task) {
        const p = properties.find(x => x.id === b.propertyId);
        items.push({ taskId: null, reservationId: b.id, propertyId: b.propertyId, property: p?.name ?? `Property #${b.propertyId}`, checkout: b.checkOut, unitSize: unitLabel(p ? cleaningUnitSize(p) : null), amount: null, currency: null, action: "skip", reason: "No checkout cleaning task for this booking" });
        continue;
      }
      items.push(await planForTask(tx, task, ctx));
    }
    let recorded = 0;
    if (!dryRun) for (const item of items) if (await insertExpense(tx, item, ctx.vendor?.id)) recorded++;
    const totals: Record<string, number> = {};
    for (const i of items) if (i.action === "record" && i.amount != null) totals[i.currency ?? "AED"] = Math.round(((totals[i.currency ?? "AED"] ?? 0) + i.amount) * 100) / 100;
    return { from, to: today, dryRun, vendor: ctx.vendor?.name ?? null, items, toRecord: items.filter(i => i.action === "record").length, alreadyRecorded: items.filter(i => i.action === "already recorded").length, skipped: items.filter(i => i.action === "skip").length, totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount })), recorded };
  });
}
