import { propertiesTable, propertySettingsTable, reservationsTable, maintenanceTicketsTable, paymentsTable } from "@workspace/db";
import { and, eq, gt, isNull, inArray } from "drizzle-orm";

/**
 * Changing a property's currency never relabels an amount already recorded.
 * - Bookings with recorded amounts (verified figures, a guest total, an Airbnb payout, fees, a cleaning fee, a balance
 *   or a payment) and no currency of their own are stamped with the OLD currency first (an AED 1,727 booking stays
 *   AED 1,727). Bookings with no amounts at all (e.g. stays from the calendar feed waiting for their figures) have
 *   nothing to relabel: they stay unstamped and follow the new currency, like bookings created afterwards.
 * - Entries, owner statements and Airbnb earnings already store their own currency.
 * - The cleaning cost override without its own currency keeps the old one (its currency is stamped).
 * - Refused (nothing changes) where an amount has no currency of its own and would be relabelled:
 *   the property's cleaning fee setting (unless a new amount, or a blank, is given in the same change),
 *   maintenance tickets with a cost, and payments not linked to a booking.
 * Both copies of the property's currency (properties.currency, property_settings.currency) are set together.
 * There is no conversion and no exchange rate anywhere.
 */
export class CurrencyChangeRefused extends Error {}

export const CURRENCY_RE = /^[A-Z]{3}$/;

/** A booking carries an amount in its property's currency (so a currency change must not relabel it). */
export function hasRecordedAmounts(r: any) {
  if (r.financeMode === "inclusive-v1") return true;
  return ["grossAmount", "revenue", "airbnbPayout", "cohostPayout", "channelFees", "cleaningFee", "balanceDue", "ownerAmount", "managementAmount", "channelAmount"]
    .some(k => r[k] != null && r[k] !== "" && Number(r[k]) !== 0);
}

export async function changePropertyCurrency(tx: any, propertyId: number, to: string, opts: { cleaningFeeGiven: boolean }) {
  if (!CURRENCY_RE.test(to)) throw new CurrencyChangeRefused("Currency must be a 3-letter code such as AED or ZAR");
  const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId)).for("update");
  if (!property) throw new CurrencyChangeRefused("Property not found");
  const [settings] = await tx.select().from(propertySettingsTable).where(eq(propertySettingsTable.propertyId, propertyId));
  const from: string = property.currency || settings?.currency || "AED";
  if (from === to) {
    if (property.currency !== to) await tx.update(propertiesTable).set({ currency: to }).where(eq(propertiesTable.id, propertyId));
    return { changed: false as const, from, to };
  }
  const problems: string[] = [];
  if (settings?.cleaningFee != null && !opts.cleaningFeeGiven)
    problems.push(`The cleaning fee setting (${from} ${Number(settings.cleaningFee).toFixed(2)}) is an amount in ${from}: enter it in ${to}, or clear it, in the same change`);
  const tickets = await tx.select({ id: maintenanceTicketsTable.id }).from(maintenanceTicketsTable)
    .where(and(eq(maintenanceTicketsTable.propertyId, propertyId), gt(maintenanceTicketsTable.cost, "0")));
  if (tickets.length) problems.push(`${tickets.length} maintenance ticket${tickets.length === 1 ? "" : "s"} with a cost: tickets have no currency of their own, so their costs would be relabelled ${to}`);
  const payments = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
    .where(and(eq(paymentsTable.propertyId, propertyId), isNull(paymentsTable.reservationId)));
  if (payments.length) problems.push(`${payments.length} payment${payments.length === 1 ? "" : "s"} not linked to a booking: they have no currency of their own, so they would be relabelled ${to}`);
  if (problems.length) throw new CurrencyChangeRefused(`Currency not changed: ${problems.join("; ")}.`);

  const unstamped = await tx.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId, propertyId), isNull(reservationsTable.currency)));
  const paid = unstamped.length ? new Set((await tx.select({ id: paymentsTable.reservationId }).from(paymentsTable)
    .where(inArray(paymentsTable.reservationId, unstamped.map((r: any) => r.id)))).map((p: any) => p.id)) : new Set();
  const keepIds = unstamped.filter((r: any) => paid.has(r.id) || hasRecordedAmounts(r)).map((r: any) => r.id);
  const kept = keepIds.length ? await tx.update(reservationsTable).set({ currency: from })
    .where(inArray(reservationsTable.id, keepIds)).returning({ id: reservationsTable.id }) : [];
  let cleaningCostCurrencyKept = false;
  if (settings && settings.cleaningCostOverride != null && !settings.cleaningCostCurrency) {
    await tx.update(propertySettingsTable).set({ cleaningCostCurrency: from }).where(eq(propertySettingsTable.propertyId, propertyId));
    cleaningCostCurrencyKept = true;
  }
  await tx.update(propertiesTable).set({ currency: to }).where(eq(propertiesTable.id, propertyId));
  if (settings) await tx.update(propertySettingsTable).set({ currency: to, updatedAt: new Date() }).where(eq(propertySettingsTable.propertyId, propertyId));
  return { changed: true as const, from, to, bookingsKeptInOldCurrency: kept.length, bookingsFollowingNewCurrency: unstamped.length - kept.length, cleaningCostCurrencyKept };
}
