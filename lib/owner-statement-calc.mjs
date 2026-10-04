// The one owner-statement calculation for a property and a checkout month. Owner statements (generate and
// draft refresh) and Income per property both call it: there is no second formula. Pure: no database access.
import { bookingCurrency, confirmationCode, sortStatementBookings } from "./booking-currency.mjs";

const cents = n => Math.round(Number(n || 0) * 100);
const money = n => (n / 100).toFixed(2);
const s = n => n === 1 ? "" : "s";
const brief = r => ({ id: r.id, guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform });

/** Month bounds exactly as the statement queries compare them (text dates; `-31` covers every month). */
export function monthBounds(month) { return { start: `${month}-01`, end: `${month}-31` }; }
const within = (v, start, end) => typeof v === "string" && v >= start && v <= end;

/** Each entire stay is recognized in its checkout month; cancelled and blocked are never included. */
export function recognizedBookings(bookings, propertyId, month) {
  const { start, end } = monthBounds(month);
  return (bookings || []).filter(r => r.propertyId === propertyId && r.status !== "cancelled" && r.status !== "blocked" && within(String(r.checkOut ?? ""), start, end));
}
/** Owner-charged expenses dated in the month. */
export function ownerExpenses(transactions, propertyId, month) {
  const { start, end } = monthBounds(month);
  return (transactions || []).filter(e => e.propertyId === propertyId && e.type === "expense" && e.allocation === "owner" && within(String(e.date ?? ""), start, end));
}
/** Completed maintenance tickets of the month (all charge types; only owner-charged ones are deducted). */
export function completedTickets(tickets, propertyId, month) {
  const { start, end } = monthBounds(month);
  return (tickets || []).filter(t => t.propertyId === propertyId && t.status === "completed" && within(String(t.completedAt ?? ""), start, `${end}T23:59:59.999Z`));
}

/**
 * property, rules (property settings), and the month's bookings/expenses/tickets (wider arrays are filtered here
 * with the same rules as the statement queries). Returns:
 *  - groups: one per currency, figures in cents over the VERIFIED bookings and the owner entries;
 *  - hold: why a statement can't be generated (the statement's "skipped" item without property/propertyId), or null;
 *  - statement: the statement row values when there is no hold.
 */
export function ownerStatementCalc({ property, rules, bookings, expenses, tickets, month, payouts = [] }) {
  const own = recognizedBookings(bookings, property.id, month);
  const entries = ownerExpenses(expenses, property.id, month);
  const done = completedTickets(tickets, property.id, month);
  const verified = own.filter(r => r.financeMode === "inclusive-v1");
  const unverified = own.filter(r => r.financeMode !== "inclusive-v1");
  // The owner is the Airbnb co-host and Airbnb pays the co-host payout to them directly: every Airbnb booking
  // needs that amount (reservations.cohost_payout, from the breakdown import) before a balance can be worked out.
  const cohostDirect = rules?.cohostPaidToOwner === true;
  const cohostMissing = cohostDirect ? own.filter(r => r.platform === "airbnb" && r.cohostPayout == null) : [];
  // Fee basis "net-payout": every booking must have been calculated on it (actual channel fees, management % of
  // the net payout). A booking calculated on another basis, or without the channel's actual fees, blocks the
  // statement; there is no fallback to a percentage.
  // Fee basis "airbnb-payout": every booking calculated from Airbnb's host figures (gross earnings, host service fee,
  // exact payout); the guest-paid total isn't needed.
  const basis = rules?.feeBasis === "net-payout" || rules?.feeBasis === "airbnb-payout" ? rules.feeBasis : "gross";
  const netBasis = basis === "net-payout";
  const basisOf = r => r.feeBasis === "net-payout" || r.feeBasis === "airbnb-payout" ? r.feeBasis : "gross";
  const wrongBasis = own.filter(r => r.financeMode === "inclusive-v1" && basisOf(r) !== basis);
  const alsoCohost = cohostMissing.filter(r => r.financeMode === "inclusive-v1");
  // Airbnb pays the whole host payout straight to the owner (the owner is the Airbnb host): every Airbnb booking
  // needs Airbnb's exact payout (reservations.airbnb_payout) before the balance can be worked out.
  const payoutDirect = rules?.payoutToOwner === true;
  const payoutMissing = payoutDirect ? own.filter(r => r.platform === "airbnb" && r.airbnbPayout == null) : [];
  const alsoPayout = payoutMissing.filter(r => r.financeMode === "inclusive-v1");
  const maintenanceTickets = rules?.includeMaintenance === false ? [] : done.filter(t => t.chargeType === "owner" && !entries.some(e => e.reference === `maintenance:${t.id}`));
  // One currency per statement. Each booking is in its own currency (stamped when the property's currency
  // changed, else the property's); entries carry theirs. Amounts in different currencies are never added
  // together and there is no exchange rate in the app, so a month that mixes them is not generated.
  const propertyCurrency = property.currency || rules?.currency || "AED";
  const maintenanceCents = maintenanceTickets.reduce((n, t) => n + cents(t.cost), 0);
  const byCurrency = new Map();
  const group = c => { let g = byCurrency.get(c); if (!g) byCurrency.set(c, g = { bookings: [], entries: [], maintenance: 0, all: [] }); return g; };
  for (const r of own) group(bookingCurrency(r, { currency: propertyCurrency })).all.push(r);
  for (const r of verified) group(bookingCurrency(r, { currency: propertyCurrency })).bookings.push(r);
  for (const e of entries) group(e.currency || propertyCurrency).entries.push(e);
  // Maintenance tickets have no currency of their own: they are in the property's currency.
  if (maintenanceCents) group(propertyCurrency).maintenance = maintenanceCents;
  const sumOf = (rows, key) => rows.reduce((n, r) => n + cents(r[key]), 0);
  const figures = (currency, g) => {
    const gross = sumOf(g.bookings, "grossAmount"), vat = sumOf(g.bookings, "vatAmount"), tourism = sumOf(g.bookings, "tourismFee");
    const management = sumOf(g.bookings, "managementAmount"), channel = sumOf(g.bookings, "channelAmount");
    const cleaning = rules?.includeCleaning === false ? 0 : sumOf(g.bookings, "cleaningFee");
    const other = sumOf(g.entries, "amount"), maintenance = g.maintenance;
    const paidByAirbnb = (cohostDirect ? sumOf(g.bookings, "cohostPayout") : 0) + (payoutDirect ? sumOf(g.bookings.filter(r => r.platform === "airbnb"), "airbnbPayout") : 0);
    return { currency, bookings: g.bookings.length, nights: g.bookings.reduce((n, r) => n + Number(r.nights || 0), 0), gross, vat, tourism, channel, management, cleaning, maintenance, other, paidByAirbnb,
      ownerPayout: gross - vat - tourism - channel - management - cleaning - maintenance - other - paidByAirbnb };
  };
  const groups = byCurrency.size ? [...byCurrency.entries()].filter(([, g]) => g.bookings.length || g.entries.length || g.maintenance).map(([c, g]) => figures(c, g)) : [];
  if (!groups.length) groups.push(figures(byCurrency.size === 1 ? [...byCurrency.keys()][0] : propertyCurrency, { bookings: [], entries: [], maintenance: 0 }));

  let hold = null;
  if (unverified.length || alsoCohost.length || wrongBasis.length || alsoPayout.length) {
    const parts = [];
    if (unverified.length) parts.push(`${unverified.length} booking${s(unverified.length)} checked out this month need the guest total verified before a payout can be calculated`);
    if (alsoCohost.length) parts.push(unverified.length ? `${alsoCohost.length} more need the co-host payout` : `Co-host payout missing on ${alsoCohost.length} Airbnb booking${s(alsoCohost.length)}: Airbnb pays it to the owner directly, so it's needed to work out the balance`);
    if (alsoPayout.length) parts.push(`Airbnb payout missing on ${alsoPayout.length} Airbnb booking${s(alsoPayout.length)}: Airbnb pays it to the owner directly, so it's needed to work out the balance`);
    if (wrongBasis.length && basis === "airbnb-payout") parts.push(`${wrongBasis.length} booking${s(wrongBasis.length)} not yet calculated from Airbnb's payout (this property's fee basis): import Airbnb's breakdown on Verify bookings`);
    else if (wrongBasis.length) parts.push(netBasis ? `${wrongBasis.length} booking${s(wrongBasis.length)} not yet calculated on this property's fee basis (management % of the channel net payout): enter the channel's actual fees on Verify` : `${wrongBasis.length} booking${s(wrongBasis.length)} calculated on the net-payout fee basis, but the property now uses the standard basis: save them on Verify to recalculate`);
    const reason = parts.join("; ") + (unverified.length && cohostMissing.length ? " (Airbnb pays the co-host payout to the owner directly, so each Airbnb booking needs it)" : "");
    hold = { reason, unverified: unverified.map(brief), cohostMissing: alsoCohost.map(brief), cohostRequired: cohostDirect,
      ...(payoutDirect ? { payoutMissing: alsoPayout.map(brief), payoutRequired: true } : {}),
      ...(wrongBasis.length ? { feeBasis: basis, feeBasisMismatch: wrongBasis.map(r => ({ ...brief(r), feesMissing: basis === "net-payout" ? r.channelFees == null : basis === "airbnb-payout" ? r.airbnbPayout == null : false })) } : {}) };
  } else {
    const used = [...byCurrency.entries()].filter(([, g]) => g.all.length || g.entries.length || g.maintenance);
    if (used.length > 1) {
      const list = used.map(([currency, g]) => ({ currency, bookings: sortStatementBookings(g.all.map(brief)), entries: g.entries.length + (g.maintenance ? 1 : 0) }));
      const describe = list.map(g => [g.bookings.length ? `${g.bookings.length} booking${s(g.bookings.length)}` : "", g.entries ? `${g.entries} expense${s(g.entries)}` : ""].filter(Boolean).join(" and ") + ` in ${g.currency}`).join(", ");
      hold = { reason: `Mixed currency: ${describe}. Adding them needs an exchange rate, which the app doesn't have or invent, so this statement isn't generated.`, mixedCurrency: list };
    }
  }
  let statement = null;
  if (!hold) {
    const f = groups[0];
    statement = { ownerId: property.ownerId ?? null, propertyId: property.id, month, currency: f.currency, grossRevenue: money(f.gross), vatAmount: money(f.vat), tourismFee: money(f.tourism), platformFees: money(f.channel), managementFee: money(f.management),
      cleaningCosts: money(f.cleaning), maintenanceCosts: money(f.maintenance), otherExpenses: money(f.other), ownerPayout: money(f.ownerPayout), paidByAirbnb: money(f.paidByAirbnb), feeBasis: basis === "gross" ? null : basis,
      bookingsCount: own.length, nightsOccupied: own.reduce((n, r) => n + r.nights, 0),
      bookingDetails: JSON.stringify(sortStatementBookings(own.map(r => {
        // How and when Airbnb paid this booking (payout parts from the Airbnb breakdowns import). An amount sent in
        // another currency (a USD PayPal payout) is shown for reference only; it is never added to the totals.
        const paid = (payouts || []).filter(x => Number(x.reservationId) === Number(r.id)).sort((a, b) => a.part - b.part)
          .map(x => ({ paidOn: x.paidOn ?? null, amount: x.amount == null ? null : String(x.amount), paidTo: x.paidTo ?? null, sentAmount: x.sentAmount == null ? null : String(x.sentAmount), sentCurrency: x.sentCurrency ?? null, reference: x.reference ?? null }));
        return { id: r.id, code: confirmationCode(r.externalId), guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform, grossAmount: r.grossAmount, revenue: r.revenue, vatAmount: r.vatAmount, tourismFee: r.tourismFee, managementAmount: r.managementAmount, channelAmount: r.channelAmount, cleaningFee: r.cleaningFee, ownerAmount: r.ownerAmount, cohostPayout: r.cohostPayout,
          ...(basis !== "gross" ? { channelFees: r.channelFees, managementPercent: r.managementPercent, feeBasis: r.feeBasis } : {}),
          ...(r.airbnbPayout != null ? { airbnbPayout: r.airbnbPayout } : {}), ...(payoutDirect && r.platform === "airbnb" ? { paidToOwnerByAirbnb: true } : {}), ...(paid.length ? { payouts: paid } : {}) };
      }))),
      notes: (basis === "airbnb-payout" ? "Revenue recognized in checkout month." : "Revenue recognized in checkout month. VAT and tourism are extracted from guest total.") + (rules?.includeCleaning === false ? " No cleaning cost is deducted for this property." : " Cleaning deductions use the booking's agreed fee; do not also enter the same charge as an expense.") + (netBasis ? " Management fee is a percentage of the channel net payout (guest total minus the channel's actual fees); platform fees are the channel's actual fees." : "") + (cohostDirect ? " Airbnb pays the co-host payout to the owner directly; it is shown as already paid and deducted from the balance." : "") + (basis === "airbnb-payout" ? " Figures are Airbnb's host earnings: gross earnings (accommodation + cleaning fee), Airbnb's fees (gross earnings minus the payout) and the exact payout Airbnb sent. The guest-paid total isn't in Airbnb's host export, so it isn't shown." : "") + (payoutDirect ? " Airbnb pays the whole payout to the owner directly; it is shown as already paid to the owner and deducted from the balance." : "") };
  }
  return { propertyCurrency, recognized: own, verified, unverified, entries, maintenanceTickets, groups, hold, statement };
}
