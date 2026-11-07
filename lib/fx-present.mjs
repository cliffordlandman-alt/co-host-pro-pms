// Fold already-built reports into one dirham total. Does not change stored rows.
import { round2, toAed } from "./fx.mjs";

const INCOME_MONEY = ["gross", "taxes", "channelFees", "cleaning", "expenses", "managementFee", "ownerShare", "paidByAirbnb", "ownerBalance", "companyIncome", "companyCosts", "companyNet", "airbnbFees", "netPayout", "otherDeductions", "unexplained", "expectedManagementFee", "feeDifference", "unverifiedEstimate"];

function addFields(into, row, date, book, keys) {
  const currency = row.currency || "AED";
  for (const k of keys) if (typeof row[k] === "number") into[k] = round2((into[k] || 0) + (toAed(row[k], currency, date, book) || 0));
}

export function presentIncome(report, book) {
  if (!book || !report) return report;
  const date = report.period?.end;
  const properties = (report.properties ?? []).map(p => {
    const row = { currency: "AED", bookings: 0, nights: 0 };
    for (const r of p.rows ?? []) { row.bookings += r.bookings || 0; row.nights += r.nights || 0; addFields(row, r, date, book, INCOME_MONEY); }
    let est = 0;
    for (const e of p.unverified?.estimates ?? []) est += toAed(e.amount, e.currency, date, book) || 0;
    return { ...p, currency: "AED", rows: p.rows?.length ? [row] : p.rows, unverified: p.unverified ? { ...p.unverified, estimates: est ? [{ currency: "AED", amount: round2(est) }] : [] } : p.unverified };
  });
  const total = { currency: "AED", bookings: 0, nights: 0, properties: 0, unverifiedBookings: 0, missingAmounts: 0, propertyNames: [], range: report.period ? { start: report.period.start, end: report.period.end, firstCheckIn: null, lastCheckOut: null } : undefined };
  for (const t of report.totals ?? []) {
    total.bookings += t.bookings || 0; total.nights += t.nights || 0; total.properties += t.properties || 0;
    total.unverifiedBookings += t.unverifiedBookings || 0; total.missingAmounts += t.missingAmounts || 0;
    if (t.propertyNames) total.propertyNames.push(...t.propertyNames);
    if (t.range?.firstCheckIn && (!total.range.firstCheckIn || t.range.firstCheckIn < total.range.firstCheckIn)) total.range.firstCheckIn = t.range.firstCheckIn;
    if (t.range?.lastCheckOut && (!total.range.lastCheckOut || t.range.lastCheckOut > total.range.lastCheckOut)) total.range.lastCheckOut = t.range.lastCheckOut;
    addFields(total, t, date, book, INCOME_MONEY);
  }
  const fold = (rows, keys) => {
    if (!rows?.length) return [];
    const out = { currency: "AED" };
    for (const r of rows) addFields(out, r, date, book, keys);
    return [out];
  };
  return {
    ...report,
    properties,
    totals: report.totals?.length ? [total] : [],
    companyOther: fold(report.companyOther, ["income", "costs", "net"]),
    companyTotals: fold(report.companyTotals, ["income", "expenses", "net"]),
  };
}

export function presentDetail(detail, book) {
  if (!book || !detail) return detail;
  const date = detail.period?.end;
  const fold = (rows, when) => {
    const row = { currency: "AED", bookings: 0, nights: 0 };
    for (const r of rows ?? []) { row.bookings += r.bookings || 0; row.nights += r.nights || 0; addFields(row, r, when, book, INCOME_MONEY); }
    return rows?.length ? [row] : rows;
  };
  const summary = detail.summary ? { ...presentIncome({ period: detail.period, properties: [detail.summary], totals: [] }, book).properties[0], currency: "AED" } : detail.summary;
  const months = detail.months?.map(m => ({ ...m, rows: fold(m.rows, m.month || date), unverified: m.unverified ? { ...m.unverified, estimates: [] } : m.unverified }));
  const moneyKeys = ["grossAmount", "vatAmount", "tourismFee", "channelAmount", "managementAmount", "cleaningFee", "ownerAmount", "cohostPayout"];
  const bookings = detail.bookings?.map(b => {
    const out = { ...b, currency: "AED" };
    for (const k of moneyKeys) if (b[k] != null) out[k] = toAed(b[k], b.currency, b.checkOut, book);
    if (Array.isArray(b.estimate)) out.estimate = b.estimate.map(e => ({ ...e, amount: toAed(e.amount, e.currency, b.checkOut, book), currency: "AED" }));
    return out;
  });
  const ownerEntries = detail.ownerEntries?.map(e => ({ ...e, amount: toAed(e.amount, e.currency, e.date, book), currency: "AED" }));
  const home = detail.property?.currency || "AED";
  const maintenance = detail.maintenance?.map(t => ({ ...t, amount: toAed(t.amount, home, t.completedAt, book) }));
  const companyLines = detail.companyLines?.map(l => ({ ...l, amount: toAed(l.amount, l.currency, l.date, book), currency: "AED" }));
  return { ...detail, property: detail.property ? { ...detail.property, currency: "AED" } : detail.property, summary, months, bookings, ownerEntries, maintenance, companyLines };
}

/** Company statement lines (workbook or bookings) shown and summed in dirhams. */
export function presentCompany(cs, book) {
  if (!book || !cs?.lines) return cs;
  const lines = cs.lines.map(l => ({ ...l, amount: toAed(l.amount, l.currency, l.date || cs.end, book), currency: "AED" }));
  const totals = { income: 0, expenses: 0 };
  const cleaning = {};
  const cents = v => Math.round(Number(v || 0) * 100);
  for (const l of lines) totals[l.type === "income" ? "income" : "expenses"] += cents(l.amount);
  for (const l of lines) {
    const inc = l.category === "Cleaning income" && l.type === "income" || /cleaning/i.test(String(l.category)) && l.type === "income";
    const exp = /^clean(ing|er)$/i.test(String(l.category || "")) && l.type === "expense";
    if (!inc && !exp) continue;
    const c = cleaning.AED ??= { income: 0, expenses: 0, cleans: 0 };
    if (inc) c.income += cents(l.amount); else { c.expenses += cents(l.amount); c.cleans++; }
  }
  return {
    ...cs,
    lines,
    totals: [{ currency: "AED", income: totals.income / 100, expenses: totals.expenses / 100, net: (totals.income - totals.expenses) / 100 }],
    cleaning: Object.values(cleaning).map(c => ({ currency: "AED", income: c.income / 100, expenses: c.expenses / 100, net: (c.income - c.expenses) / 100, cleans: c.cleans })),
  };
}

/** Add rand/other fees that the workbook kept beside the dirham total, without adding money already inside a USD payout. */
export function presentCompanyMonth(summary, book) {
  if (!book || !summary) return summary;
  const month = summary.month;
  let fees = 0, separateNet = 0, separateExpenses = 0;
  const otherCurrencies = (summary.otherCurrencies ?? []).map(o => {
    const counted = toAed(o.countedInCurrency, o.currency, month, book) || 0;
    const sepIncome = toAed(o.separate?.income, o.currency, month, book) || 0;
    const sepExpenses = toAed(o.separate?.expenses, o.currency, month, book) || 0;
    const sepNet = toAed(o.separate?.net, o.currency, month, book) || 0;
    const airbnb = toAed(o.airbnbInAedRevenue, o.currency, month, book) || 0;
    fees += counted; separateNet += sepNet; separateExpenses += sepExpenses;
    return { ...o, currency: "AED", countedInCurrency: counted, airbnbInAedRevenue: airbnb, separate: { ...o.separate, airbnb: toAed(o.separate?.airbnb, o.currency, month, book) || 0, income: sepIncome, expenses: sepExpenses, net: sepNet } };
  });
  const extraRevenue = round2(fees + (summary.otherCurrencies ?? []).reduce((n, o) => n + (toAed(o.separate?.income, o.currency, month, book) || 0) + (toAed(o.separate?.airbnb, o.currency, month, book) || 0), 0));
  const extraExpenses = round2(separateExpenses);
  return {
    ...summary,
    currency: "AED",
    revenue: { ...summary.revenue, total: round2(summary.revenue.total + extraRevenue), other: round2((summary.revenue.other || 0) + extraRevenue) },
    expenses: { ...summary.expenses, total: round2(summary.expenses.total + extraExpenses) },
    profit: round2(summary.profit + extraRevenue - extraExpenses),
    otherCurrencies,
  };
}
