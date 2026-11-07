// Income per property, for a month or a calendar year. Every owner figure comes from the owner-statement
// calculation (lib/owner-statement-calc.mjs) or, for a published (sent/paid) statement, from that statement as
// stored; company income comes from the company statement (lib/company-statement.mjs). There is no second formula.
// Without a rate book, each row stays in its own currency and currencies are never added.
// With a rate book (display only), every figure is converted into dirhams and then added. Stored rows are not changed.
import { ownerStatementCalc } from "./owner-statement-calc.mjs";
import { companyStatement } from "./company-statement.mjs";
import { reservationFinancials } from "./reservation-financials.mjs";
import { confirmationCode, sortStatementBookings } from "./booking-currency.mjs";
import { monthEnd, toAed } from "./fx.mjs";

const cents = n => Math.round(Number(n || 0) * 100);
const pad = n => String(n).padStart(2, "0");
const days = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const nextDay = d => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
export const MONEY_KEYS = ["gross", "taxes", "channelFees", "cleaning", "expenses", "managementFee", "ownerShare", "paidByAirbnb", "ownerBalance", "companyIncome", "companyCosts", "companyNet"];

export function periodOf({ month, year }) {
  const months = month ? [month] : Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const start = `${months[0]}-01`, end = `${months.at(-1)}-${pad(days(months.at(-1)))}`;
  return { kind: month ? "month" : "year", ...(month ? { month } : { year: String(year) }), months, start, end, days: months.reduce((n, m) => n + days(m), 0) };
}
const emptyRow = currency => ({ currency, bookings: 0, nights: 0, ...Object.fromEntries(MONEY_KEYS.map(k => [k, 0])) });
/** A statement-calculation group (cents) as a row (cents). */
function rowFromGroup(g, fx, date) {
  const row = { ...emptyRow(g.currency), bookings: g.bookings, nights: g.nights, gross: g.gross, taxes: g.vat + g.tourism, channelFees: g.channel, cleaning: g.cleaning, expenses: g.maintenance + g.other,
    managementFee: g.management, paidByAirbnb: g.paidByAirbnb, ownerBalance: g.ownerPayout, ownerShare: g.ownerPayout + g.paidByAirbnb };
  if (!fx) return row;
  const out = { ...emptyRow("AED"), bookings: row.bookings, nights: row.nights };
  for (const k of MONEY_KEYS) out[k] = convCents(row[k], g.currency, date, fx);
  return out;
}
/** A published statement, as stored, as a row (cents). With a rate book the stored total is shown in dirhams; the statement row is not rewritten. */
function rowFromStatement(st, fx, date) {
  const currency = st.currency || "AED";
  const r = emptyRow(currency);
  const row = { ...r, bookings: Number(st.bookingsCount || 0), nights: Number(st.nightsOccupied || 0), gross: cents(st.grossRevenue), taxes: cents(st.vatAmount) + cents(st.tourismFee), channelFees: cents(st.platformFees), cleaning: cents(st.cleaningCosts),
    expenses: cents(st.maintenanceCosts) + cents(st.otherExpenses), managementFee: cents(st.managementFee), paidByAirbnb: cents(st.paidByAirbnb), ownerBalance: cents(st.ownerPayout), ownerShare: cents(st.ownerPayout) + cents(st.paidByAirbnb) };
  if (!fx) return row;
  const out = { ...emptyRow("AED"), bookings: row.bookings, nights: row.nights };
  for (const k of MONEY_KEYS) out[k] = convCents(row[k], currency, date, fx);
  return out;
}
function addRows(into, row) {
  let t = into.find(r => r.currency === row.currency);
  if (!t) into.push(t = emptyRow(row.currency));
  for (const k of ["bookings", "nights", ...MONEY_KEYS]) t[k] += row[k];
  return into;
}
const toMoney = row => ({ ...row, ...Object.fromEntries(MONEY_KEYS.map(k => [k, row[k] / 100])) });
const convCents = (cents, currency, date, fx) => fx ? Math.round(toAed(cents / 100, currency, date, fx) * 100) : cents;
const sortRows = rows => rows.sort((a, b) => a.currency.localeCompare(b.currency));

/** Occupied nights in the period: nights covered by any non-cancelled, non-blocked stay. */
function occupancy(bookings, propertyId, period) {
  const stays = bookings.filter(b => b.propertyId === propertyId && !["cancelled", "blocked"].includes(b.status) && b.checkIn <= period.end && b.checkOut > period.start);
  let nights = 0;
  if (stays.length) for (let d = period.start; d <= period.end; d = nextDay(d)) if (stays.some(b => b.checkIn <= d && b.checkOut > d)) nights++;
  return { nights, days: period.days, percent: period.days ? Math.round(nights * 1000 / period.days) / 10 : 0 };
}
/** What is known about an unverified booking's money: Airbnb's host payout (not the guest total), else a recorded amount. */
function estimateOf(b, earnings, property) {
  const f = reservationFinancials(b, earnings, property);
  const payouts = f.channelEarnings.filter(e => e.kind === "home");
  if (payouts.length) return payouts.map(e => ({ currency: e.currency, amount: e.amount, source: "Airbnb host payout" }));
  if (f.recordedAmount) return [{ currency: f.currency, amount: f.recordedAmount, source: "Recorded amount" }];
  return [];
}

/** One property, one month: statement figures, unverified bookings, statement status. */
function propertyMonth(data, property, month, fx) {
  const rules = (data.settings || []).find(s => s.propertyId === property.id);
  const calc = ownerStatementCalc({ property, rules, bookings: data.bookings, expenses: data.transactions, tickets: data.tickets, month });
  const found = (data.statements || []).filter(s => s.propertyId === property.id && s.month === month);
  const published = found.length === 1 && found[0].status !== "draft" ? found[0] : null;
  const statement = found.length > 1 ? { status: "duplicate", ids: found.map(s => s.id) } : found.length ? { status: found[0].status, id: found[0].id } : { status: "none" };
  const rateDate = monthEnd(month);
  const rows = published ? [rowFromStatement(published, fx, rateDate)] : calc.groups.map(g => rowFromGroup(g, fx, rateDate));
  const unverified = published ? [] : calc.unverified;
  return { month, calc, published, statement, rows, unverified, held: published ? null : calc.hold?.reason ?? null };
}

function summarizeUnverified(list, data, property, fx, date) {
  const est = [];
  let withoutAmount = 0;
  for (const b of list) { const e = estimateOf(b, data.earnings || [], property); if (!e.length) withoutAmount++; for (const x of e) { const currency = fx ? "AED" : x.currency; const amount = fx ? convCents(cents(x.amount), x.currency, b.checkOut || date, fx) : cents(x.amount); const t = est.find(y => y.currency === currency); if (t) t.amount += amount; else est.push({ currency, amount }); } }
  return { count: list.length, nights: list.reduce((n, b) => n + Number(b.nights || 0), 0), withoutAmount, estimates: sortRows(est).map(e => ({ ...e, amount: e.amount / 100 })) };
}

function companyByProperty(data, period, fx) {
  const cs = companyStatement({ earnings: data.earnings || [], bookings: data.bookings || [], transactions: data.transactions || [], properties: data.properties || [], maintenance: data.tickets || [], settings: data.settings || [] }, period.start, period.end, fx);
  const by = new Map(), other = [];
  for (const l of cs.lines) {
    const pid = l.propertyId ?? null;
    const list = pid == null ? other : (by.get(pid) ?? (by.set(pid, []), by.get(pid)));
    list.push(l);
  }
  return { cs, by, other };
}
function addCompany(rows, lines) {
  for (const l of lines) {
    let r = rows.find(x => x.currency === l.currency);
    if (!r) rows.push(r = emptyRow(l.currency));
    if (l.type === "income") r.companyIncome += cents(l.amount); else r.companyCosts += cents(l.amount);
    r.companyNet = r.companyIncome - r.companyCosts;
  }
  return rows;
}

/** properties, settings, bookings, transactions, tickets, earnings, statements, owners; period { month } or { year }. */
export function incomeReport(data, input, fx = null) {
  const period = periodOf(input);
  const { cs, by, other } = companyByProperty(data, period, fx);
  const owners = data.owners || [];
  const props = (data.properties || []).filter(p => p.status === "active" || (data.bookings || []).some(b => b.propertyId === p.id && b.checkOut >= period.start && b.checkOut <= period.end) || by.has(p.id));
  const properties = props.map(p => {
    const months = period.months.map(m => propertyMonth(data, p, m, fx));
    const rows = months.reduce((acc, m) => { for (const r of m.rows) if (r.bookings || MONEY_KEYS.some(k => r[k])) addRows(acc, r); return acc; }, []);
    addCompany(rows, by.get(p.id) || []);
    if (!rows.length) rows.push(emptyRow(p.currency || "AED"));
    const unverifiedList = months.flatMap(m => m.unverified);
    const statuses = months.map(m => m.statement.status);
    return { propertyId: p.id, name: p.name, unitNumber: p.unitNumber ?? null, currency: fx ? "AED" : (p.currency || "AED"), ownerName: owners.find(o => o.id === p.ownerId)?.name ?? null, hasOwner: !!p.ownerId,
      occupancy: occupancy(data.bookings || [], p.id, period), rows: sortRows(rows).map(toMoney), unverified: summarizeUnverified(unverifiedList, data, p, fx, period.end), estimate: unverifiedList.length > 0,
      statement: period.kind === "month" ? months[0].statement : { published: statuses.filter(s => s === "sent" || s === "paid").length, drafts: statuses.filter(s => s === "draft").length },
      held: period.kind === "month" ? months[0].held : (months.filter(m => m.held).length ? `${months.filter(m => m.held).length} month(s) can't be generated yet` : null) };
  });
  const totals = [];
  for (const p of properties) for (const r of p.rows) addRows(totals, { ...r, ...Object.fromEntries(MONEY_KEYS.map(k => [k, cents(r[k])])) });
  // Unverified bookings are never in these figures: each currency shows how many there are and what Airbnb paid out for them.
  for (const p of properties) {
    if (!p.unverified.count) continue;
    const t = totals.find(r => r.currency === p.currency) ?? (totals.push(emptyRow(p.currency)), totals.at(-1));
    t.unverifiedBookings = (t.unverifiedBookings || 0) + p.unverified.count;
    for (const e of p.unverified.estimates) { const u = totals.find(r => r.currency === e.currency) ?? (totals.push(emptyRow(e.currency)), totals.at(-1)); u.unverifiedEstimate = (u.unverifiedEstimate || 0) + cents(e.amount); }
  }
  for (const t of totals) { t.properties = properties.filter(p => p.rows.some(r => r.currency === t.currency && (r.bookings || MONEY_KEYS.some(k => r[k])))).length; t.unverifiedBookings ||= 0; t.unverifiedEstimate = (t.unverifiedEstimate || 0) / 100; }
  const companyOther = sortRows(addCompany([], other)).map(r => ({ currency: r.currency, income: r.companyIncome / 100, costs: r.companyCosts / 100, net: r.companyNet / 100 }));
  return { period: { kind: period.kind, month: period.month, year: period.year, start: period.start, end: period.end, days: period.days }, properties, totals: sortRows(totals.filter(t => t.properties || t.unverifiedBookings || t.unverifiedEstimate)).map(toMoney), companyOther, companyTotals: cs.totals };
}

/** One property's month (bookings and entries) or year (month by month). */
export function incomePropertyDetail(data, propertyId, input, fx = null) {
  const period = periodOf(input);
  const property = (data.properties || []).find(p => p.id === propertyId);
  if (!property) return null;
  const report = incomeReport({ ...data, properties: [property] }, input, fx);
  const summary = report.properties[0];
  const { by } = companyByProperty(data, period, fx);
  const companyLines = (by.get(propertyId) || []).map(l => ({ id: l.id, date: l.date, description: l.description, category: l.category, currency: l.currency, type: l.type, amount: l.amount, source: l.source }));
  if (period.kind === "year") {
    const months = period.months.map(m => incomeReport({ ...data, properties: [property] }, { month: m }, fx).properties[0]).map((p, i) => ({ month: period.months[i], rows: p.rows, unverified: p.unverified, statement: p.statement, held: p.held, occupancy: p.occupancy }));
    return { property: { id: property.id, name: property.name, currency: fx ? "AED" : (property.currency || "AED") }, period: report.period, summary, months, companyLines };
  }
  const pm = propertyMonth(data, property, period.month, fx);
  const show = (amount, currency, date) => fx ? toAed(amount, currency, date, fx) : amount;
  const earnings = data.earnings || [];
  const bookings = pm.published && pm.published.bookingDetails
    ? sortStatementBookings(JSON.parse(pm.published.bookingDetails)).map(r => { const currency = pm.published.currency || "AED"; const date = r.checkOut; return { ...r, ...Object.fromEntries(["grossAmount", "vatAmount", "tourismFee", "channelAmount", "managementAmount", "cleaningFee", "ownerAmount"].map(k => [k, show(Number(r[k] || 0), currency, date)])), cohostPayout: r.cohostPayout == null ? null : show(Number(r.cohostPayout), currency, date), verified: true, fromStatement: true, currency: fx ? "AED" : currency }; })
    : sortStatementBookings(pm.calc.recognized.map(r => {
      const verified = r.financeMode === "inclusive-v1";
      const currency = reservationFinancials(r, earnings, property).currency;
      return { id: r.id, code: confirmationCode(r.externalId), guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, nights: r.nights, platform: r.platform, verified, currency: fx ? "AED" : currency,
        ...(verified ? { grossAmount: show(Number(r.grossAmount), currency, r.checkOut), vatAmount: show(Number(r.vatAmount || 0), currency, r.checkOut), tourismFee: show(Number(r.tourismFee || 0), currency, r.checkOut), channelAmount: show(Number(r.channelAmount || 0), currency, r.checkOut), managementAmount: show(Number(r.managementAmount || 0), currency, r.checkOut), cleaningFee: show(Number(r.cleaningFee || 0), currency, r.checkOut), ownerAmount: show(Number(r.ownerAmount || 0), currency, r.checkOut), cohostPayout: r.cohostPayout == null ? null : show(Number(r.cohostPayout), currency, r.checkOut) } : { estimate: estimateOf(r, earnings, property).map(e => ({ ...e, amount: show(e.amount, e.currency, r.checkOut), currency: fx ? "AED" : e.currency })) }) };
    }));
  const ownerEntries = pm.published ? null : pm.calc.entries.map(e => { const currency = e.currency || property.currency || "AED"; return { id: e.id, date: e.date, description: e.description, category: e.category, currency: fx ? "AED" : currency, amount: show(Number(e.amount), currency, e.date) }; });
  const maintenance = pm.published ? null : pm.calc.maintenanceTickets.map(t => ({ id: t.id, issue: t.issue, completedAt: String(t.completedAt).slice(0, 10), amount: show(Number(t.cost || 0), property.currency || "AED", String(t.completedAt).slice(0, 10)) }));
  return { property: { id: property.id, name: property.name, currency: fx ? "AED" : (property.currency || "AED") }, period: report.period, summary, bookings, ownerEntries, maintenance, companyLines,
    statement: pm.statement, held: pm.held, publishedFigures: !!pm.published, excludesCleaning: (data.settings || []).find(s => s.propertyId === propertyId)?.includeCleaning === false };
}
