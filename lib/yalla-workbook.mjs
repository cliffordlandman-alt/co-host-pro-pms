// YALLA monthly workbook export. M2: Income Input and Expense Input; M3: Monthly Summary, Apartment Performance,
// Dashboard (+ the Lists & Sources sheet their formulas read), in the master workbook's exact sheet names, layout,
// column order and formulas (YALLA_Financial_Report_with_Forecast.xlsm). Rules: /workspace/finance/yalla_export_spec.md
// (Raju, 9 Oct 2026). Every behaviour behind an open finance answer is a setting in ./yalla-config.mjs.
import { earningsDate } from './company-statement.mjs';
import { leaseAccruals } from './lease-schedule.mjs';
import { excelDate, STYLE } from './xlsx-writer.mjs';
import { fillTemplate, loadTemplate } from './xlsx-template.mjs';
import { TEMPLATE_GZ_B64, MASTER_SHA256 } from './yalla-master-template.mjs';
export { MASTER_SHA256 };
import { workbookConfig, MASTER_INCOME_CATEGORIES, MASTER_EXPENSE_CATEGORIES, MASTER_PAYMENT_STATUSES, MASTER_TREATMENTS, MASTER_PROPERTY_ORDER } from './yalla-config.mjs';

export { MASTER_EXPENSE_CATEGORIES, MASTER_INCOME_CATEGORIES };
export const USD_AED = 3.6725;
export const INCOME_HEADERS = ['Date', 'Category', 'Property', 'Owner / Payer', 'Description', 'Gross Income (AED)', 'Direct Cost (AED)', 'Net Income (AED)', 'Status', 'Month', 'Source', 'Data View', 'Original Airbnb (USD)', 'FX Rate'];
export const EXPENSE_HEADERS = ['Date', 'Category', 'Property', 'Paid By', 'Description', 'Amount (AED)', 'Payment Status', 'Accounting Treatment', 'Month'];
export const TREATMENT_LABEL = { company: 'Operating Expense', owner_paid: 'Owner Paid (excluded)', pass_through: 'Pass-through (excluded)', deposit: 'Refundable Deposit' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const cents = v => Math.round(Number(v || 0) * 100);
const r2 = n => Math.round(n * 100) / 100;
export const effectiveTreatment = t => t.treatment || (t.allocation === 'owner' ? 'owner_paid' : 'company');
export const monthEnd = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthLabel = iso => `${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const dayLabel = iso => `${Number(iso.slice(8, 10))} ${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "8 Aug-7 Nov 2026" in one year, else "8 Aug 2026-7 Aug 2027" (the master's wording). */
const rangeLabel = (a, b) => a.slice(0, 4) === b.slice(0, 4) ? `${dayLabel(a).slice(0, -5)}-${dayLabel(b)}` : `${dayLabel(a)}-${dayLabel(b)}`;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const addMonthsDate = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10); };
const countWord = n => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][n] ?? String(n);
/** Monthly Summary months: summaryMonths from summaryFirstMonth, moved to end on the reporting month if outside. */
export function summaryWindow(c, month) {
  let first = c.summaryFirstMonth;
  if (month < first || month > addMonths(first, c.summaryMonths - 1)) first = addMonths(month, -(c.summaryMonths - 1));
  return Array.from({ length: c.summaryMonths }, (_, i) => addMonths(first, i));
}

export function mapExpenseCategory(t, treatment, cfg = workbookConfig()) {
  if (t.reportCategory) return t.reportCategory;
  const raw = String(t.category || '').trim();
  if (treatment === 'pass_through' && /dewa/i.test(`${raw} ${t.description || ''}`)) return 'DEWA';
  const exact = MASTER_EXPENSE_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  return exact ?? cfg.expenseCategoryMap[raw.toLowerCase()] ?? (raw || 'Other');
}
export function mapIncomeCategory(t, cfg = workbookConfig()) {
  if (t.reportCategory) return t.reportCategory;
  const raw = String(t.category || '').trim();
  const exact = MASTER_INCOME_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  return exact ?? cfg.incomeCategoryMap[raw.toLowerCase()] ?? (raw || 'Other');
}

/** Payout date of an Airbnb payout: its own date; else the year inferred from its booking check-ins. A year "fits"
 *  when the payout falls between the day before a check-in and 120 days after it; the payout is flagged when no
 *  year or more than one year fits, when its lines point to different dates (most lines win, a tie goes to the later
 *  date), or when it has no booking lines (the export year is assumed). */
const FIT_DAYS = 120;
function payoutDate(p, lines, year) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.sourceDate || '')) return { date: p.sourceDate };
  const votes = new Map(); for (const e of lines) { const d = earningsDate({ sourceDate: p.sourceDate, checkIn: e.checkIn }); if (d) votes.set(d, (votes.get(d) ?? 0) + 1); }
  // Most booking lines win; a tie goes to the later date.
  const inferred = [...votes.keys()].sort((a, b) => votes.get(b) - votes.get(a) || b.localeCompare(a));
  if (!inferred.length) {
    const date = earningsDate({ sourceDate: p.sourceDate, checkIn: `${year}-01-01` });
    return { date, inferred: true, ambiguous: date ? `no booking lines; year ${year} assumed` : null };
  }
  const md = inferred[0].slice(4), ins = lines.map(e => e.checkIn).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || ''));
  const fits = [...new Set(ins.map(d => Number(d.slice(0, 4))).flatMap(y => [y - 1, y, y + 1]))].filter(y => {
    const t = Date.parse(`${y}${md}T00:00:00Z`); return ins.some(c => { const ci = Date.parse(c + 'T00:00:00Z'); return t >= ci - 86400000 && t <= ci + FIT_DAYS * 86400000; });
  });
  const date = inferred[0];
  const ambiguous = inferred.length > 1 ? `check-ins point to ${[...inferred].sort().join(' or ')}` : fits.length !== 1 ? (fits.length ? `years ${fits.join(' and ')} both fit its check-ins` : 'no year fits its check-ins') : null;
  return { date, inferred: true, ambiguous };
}

/** USD cents per property for a set of USD payouts: AED booking lines at the peg, the rest to the other-currency
 *  (ZAR) properties by their amounts; an all-AED payout is split by the AED amounts. */
function allocatePayouts(list) {
  const byProp = new Map(); const add = (k, c) => byProp.set(k, (byProp.get(k) ?? 0) + c);
  for (const p of list) {
    const total = cents(p.amount), lines = p.lines;
    if (!lines.length) { add('unallocated', total); continue; }
    const aed = new Map(), other = new Map();
    for (const e of lines) { const m = e.currency === 'AED' ? aed : other; m.set(e.propertyId, (m.get(e.propertyId) ?? 0) + cents(e.amount)); }
    let used = 0;
    if (other.size) for (const [pid, c] of aed) { const u = Math.round(c / USD_AED); add(pid, u); used += u; }
    // Each row rounded to the cent; the payout's rounding remainder goes on its largest row (Raju), so the rows sum
    // exactly to the payout.
    const pool = other.size ? other : aed, rest = total - used, sum = [...pool.values()].reduce((a, b) => a + b, 0);
    const shares = [...pool.keys()].map(pid => [pid, sum ? Math.round(rest * pool.get(pid) / sum) : 0]);
    if (!sum) shares[0][1] = rest;
    const left = rest - shares.reduce((n, [, u]) => n + u, 0);
    if (left) shares.reduce((big, x) => (Math.abs(x[1]) > Math.abs(big[1]) ? x : big))[1] += left;
    for (const [pid, u] of shares) add(pid, u);
  }
  return byProp;
}

/**
 * @param data { properties, owners, transactions, bookings (managementAmount resolved), earnings, payouts, statements,
 *   ownerPayouts, leases (with cheques), deposits, maintenance, bankBalances }
 * @param month YYYY-MM, the reporting month
 * @param overrides settings over WORKBOOK_DEFAULTS (yalla-config.mjs)
 * @param opts { from?: YYYY-MM (first month of Income/Expense rows), through?: YYYY-MM-DD (last day of entered and
 *   scheduled rows; generated rows stop at the month end), today?, companyName? }. Defaults: inputFrom / inputThrough.
 */
export function buildWorkbookRows(data, month, overrides = {}, opts = {}) {
  const cfg = workbookConfig(overrides);
  const { properties = [], owners = [], transactions = [], bookings = [], earnings = [], payouts = [], statements = [], ownerPayouts = [], leases = [], deposits = [], maintenance = [], bankBalances = [] } = data;
  const end = monthEnd(month), year = Number(month.slice(0, 4));
  const from = opts.from && opts.from <= month ? opts.from : cfg.inputFrom === 'summary' ? summaryWindow(cfg, month)[0] : month;
  const through = opts.through && opts.through >= end ? opts.through : cfg.inputThrough === 'today' && opts.today && opts.today > end ? opts.today : end;
  const start = `${from}-01`, reportStart = `${month}-01`;
  // Entered and scheduled rows (manual entries, lease rent, deposits) run to `through`; generated rows to the month end.
  const within = d => !!d && d >= start && d <= through;
  const withinGen = d => !!d && d >= start && d <= end;
  const inReport = d => !!d && d >= reportStart && d <= end;
  const prop = id => properties.find(p => p.id === id);
  const warnings = [], warned = new Set();
  const warn = (code, key, message, extra = {}) => { if (warned.has(code + '|' + key)) return; warned.add(code + '|' + key); warnings.push({ code, message, ...extra }); };
  const pname = id => {
    const p = prop(id); if (!p) return null;
    if (!p.reportName && cfg.unmappedProperty === 'flag') warn('unmapped-property', p.id, `${p.name} (property ${p.id}) has no workbook name: its rows use the listing name and it is not on Lists & Sources / Apartment Performance`, { propertyId: p.id });
    return p.reportName || p.name;
  };
  const ownerName = id => owners.find(o => o.id === prop(id)?.ownerId)?.name ?? null;
  const income = [], expense = [], excluded = [];
  // A category with no master equivalent: the row stays out of the export (unmappedCategoryRows 'exclude') and is
  // warned about whenever it carries a value. Returns true when the row must be left out.
  const offList = (sheet, cat, entered, row) => {
    const list = sheet === 'Income Input' ? MASTER_INCOME_CATEGORIES : MASTER_EXPENSE_CATEGORIES;
    if (list.includes(cat)) return false;
    const out = cfg.unmappedCategoryRows === 'exclude';
    if (cents(row.amount)) {
      warnings.push({ code: 'category', sheet, category: cat, date: row.date, amount: row.amount, currency: row.currency, message: `${sheet}: ${row.date} ${row.currency} ${Number(row.amount).toFixed(2)} "${row.description ?? ''}" has category "${cat}"${entered && entered !== cat ? ` (entered as "${entered}")` : ''}, not on the master's list${out ? ': left out of the export' : ''}` });
      if (out) excluded.push({ sheet, date: row.date, description: row.description, currency: row.currency, amount: Number(row.amount), reason: `Category "${cat}" has no master equivalent`, ...(row.id != null ? { transactionId: row.id } : {}) });
    }
    return out;
  };

  // Properties on Lists & Sources: every property with a workbook name, in the master's order, then by name.
  const order = n => { const i = MASTER_PROPERTY_ORDER.indexOf(n); return i < 0 ? 999 : i; };
  const listed = properties.filter(p => p.reportName).map(p => ({ id: p.id, name: p.reportName, active: !cfg.inactiveReportNames.includes(p.reportName), show: p.showInReport !== false }));
  listed.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  for (const p of properties) if (!p.reportName && !['inactive', 'archived'].includes(p.status)) pname(p.id);

  // 1+2. Airbnb payouts by payout date (cash basis): each month's USD total counts; per-property rows are view-only.
  const allPayouts = payouts.map(p => { const lines = earnings.filter(e => e.payoutId === p.id); return { ...p, lines, ...payoutDate(p, lines, year) }; });
  const ytdStart = `${year}-01-01`;
  for (const p of allPayouts) if (p.ambiguous && cfg.flagAmbiguousPayoutYear && p.date && ((p.date >= ytdStart && p.date <= end) || withinGen(p.date)))
    warn('payout-year', p.id, `Airbnb payout ${p.id} (${p.sourceDate}, ${p.currency} ${Number(p.amount).toFixed(2)}) has no year: ${p.ambiguous}; counted on ${p.date}`, { payoutId: p.id, date: p.date });
  for (const p of allPayouts) if (withinGen(p.date) && p.currency !== 'USD') excluded.push({ sheet: 'Income Input', date: p.date, description: `Airbnb payout ${p.id}`, currency: p.currency, amount: Number(p.amount), reason: 'Only USD Airbnb payouts are converted (fixed 3.6725); other currencies stay separate' });
  const usdIn = (a, b) => allPayouts.filter(p => p.currency === 'USD' && p.date && p.date >= a && p.date <= b);
  for (let m = from; m <= month; m = addMonths(m, 1)) {
    const usd = usdIn(`${m}-01`, monthEnd(m)); if (!usd.length) continue;
    const total = usd.reduce((n, p) => n + cents(p.amount), 0) / 100;
    income.push({ kind: 'airbnb-monthly', date: monthEnd(m), category: 'Airbnb', property: 'Various', payer: 'Airbnb', description: `Exact Airbnb monthly net - ${m}`, usd: total, fx: USD_AED, gross: r2(total * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Monthly Report', payouts: usd.length });
  }
  const propertyRows = (byProp, row) => {
    const keys = new Set(byProp.keys());
    if (cfg.propertyReportZeroRows === 'flag') for (const p of listed) if (p.active && p.show) keys.add(p.id);
    const nm = k => k === 'unallocated' ? 'Various' : pname(k);
    for (const k of [...keys].sort((a, b) => order(nm(a)) - order(nm(b)) || String(nm(a)).localeCompare(String(nm(b))))) {
      const u = (byProp.get(k) ?? 0) / 100;
      if (!u && !(cfg.propertyReportZeroRows === 'flag' && listed.some(p => p.id === k && p.active && p.show))) continue;
      income.push({ ...row, category: 'Airbnb', property: nm(k), payer: 'Airbnb', usd: u, fx: USD_AED, gross: r2(u * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Property Report' });
    }
  };
  if (cfg.propertyReportYtdRows) {
    const before = usdIn(ytdStart, monthEnd(addMonths(month, -1)));
    if (before.length) propertyRows(allocatePayouts(before), { kind: 'airbnb-ytd', date: reportStart, description: `Property allocation through 1 ${MON3[Number(month.slice(5)) - 1]} ${year} - excluded from dashboard total` });
  }
  { const cur = usdIn(reportStart, end); if (cur.length || cfg.propertyReportZeroRows === 'flag') propertyRows(allocatePayouts(cur), { kind: 'airbnb-property', date: end, description: `${MONTHS[Number(month.slice(5)) - 1]} ${year} property allocation - excluded from dashboard total` }); }

  // 3. Management fees (and, if switched on, booking cleaning fees) from bookings in the owner-statement (checkout)
  //    month, for owned properties; bookings paid through the Airbnb USD payouts are already in the monthly total.
  const payoutCodes = new Set(earnings.filter(e => e.payoutId && payouts.some(p => p.id === e.payoutId)).map(e => `airbnb:${e.confirmationCode}`));
  for (const b of bookings) {
    if (b.financeMode !== 'inclusive-v1' || ['cancelled', 'blocked'].includes(b.status) || !withinGen(b.checkOut) || payoutCodes.has(b.externalId)) continue;
    const p = prop(b.propertyId); if (!p?.ownerId) continue;
    const m = b.checkOut.slice(0, 7), mEnd = monthEnd(m), cur = b.currency || p.currency || 'AED';
    const st = statements.find(s => s.propertyId === b.propertyId && s.month === m);
    const rules = {
      fee_received_on: () => !!b.feeReceivedOn && b.feeReceivedOn <= mEnd,
      owner_payout: () => !!st && ownerPayouts.some(o => o.statementId === st.id && o.paidOn && o.paidOn <= mEnd),
      statement_paid: () => st?.status === 'paid',
      booking_paid: () => b.paymentStatus === 'paid',
    };
    const status = cfg.managementFeeReceivedWhen.some(k => rules[k]?.()) ? 'Received' : 'Pending';
    const label = `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)} owner statement`;
    const rows = [];
    if (cents(b.managementAmount)) rows.push({ kind: 'management-fee', category: 'Management Fee', description: `${Number(b.managementPercent || 0)}% management fee, ${pname(b.propertyId)}, ${label}`, gross: cents(b.managementAmount) / 100 });
    if (cfg.bookingCleaningIncome && cents(b.cleaningFee)) rows.push({ kind: 'booking-cleaning', category: 'Cleaning', description: `Booking cleaning fee, ${pname(b.propertyId)}, ${label}`, gross: cents(b.cleaningFee) / 100 });
    for (const r of rows) {
      const row = { ...r, date: mEnd, property: pname(b.propertyId), payer: ownerName(b.propertyId), cost: 0, status, source: 'Owner statement', view: 'Transaction', bookingId: b.id };
      if (cur === 'AED') income.push(row); else excluded.push({ sheet: 'Income Input', date: mEnd, description: row.description, currency: cur, amount: row.gross, reason: `${cur} stays separate from AED (no conversion)` });
    }
  }

  // 4. Manual company income (direct cost and payer as entered; the master's category).
  for (const t of transactions) {
    if (t.type !== 'income' || t.allocation !== 'company' || !within(t.date)) continue;
    const category = mapIncomeCategory(t, cfg);
    if (offList('Income Input', category, t.category, t)) continue;
    const base = { kind: 'manual-income', date: t.date, category, property: pname(t.propertyId) ?? 'Various', payer: t.payer ?? ownerName(t.propertyId) ?? '', description: t.description, cost: cents(t.directCost) / 100, status: t.paymentStatus === 'none' ? '' : t.paymentStatus && t.paymentStatus !== 'paid' ? 'Pending' : 'Received', source: t.reportSource ?? (t.reference ? `Co-Host Pro entry ${t.reference}` : 'Co-Host Pro entry'), view: 'Transaction', transactionId: t.id };
    if (t.currency === 'AED') income.push({ ...base, gross: cents(t.amount) / 100 });
    else if (t.currency === 'USD') { const fx = Number(t.fxRate || USD_AED); income.push({ ...base, usd: cents(t.amount) / 100, fx, gross: r2(Number(t.amount) * fx), cost: r2(Number(t.directCost || 0) * fx) }); }
    else excluded.push({ sheet: 'Income Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)`, transactionId: t.id });
  }

  // 5. Deposits kept: a liability deposit kept against damage is income; an asset deposit the landlord keeps is an expense.
  for (const d of deposits) {
    if (d.status !== 'kept' || !within(d.settledOn) || !cents(d.keptAmount)) continue;
    // A guest / tenant deposit kept against damage: income, category Other (Raju, round 3).
    if (d.kind === 'liability') { income.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Other', property: pname(d.propertyId) ?? 'Various', payer: d.counterparty, description: `Damage recovery (deposit kept)${d.keptReason ? `: ${d.keptReason}` : ''}`, gross: cents(d.keptAmount) / 100, cost: 0, status: 'Received', source: 'Deposits register', view: 'Transaction', depositId: d.id }); }
    else expense.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Security Deposit', property: pname(d.propertyId) ?? 'Company', paidBy: 'Company', description: `Deposit kept by ${d.counterparty}${d.keptReason ? `: ${d.keptReason}` : ''}`, amount: cents(d.keptAmount) / 100, paymentStatus: 'Paid', treatment: cfg.keptAssetDepositTreatment, depositId: d.id });
  }

  // Expenses 1: manual entries (and automatic cleaning costs), every treatment, flagged.
  for (const t of transactions) {
    if (t.type !== 'expense' || !within(t.date)) continue;
    const tr = effectiveTreatment(t), category = mapExpenseCategory(t, tr, cfg);
    if (offList('Expense Input', category, t.category, t)) continue;
    const row = { kind: 'entry', date: t.date, category, property: pname(t.propertyId) ?? 'Company', paidBy: tr === 'owner_paid' ? `Owner (${ownerName(t.propertyId) ?? 'unknown'})` : 'Company', description: t.description, paymentStatus: t.paymentStatus === 'pending' ? 'Pending' : t.paymentStatus === 'unpaid' ? 'Unpaid' : t.paymentStatus === 'none' ? '' : 'Paid', treatment: TREATMENT_LABEL[tr], transactionId: t.id, enteredCategory: t.category, ...(t.notes ? { notes: t.notes } : {}) };
    if (t.currency === 'AED') expense.push({ ...row, amount: cents(t.amount) / 100 });
    else if (t.currency === 'USD') expense.push({ ...row, amount: r2(Number(t.amount) * Number(t.fxRate || USD_AED)), usd: Number(t.amount) });
    else excluded.push({ sheet: 'Expense Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)`, transactionId: t.id });
  }
  // Company maintenance charges completed in the period with no entry of their own (same as the company statement).
  for (const m of maintenance) {
    const d = String(m.completedAt || '').slice(0, 10);
    if (m.chargeType !== 'company' || m.status !== 'completed' || !withinGen(d) || transactions.some(t => t.reference === `maintenance:${m.id}` && t.allocation === 'company')) continue;
    const cur = prop(m.propertyId)?.currency || 'AED';
    if (cur !== 'AED') { excluded.push({ sheet: 'Expense Input', date: d, description: m.issue, currency: cur, amount: Number(m.cost), reason: `${cur} stays separate from AED (no conversion)` }); continue; }
    expense.push({ kind: 'maintenance', date: d, category: 'Supplies', property: pname(m.propertyId) ?? 'Company', paidBy: 'Company', description: m.issue, amount: cents(m.cost) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.company, maintenanceId: m.id });
  }

  // Expenses 2-4: lease accruals, agency fee, asset deposits paid.
  for (const l of leases) {
    for (const a of leaseAccruals(l, l.cheques ?? [])) if (within(a.date)) expense.push({ kind: 'lease-rent', date: a.date, category: 'Rent', property: pname(l.propertyId) ?? 'Company', paidBy: 'Company', description: a.description, amount: a.amount, paymentStatus: a.chequePaidOn && a.chequePaidOn <= monthEnd(a.date.slice(0, 7)) ? 'Paid' : 'Pending', treatment: TREATMENT_LABEL.company, leaseId: l.id });
    if (cents(l.agencyFee) && within(l.agencyFeeDate)) expense.push({ kind: 'lease-agency', date: l.agencyFeeDate, category: 'Agent Commission', property: pname(l.propertyId) ?? 'Company', paidBy: 'Company', description: l.agencyFeeNote || 'Agency fee (one-off)', amount: cents(l.agencyFee) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.company, leaseId: l.id });
  }
  for (const d of deposits) if (d.kind === 'asset' && within(d.date)) {
    if ((d.currency || 'AED') !== 'AED') { excluded.push({ sheet: 'Expense Input', date: d.date, description: `Deposit ${d.counterparty}`, currency: d.currency, amount: Number(d.amount), reason: `${d.currency} stays separate from AED (no conversion)` }); continue; }
    expense.push({ kind: 'deposit-paid', date: d.date, category: 'Security Deposit', property: pname(d.propertyId) ?? 'Company', paidBy: 'Company', description: d.notes || `Security deposit paid to ${d.counterparty} - refundable`, amount: cents(d.amount) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.deposit, depositId: d.id });
  }

  // Q9: salary entries against AED 15,000 a month (or that month's override).
  for (let m = from; m <= month; m = addMonths(m, 1)) {
    if (cfg.salaryFrom && m < cfg.salaryFrom) continue;
    const want = Number(cfg.salaryOverrides[m] ?? cfg.salaryMonthly);
    const got = expense.filter(r => r.category === 'Salary' && r.date.startsWith(m)).reduce((n, r) => n + cents(r.amount), 0) / 100;
    if (cents(got) !== cents(want)) warn('salary', m, `Salary ${m}: entries total AED ${got.toFixed(2)}, expected AED ${want.toFixed(2)}${cfg.salaryOverrides[m] != null ? ' (month override)' : ''}`, { month: m, entered: got, expected: want });
  }

  const kindOrder = { 'airbnb-ytd': 0, 'airbnb-monthly': 0, 'management-fee': 1, 'booking-cleaning': 1, 'manual-income': 1, 'deposit-kept': 1, 'airbnb-property': 2 };
  const listPos = n => { const i = listed.findIndex(p => p.name === n); return i < 0 ? 999 : i; };
  income.sort((a, b) => a.date.localeCompare(b.date) || (kindOrder[a.kind] - kindOrder[b.kind]) || (a.kind.startsWith('airbnb') ? listPos(a.property) - listPos(b.property) : 0) || ((a.transactionId ?? 0) - (b.transactionId ?? 0)) || String(a.property).localeCompare(String(b.property)));
  expense.sort((a, b) => a.date.localeCompare(b.date) || String(a.category).localeCompare(String(b.category)) || String(a.description).localeCompare(String(b.description)));
  const sum = (rows, f) => rows.reduce((n, r) => n + cents(f(r)), 0) / 100;
  const counted = income.filter(r => r.view !== 'Airbnb Property Report' && inReport(r.date));
  const monthExp = expense.filter(r => inReport(r.date));

  // Lists & Sources: deposits held for guests / tenants (liabilities) as at the month end; bank balance of the month.
  const depositsHeld = deposits.filter(d => d.kind === 'liability' && d.date && d.date <= end && !(d.settledOn && d.settledOn < reportStart))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, property: pname(d.propertyId) ?? 'Various', from: d.counterparty, amount: (d.currency || 'AED') === 'AED' ? cents(d.amount) / 100 : null, original: Number(d.amount), currency: d.currency || 'AED', status: d.settledOn && d.settledOn <= end ? (d.status === 'kept' ? 'Kept' : 'Refunded') : 'Held', notes: d.notes ?? '' }));
  for (const d of depositsHeld) if (d.amount == null) warn('deposit-currency', d.from + d.date, `Deposit from ${d.from} is in ${d.currency}: not added to the AED deposits held`);
  // Bank: month-end closing balances are the history; J5 shows the latest dated balance up to `through` (the
  // master's "9 OCT 2026"), or the month's closing balance (bankBalanceShows 'month_end').
  const myBank = bankBalances.filter(b => (b.account || cfg.bankAccount) === cfg.bankAccount);
  const monthClose = myBank.find(b => (b.kind ?? 'month_end') === 'month_end' && b.month === month) ?? null;
  const bank = cfg.bankBalanceShows === 'latest'
    ? [...myBank].filter(b => b.balanceDate && b.balanceDate <= through).sort((a, b) => b.balanceDate.localeCompare(a.balanceDate) || ((a.kind ?? 'month_end') === 'latest' ? -1 : 1))[0] ?? null
    : monthClose;
  if (!monthClose) warn('bank-balance', month, `No ${cfg.bankAccount} closing balance entered for ${month}${bank ? '' : ' (Dashboard J5 left empty)'}`);

  // Lists & Sources items table (the master's order: Airbnb, income checks, then per lease the rent, cheques paid,
  // deposit and agency fee). `key` ties an item to its check on the Checks sheet; "{check}" in notes becomes the row.
  const sumUsd = list => list.reduce((n, p) => n + cents(p.amount), 0) / 100;
  const ytdUsd = sumUsd(usdIn(ytdStart, end)), ytdPeriod = rangeLabel(ytdStart, end);
  const monthlyRows = income.filter(r => r.kind === 'airbnb-monthly');
  const items = [
    { key: 'airbnb-net', item: 'Airbnb net earnings', value: ytdUsd, units: 'USD', period: ytdPeriod, source: 'Airbnb payouts (Co-Host Pro)', reference: 'By payout date', treatment: 'Monthly totals drive company revenue', notes: 'Converted using FX rate on Income Input' },
    { key: 'airbnb-monthly', item: 'Airbnb monthly totals', value: monthlyRows.reduce((n, r) => n + cents(r.usd), 0) / 100, units: 'USD', period: `${MON3[Number(from.slice(5)) - 1]}${from.slice(0, 4) === month.slice(0, 4) ? '' : ' ' + from.slice(0, 4)}-${MON3[Number(month.slice(5)) - 1]} ${year}`, source: 'Airbnb payouts (Co-Host Pro)', reference: 'By payout date', treatment: `${countWord(monthlyRows.length)} monthly input row${monthlyRows.length === 1 ? '' : 's'}`, notes: 'Must tie to report total (Checks row {check})' },
    { key: 'airbnb-property', item: 'Airbnb property totals', value: ytdUsd, units: 'USD', period: ytdPeriod, source: 'Airbnb payouts (Co-Host Pro)', reference: 'By payout date', treatment: 'Property-view rows; excluded from company total', notes: 'Prevents double counting (Checks row {check})' },
  ];
  (cfg.incomeChecks ?? []).forEach((c, i) => items.push({ key: `income-check:${i}`, item: c.item, value: Number(c.expected), units: 'AED', period: monthLabel(`${c.month}-01`), source: c.source ?? 'Finance', reference: c.reference ?? null, treatment: 'Transaction row', notes: 'Checks row {check}', check: c }));
  const fmt0 = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: cents(n) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const assetDeposits = deposits.filter(d => d.kind === 'asset' && d.date && d.date <= end);
  for (const l of leases) {
    const nm = pname(l.propertyId) ?? l.name, chs = [...(l.cheques ?? [])].sort((a, b) => a.seq - b.seq);
    const equal = chs.length && chs.every(c => cents(c.amount) === cents(chs[0].amount)), quarterly = chs.length && chs.every(c => (c.months ?? 3) === 3);
    const unpaid = chs.filter(c => !(c.paidOn && c.paidOn <= end));
    items.push({ key: `lease-rent:${l.id}`, item: `${nm} annual rent`, value: Number(l.annualRent), units: l.currency || 'AED', period: rangeLabel(l.startDate, l.endDate), source: 'Tenancy contract',
      reference: chs.length ? `${chs.length} ${quarterly ? 'quarterly ' : ''}cheques${equal ? ` of ${fmt0(chs[0].amount)}` : ''}` : null, treatment: `Rent spread ${(Math.floor(cents(l.annualRent) / 12) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/month in Expense Input`,
      notes: unpaid.length ? `Q${unpaid[0].seq}${unpaid.length > 1 ? `-Q${unpaid[unpaid.length - 1].seq}` : ''} cheque${unpaid.length > 1 ? 's' : ''}: ${unpaid.map(c => dayLabel(c.dueDate)).join(', ')}` : null });
    const rentItem = items[items.length - 1]; rentItem.forecast = { property: nm, startDate: l.startDate, endDate: l.endDate, cheques: chs.length, upcoming: [] };
    let cover = l.startDate;
    for (const ch of chs) {
      const coverEnd = addDays(addMonthsDate(cover, ch.months ?? 3), -1);
      if (!(ch.paidOn && ch.paidOn <= end)) rentItem.forecast.upcoming.push({ seq: ch.seq, dueDate: ch.dueDate, coverStart: cover, coverEnd });
      if (ch.paidOn && ch.paidOn <= end) items.push({ key: `lease-cheque:${l.id}`, item: `${nm} Q${ch.seq} rent cheque`, value: Number(ch.amount), units: l.currency || 'AED', period: `Paid ${dayLabel(ch.paidOn)}`, source: 'Bank statement', reference: `Covers ${rangeLabel(cover, coverEnd)}`, treatment: `Booked as ${ch.months ?? 3} monthly rent rows`, notes: 'Checks row {check}', lease: { id: l.id, property: nm } });
      cover = addDays(coverEnd, 1);
    }
    for (const d of assetDeposits.filter(d => d.leaseId === l.id)) items.push(depositItem(d, nm, l));
    if (cents(l.agencyFee) && l.agencyFeeDate && l.agencyFeeDate <= end) items.push({ key: `lease-agency:${l.id}`, item: `${nm} agency fee`, value: Number(l.agencyFee), units: l.currency || 'AED', period: `${/repaid/i.test(l.agencyFeeNote ?? '') ? 'Repaid' : 'Paid'} ${dayLabel(l.agencyFeeDate)}`, source: 'Bank statement', reference: l.agencyFeeNote ?? null, treatment: 'One-off operating expense', notes: null });
  }
  for (const d of assetDeposits.filter(d => !leases.some(l => l.id === d.leaseId))) items.push(depositItem(d, pname(d.propertyId) ?? d.counterparty, null));
  function depositItem(d, nm, l) {
    const pct = l && cents(l.annualRent) ? Math.round(cents(d.amount) * 1000 / cents(l.annualRent)) / 10 : null;
    return { key: 'deposit', item: `${nm} security deposit`, value: Number(d.amount), units: d.currency || 'AED', period: `Paid ${dayLabel(d.date)}`, source: 'Bank statement', reference: pct ? `${pct}% of annual rent` : d.counterparty, treatment: d.status === 'held' ? 'Refundable Deposit (not opex)' : `Deposit ${d.status}`, notes: d.status === 'held' ? 'Checks row {check}' : null, held: d.status === 'held' && (d.currency || 'AED') === 'AED' };
  }

  const result = {
    month, from, through, monthEnd: end, usdAed: USD_AED, income, expense, excluded, warnings,
    totals: {
      income: sum(counted, r => r.gross - r.cost), incomeReceived: sum(counted.filter(r => r.status === 'Received'), r => r.gross - r.cost), incomePending: sum(counted.filter(r => r.status === 'Pending'), r => r.gross - r.cost),
      operatingExpenses: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.company), r => r.amount),
      ownerPaid: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.owner_paid), r => r.amount),
      passThrough: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.pass_through), r => r.amount),
      refundableDeposits: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.deposit), r => r.amount),
    },
    lists: {
      properties: listed.map(p => ({ name: p.name, active: p.active, showInReport: p.show })), depositsHeld, items,
      bank: bank ? { account: bank.account || cfg.bankAccount, kind: bank.kind ?? 'month_end', balanceDate: bank.balanceDate || end, balance: Number(bank.balance), currency: bank.currency || 'AED' } : null,
      bankHistory: myBank.filter(b => (b.kind ?? 'month_end') === 'month_end').sort((a, b) => a.month.localeCompare(b.month)).map(b => ({ month: b.month, balanceDate: b.balanceDate, balance: Number(b.balance), currency: b.currency || 'AED' })),
    },
    config: { summaryFirstMonth: cfg.summaryFirstMonth, summaryMonths: cfg.summaryMonths, apartmentOwnerPaidColumn: cfg.apartmentOwnerPaidColumn, bankAccount: cfg.bankAccount,
      forecastMonths: cfg.forecastMonths, forecastAverageMonths: cfg.forecastAverageMonths, forecastSalary: cfg.forecastSalary ?? cfg.salaryMonthly, forecastSalaryNote: cfg.forecastSalaryNote, forecastAirbnbNote: cfg.forecastAirbnbNote, forecastOpening: cfg.forecastOpening, forecastOneOffProperties: cfg.forecastOneOffProperties, forecastExpectedCommissions: cfg.forecastExpectedCommissions },
    today: opts.today ?? null, companyName: opts.companyName ?? null, reportTitle: opts.reportTitle || cfg.reportTitle || opts.companyName || null,
  };
  // Expense Line Items: every PMS expense line in the range, the ones on Expense Input and the ones left out (why).
  const srcLabel = r => ({ entry: `Co-Host Pro entry #${r.transactionId}`, maintenance: `Maintenance ticket #${r.maintenanceId}`, 'lease-rent': 'Lease schedule', 'lease-agency': 'Lease agency fee', 'deposit-paid': 'Deposits register', 'deposit-kept': 'Deposits register' })[r.kind] ?? r.kind;
  result.expenseLines = [
    ...expense.map(r => ({ date: r.date, category: r.category, property: r.property, paidBy: r.paidBy, description: r.description, amount: r.amount, paymentStatus: r.paymentStatus, treatment: r.treatment, currency: r.usd != null ? 'USD' : 'AED', original: r.usd != null ? r.usd : r.amount, source: srcLabel(r), inInput: 'Yes', note: r.enteredCategory && r.enteredCategory !== r.category ? `Entered as "${r.enteredCategory}"` : '' })),
    ...excluded.filter(x => x.sheet === 'Expense Input').map(x => ({ date: x.date, category: '', property: '', paidBy: '', description: x.description, amount: null, paymentStatus: '', treatment: '', currency: x.currency, original: x.amount, source: 'Co-Host Pro', inInput: 'No', note: x.reason })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.inInput === b.inInput ? 0 : a.inInput === 'Yes' ? -1 : 1));
  // Confirmed Booking: confirmed / checked-in / checked-out stays overlapping the range (no guest names in the export).
  result.confirmedBookings = bookings
    .filter(b => ['confirmed', 'checked_in', 'checked_out'].includes(b.status) && b.checkIn && b.checkOut && b.checkIn <= through && b.checkOut > start)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id - b.id)
    .map(b => { const p = prop(b.propertyId), n = v => (v == null || v === '' ? null : cents(v) / 100);
      const code = String(b.externalId ?? '').startsWith('airbnb:') ? String(b.externalId).slice(7) : null, el = code ? earnings.filter(e => e.confirmationCode === code) : [];
      const eCur = [...new Set(el.map(e => e.currency))];
      return { id: b.id, reference: b.externalId ?? '', property: pname(b.propertyId) ?? '', platform: b.platform ?? '', checkIn: b.checkIn, checkOut: b.checkOut, nights: Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000),
        currency: b.currency || p?.currency || 'AED', gross: n(b.grossAmount ?? b.revenue), cleaning: n(b.cleaningFee), channel: n(b.channelFees), management: n(b.managementAmount), owner: n(b.ownerAmount),
        airbnbEarnings: el.length ? el.reduce((x, e) => x + cents(e.amount), 0) / 100 : null, earningsCurrency: eCur.join('/') || null,
        paymentStatus: b.paymentStatus ?? '', status: b.status }; });
  result.m3 = m3Values(result);
  result.checks = checkValues(result);
  result.forecast = forecastValues(result);
  return result;
}

/**
 * Accounting > Transactions month cards: COMPANY revenue, expenses and profit for one month, computed from the same
 * rows as the YALLA export (Monthly Summary B/C/E for that month), so the two can't drift.
 *  - revenue: Income Input rows of the month, net of direct cost, Airbnb property-view rows left out (Airbnb USD
 *    payouts at 3.6725, management fees and commissions, other company income)
 *  - expenses: Operating Expense rows only; owner-paid, pass-through and refundable deposits are reported apart
 *  - other currencies (e.g. ZAR) never converted: listing-currency lines of the month's USD payouts (already in the
 *    Airbnb revenue at the USD paid, not added again); earnings outside USD payouts and entries in that currency apart
 *  - tags: transaction id -> 'Owner paid' | 'Pass-through' | 'Deposit' | '<CUR> (separate)' | 'Not in company totals'
 */
export function companyMonthSummary(data, month, overrides = {}, opts = {}) {
  const end = monthEnd(month), start = `${month}-01`;
  const r = buildWorkbookRows(data, month, overrides, { ...opts, from: month, through: end });
  const inMonth = d => !!d && d >= start && d <= end;
  const C = v => cents(v), S = (rows, f) => rows.reduce((n, x) => n + C(f(x)), 0) / 100;
  const counted = r.income.filter(x => x.view !== 'Airbnb Property Report' && inMonth(x.date)), net = x => (x.usd != null ? x.usd * x.fx : x.gross) - x.cost;
  const exp = r.expense.filter(x => inMonth(x.date)), byT = t => exp.filter(x => x.treatment === TREATMENT_LABEL[t]);
  const airbnb = S(counted.filter(x => x.kind === 'airbnb-monthly'), net);
  const fees = S(counted.filter(x => x.kind !== 'airbnb-monthly' && ['Management Fee', 'Commission'].includes(x.category)), net);
  const revenue = S(counted, net), expenses = S(byT('company'), x => x.amount);
  // Other currencies, never converted. Airbnb pays the company in USD; a listing in another currency (e.g. ZAR) shows
  // its lines in that currency inside the USD payout, so those are listed here as "in the Airbnb revenue above" (already
  // counted at the USD actually paid) and are not added again. Earnings outside any USD payout and entries left out of
  // the export for their currency stay separate (not in the AED totals).
  const usdPayouts = new Set((data.payouts ?? []).filter(p => p.currency === 'USD').map(p => p.id)), year = Number(month.slice(0, 4));
  const other = {}, cur = c => (other[c] ??= { currency: c, airbnbInUsdPayouts: 0, payouts: new Set(), airbnbSeparate: 0, income: 0, expenses: 0 });
  for (const p of data.payouts ?? []) {
    if (p.currency !== 'USD') continue;
    const lines = (data.earnings ?? []).filter(e => e.payoutId === p.id);
    if (!inMonth(payoutDate(p, lines, year).date)) continue;
    for (const e of lines) if (!['USD', 'AED'].includes(e.currency)) { const o = cur(e.currency); o.airbnbInUsdPayouts += C(e.amount); if (!o.payouts.has(p.id)) { o.payouts.add(p.id); } }
  }
  for (const e of data.earnings ?? []) {
    if (['USD', 'AED'].includes(e.currency) || e.status !== 'paid' || !['home', 'cohost'].includes(e.kind) || (e.payoutId && usdPayouts.has(e.payoutId))) continue;
    if (inMonth(payoutDate({ sourceDate: e.sourceDate }, [e], year).date)) cur(e.currency).airbnbSeparate += C(e.amount);
  }
  for (const x of r.excluded) if (inMonth(x.date) && x.currency && x.currency !== 'AED' && /no conversion/.test(x.reason)) cur(x.currency)[x.sheet === 'Expense Input' ? 'expenses' : 'income'] += C(x.amount);
  const otherCurrencies = Object.values(other).map(o => ({ currency: o.currency, airbnbInAedRevenue: o.airbnbInUsdPayouts / 100, usdPayouts: o.payouts.size,
    separate: { airbnb: o.airbnbSeparate / 100, income: o.income / 100, expenses: o.expenses / 100, net: (o.airbnbSeparate + o.income - o.expenses) / 100 } })).sort((a, b) => a.currency.localeCompare(b.currency));
  const tags = {};
  for (const x of exp) if (x.transactionId != null && x.treatment !== TREATMENT_LABEL.company) tags[x.transactionId] = { [TREATMENT_LABEL.owner_paid]: 'Owner paid', [TREATMENT_LABEL.pass_through]: 'Pass-through', [TREATMENT_LABEL.deposit]: 'Deposit' }[x.treatment];
  for (const x of r.excluded) if (x.transactionId != null) tags[x.transactionId] = /no conversion/.test(x.reason) ? `${x.currency} (separate)` : 'Not in company totals';
  const known = new Set([...counted, ...exp].map(x => x.transactionId).filter(v => v != null));
  for (const t of data.transactions ?? []) if (inMonth(t.date) && !known.has(t.id) && !tags[t.id]) tags[t.id] = t.allocation === 'owner' ? 'Owner paid' : 'Not in company totals';
  return {
    month, currency: 'AED', usdAed: r.usdAed,
    revenue: { total: revenue, airbnb, managementFeesAndCommissions: fees, other: (C(revenue) - C(airbnb) - C(fees)) / 100 },
    expenses: { total: expenses, ownerPaid: S(byT('owner_paid'), x => x.amount), passThrough: S(byT('pass_through'), x => x.amount), refundableDeposits: S(byT('deposit'), x => x.amount) },
    profit: (C(revenue) - C(expenses)) / 100, otherCurrencies, tags,
  };
}

/** Monthly Summary, Apartment Performance and Dashboard figures, computed exactly as the master's formulas compute
 *  them from the exported Income/Expense rows (written as the cached values of those formulas). */
export function m3Values(r) {
  const c = r.config, end = r.monthEnd;
  const months = summaryWindow(c, r.month);
  // Exactly what Excel computes: an Airbnb row's F is M*N unrounded.
  const gross = x => (x.usd != null ? x.usd * x.fx : x.gross), net = x => gross(x) - x.cost;
  const S = (rows, f) => rows.reduce((n, x) => n + f(x), 0);
  const summary = months.map(m => {
    const a = `${m}-01`, b = monthEnd(m), inM = x => x.date >= a && x.date <= b;
    const B = S(r.income.filter(x => inM(x) && x.view !== 'Airbnb Property Report'), net);
    const C = S(r.expense.filter(x => inM(x) && x.treatment === 'Operating Expense'), x => x.amount);
    const D = S(r.expense.filter(x => inM(x) && x.treatment === 'Refundable Deposit'), x => x.amount);
    const E = B - C;
    return { month: m, income: B, opex: C, deposits: D, net: E, margin: B ? E / B : 0, cashOut: C + D, status: !B && !C && !D ? 'No activity' : E >= 0 ? 'Profit' : 'Loss' };
  });
  const tot = k => S(summary, x => x[k]);
  const totals = { income: tot('income'), opex: tot('opex'), deposits: tot('deposits'), net: tot('net'), cashOut: tot('cashOut') }; totals.margin = totals.income ? totals.net / totals.income : 0;
  const upTo = x => x.date <= end;
  const ap = r.lists.properties.map(p => {
    const inc = r.income.filter(x => upTo(x) && x.property === p.name && x.view !== 'Airbnb Monthly Report');
    const ex = r.expense.filter(x => upTo(x) && x.property === p.name);
    const D = S(inc, gross), E = S(inc, x => x.cost), F = S(ex.filter(x => x.treatment === 'Operating Expense'), x => x.amount);
    return { property: p.name, gross: D, directCosts: E, allocated: F, net: D - E - F, ownerPaid: S(ex.filter(x => x.treatment === 'Owner Paid (excluded)'), x => x.amount) };
  });
  const sumD = S(ap, x => x.gross);
  ap.forEach((x, i) => { x.share = sumD ? x.gross / sumD : 0; x.rank = ap.filter(y => y.net > x.net + 1e-9).length + 1 + ap.slice(0, i + 1).filter(y => Math.abs(y.net - x.net) <= 1e-9).length - 1; });
  const apTotals = { gross: S(ap, x => x.gross), directCosts: S(ap, x => x.directCosts), allocated: S(ap, x => x.allocated), net: S(ap, x => x.net), share: ap.reduce((n, x) => n + x.share, 0), ownerPaid: S(ap, x => x.ownerPaid) };
  const cur = summary.find(x => x.month === r.month);
  const counted = r.income.filter(x => upTo(x) && x.view !== 'Airbnb Property Report');
  const A9 = S(counted, net), D9 = S(r.expense.filter(x => upTo(x) && x.treatment === 'Operating Expense'), x => x.amount);
  const dashboard = {
    propertiesManaged: r.lists.properties.filter(p => p.active).length,
    incomeMonth: cur ? cur.income : 0,
    depositsHeld: S(r.lists.depositsHeld.filter(d => d.status === 'Held' && d.amount != null), d => d.amount),
    bankBalance: r.lists.bank ? r.lists.bank.balance : null,
    incomeYtd: A9, opex: D9, netProfit: A9 - D9,
    refundableDeposits: S(r.expense.filter(x => upTo(x) && x.treatment === 'Refundable Deposit'), x => x.amount),
    top: [1, 2, 3, 4, 5].map(k => { const x = ap.find(y => y.rank === k); return x ? { rank: k, property: x.property, net: x.net } : { rank: k, property: null, net: null }; }),
  };
  return { months, summary, totals, apartments: ap, apartmentTotals: apTotals, dashboard };
}

/** M4 Checks: the master's checks (rows 4-11), each with the formula's actual and expected values as Excel computes
 *  them from the exported rows. `items` are Lists & Sources item indexes for the Expected column. */
export function checkValues(r) {
  const m3 = r.m3 ?? m3Values(r), fx = r.usdAed, S = (rows, f) => rows.reduce((n, x) => n + f(x), 0);
  const H = x => (x.usd != null ? x.usd * x.fx : x.gross) - x.cost;
  const idx = pred => r.lists.items.map((it, i) => (pred(it) ? i : -1)).filter(i => i >= 0);
  const itemSum = ii => ii.reduce((n, i) => n + r.lists.items[i].value, 0);
  const win = m3.months, a = `${win[0]}-01`, b = monthEnd(win[win.length - 1]);
  const checks = [];
  const add = (c) => { c.diff = c.actual - c.expected; c.status = Math.abs(c.diff) <= c.tolerance ? 'OK' : 'REVIEW'; checks.push(c); };
  const mi = idx(it => it.key === 'airbnb-monthly'), pi = idx(it => it.key === 'airbnb-property');
  add({ key: 'airbnb-monthly', label: 'Airbnb monthly USD total', actual: S(r.income.filter(x => x.view === 'Airbnb Monthly Report'), H) / fx, items: mi, expected: itemSum(mi), tolerance: 0.01, note: 'Airbnb Monthly Report rows must tie to the Airbnb report total' });
  add({ key: 'airbnb-property', label: 'Airbnb property USD total', actual: S(r.income.filter(x => x.view === 'Airbnb Property Report'), H) / fx, items: pi, expected: itemSum(pi), tolerance: 0.05, note: 'Property rows are rounded per listing, so allow 0.05' });
  r.lists.items.forEach((it, i) => {
    if (!it.check) return; const c = it.check, s0 = `${c.month}-01`, s1 = `${addMonths(c.month, 1)}-01`;
    add({ key: 'income-check', label: c.label ?? `${c.property} ${c.month} AED`, property: c.property, month: c.month, actual: S(r.income.filter(x => x.property === c.property && x.date >= s0 && x.date < s1), H), items: [i], expected: it.value, tolerance: 0.01, note: c.note ?? `Review ${c.property} transaction` });
  });
  add({ key: 'summary-tie', label: 'Monthly summary tie', actual: S(m3.summary, x => x.income), expected: S(r.income.filter(x => x.view !== 'Airbnb Property Report'), H), tolerance: 0.01, note: 'Income total must equal monthly roll-up' });
  add({ key: 'ranking', label: 'Property ranking completeness', actual: m3.apartments.filter(x => x.property).length, expected: r.lists.properties.length, tolerance: 0, note: 'Every property in Lists & Sources must appear in Apartment Performance' });
  add({ key: 'opex-tie', label: 'Operating expenses tie', actual: S(m3.summary, x => x.opex), expected: S(r.expense.filter(x => x.treatment === 'Operating Expense' && x.date >= a && x.date <= b), x => x.amount), tolerance: 0.01, note: 'Opex rows must equal the monthly roll-up (owner-paid and pass-through rows excluded)' });
  const di = idx(it => it.key === 'deposit' && it.held);
  if (di.length) add({ key: 'deposits', label: 'Refundable deposits', actual: S(r.expense.filter(x => x.treatment === 'Refundable Deposit'), x => x.amount), items: di, expected: itemSum(di), tolerance: 0.01, note: di.map(i => r.lists.items[i].item).join(', ') });
  const leases = [...new Map(r.lists.items.filter(it => it.lease).map(it => [it.lease.id, it.lease])).values()];
  for (const l of leases) {
    const ci = idx(it => it.lease?.id === l.id);
    add({ key: 'lease', label: `${l.property} rent booked vs cheques paid`, property: l.property, actual: S(r.expense.filter(x => x.category === 'Rent' && x.property === l.property), x => x.amount), items: ci, expected: itemSum(ci), tolerance: 0.01, note: 'Monthly rent rows must add up to the cheques paid (add 3 rows per new cheque)' });
  }
  return { checks, status: checks.some(c => c.status === 'REVIEW') ? 'REVIEW' : 'PASS' };
}

/** M5 Forecast (the master's "Cash Forecast"): inputs and month rows exactly as its formulas compute them. Opening =
 *  Dashboard J13 (bank balance less tenant deposits held) or J5; one-off income (B18, month B19) in column D. */
export function forecastValues(r) {
  const c = r.config, end = r.monthEnd, k = c.forecastAverageMonths, n = c.forecastMonths;
  const winStart = `${addMonths(r.month, -(k - 1))}-01`, inWin = x => x.date >= winStart && x.date <= end;
  const H = x => (x.usd != null ? x.usd * x.fx : x.gross) - x.cost, S = (rows, f) => rows.reduce((a, x) => a + f(x), 0);
  const opex = r.expense.filter(x => x.treatment === 'Operating Expense' && inWin(x));
  const rentIdx = r.lists.items.findIndex(it => it.forecast), rent = rentIdx >= 0 ? r.lists.items[rentIdx] : null;
  const bank = r.lists.bank ? r.lists.bank.balance : 0;
  const held = S(r.lists.depositsHeld.filter(d => d.status === 'Held' && d.amount != null), d => d.amount);
  const start = `${addMonths(r.month, 1)}-01`;
  const oneOffRows = r.income.map((x, i) => ({ x, row: 7 + i })).filter(({ x }) => x.date > end && x.status === 'Pending' && x.view === 'Transaction' && (c.forecastOneOffProperties ?? []).includes(x.property));
  const inputs = {
    opening: (c.forecastOpening ?? 'available') === 'available' ? bank - held : bank, openingBasis: c.forecastOpening ?? 'available', bank, depositsHeld: held,
    start, averageMonths: k, windowStart: winStart,
    airbnb: S(r.income.filter(x => x.view === 'Airbnb Monthly Report' && inWin(x)), H) / k,
    other: S(r.income.filter(x => x.view === 'Transaction' && inWin(x)), H) / k,
    opex: (S(opex, x => x.amount) - S(opex.filter(x => x.category === 'Rent'), x => x.amount) - S(opex.filter(x => x.category === 'Salary'), x => x.amount)) / k,
    salary: Number(c.forecastSalary ?? 0), annualRent: rent ? rent.value : 0, rentItem: rentIdx, lease: rent?.forecast ?? null,
    oneOff: { amount: S(oneOffRows, ({ x }) => H(x)), rows: oneOffRows.map(o => o.row), items: oneOffRows.map(({ x }) => ({ date: x.date, description: x.description, amount: H(x) })),
      month: oneOffRows.length ? `${oneOffRows[0].x.date.slice(0, 7)}-01` : start },
    expected: { monthly: Number(c.forecastExpectedCommissions?.monthly ?? 0), from: `${c.forecastExpectedCommissions?.from ?? addMonths(r.month, 2)}-01` },
  };
  inputs.chequeAmount = inputs.annualRent / (rent?.forecast?.cheques || 4);
  const dates = (rent?.forecast?.upcoming ?? []).map(u => u.dueDate);
  const months = []; let open = inputs.opening;
  for (let i = 0; i < n; i++) {
    const m = addMonths(inputs.start.slice(0, 7), i), a = `${m}-01`, b = `${addMonths(m, 1)}-01`;
    const income = inputs.airbnb + inputs.other, oneOff = inputs.oneOff.month.slice(0, 7) === m ? inputs.oneOff.amount : 0, rentOut = dates.filter(d => d >= a && d < b).length * inputs.chequeAmount;
    const expected = a >= inputs.expected.from ? inputs.expected.monthly : 0;
    const net = income + oneOff + expected - inputs.opex - inputs.salary - rentOut;
    months.push({ month: m, opening: open, income, oneOff, expected, opex: inputs.opex, salary: inputs.salary, rent: rentOut, net, closing: open + net });
    open += net;
  }
  const tot = key => S(months, x => x[key]);
  return { inputs, months, totals: { income: tot('income'), oneOff: tot('oneOff'), expected: tot('expected'), opex: tot('opex'), salary: tot('salary'), rent: tot('rent'), net: tot('net'), closing: months.length ? months[months.length - 1].closing : inputs.opening },
    after: [1, 3, 6, 9].filter(x => x <= n).map(x => ({ months: x, month: months[x - 1].month, closing: months[x - 1].closing })), lowest: Math.min(...months.map(x => x.closing)), lowestMonth: months.reduce((lo, x) => (x.closing < lo.closing ? x : lo), months[0])?.month };
}

const AED_W = 18;
/** Master style ids for the two sheets the master leaves as placeholders (Expense Line Items, Confirmed Booking):
 *  the look of the matching Expense Input / Income Input cells. */
function masterStyles(tpl) {
  const wb = tpl['xl/workbook.xml'], rels = tpl['xl/_rels/workbook.xml.rels'];
  const at = (sheet, ref) => {
    const id = wb.match(new RegExp(`<sheet [^>]*name="${sheet.replace(/&/g, '&amp;')}"[^>]*r:id="([^"]+)"`))[1];
    const t = rels.match(new RegExp(`Target="([^"]+)" Id="${id}"`))?.[1] ?? rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))[1];
    const xml = tpl[t.startsWith('/') ? t.slice(1) : `xl/${t}`];
    return xml.match(new RegExp(`<c r="${ref}" s="(\\d+)"`))?.[1];
  };
  return { header: at('Expense Input', 'A4'), date: at('Expense Input', 'A5'), aed: at('Expense Input', 'F5'), text: at('Expense Input', 'B5'), usd: at('Income Input', 'M7'),
    banner: at('Lists & Sources', 'A1'), note: at('Apartment Performance', 'A2') };
}
/** The .xlsx, sheets in the master's order: Dashboard, Apartment Performance, Monthly Summary, Income Input,
 *  Expense Input, Lists & Sources. Formulas are the master's; cached values are computed here (Excel recalculates). */
export function workbookXlsx(result) {
  const S = STYLE, end = result.monthEnd, m3 = result.m3 ?? m3Values(result), company = result.reportTitle || result.companyName || 'Co-Host Pro';
  const aed = (v, f) => (f ? { f, v, s: S.aed } : { v, s: S.aed });
  // ── Income Input ──
  const inc = {
    1: [{ v: 'Income Input - Month-by-Month (edit yellow cells only)', s: S.title }],
    2: ['Reporting month end', { v: excelDate(end), s: S.date }, 'USD to AED rate', { v: result.usdAed, s: S.rate }],
    3: ['Instructions', 'Add new income below. Use Data View carefully; Property Report rows are excluded from total revenue.', null, null, null, null, 'Received Net Income', { f: 'SUMIF(I7:I507,"Received",H7:H507)', v: 0, s: S.aed }],
    4: [null, null, null, null, null, null, 'Pending Net Income', { f: 'SUMIF(I7:I507,"Pending",H7:H507)', v: 0, s: S.aed }],
    6: INCOME_HEADERS.map(v => ({ v, s: S.header })),
  };
  let rec = 0, pen = 0;
  result.income.forEach((r, i) => {
    const isUsd = r.usd != null, F = isUsd ? r.usd * r.fx : r.gross, n = 7 + i, net = F - r.cost;
    if (r.status === 'Received') rec += net; if (r.status === 'Pending') pen += net;
    inc[n] = [{ v: excelDate(r.date), s: S.date }, r.category, r.property, r.payer, r.description,
      isUsd ? aed(F, `M${n}*N${n}`) : aed(r.gross), aed(r.cost), aed(net, `F${n}-G${n}`), r.status,
      { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: monthLabel(r.date) }, r.source, r.view,
      isUsd ? { v: r.usd, s: S.usd } : null, isUsd ? { f: '$D$2', v: r.fx, s: S.rate } : null];
  });
  inc[3][7].v = rec; inc[4][7].v = pen;
  // The master carries Net and Month formulas down to row 507 for new rows.
  for (let n = 7 + result.income.length; n <= 507; n++) inc[n] = [null, null, null, null, null, null, null, { f: `F${n}-G${n}`, v: 0 }, null, { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: '' }];
  // ── Expense Input ──
  const exp = {
    1: [{ v: 'Expense Input - Month-by-Month (edit yellow cells only)', s: S.title }],
    2: ["Add outgoing costs below. Treatment: Operating Expense (company P&L), Refundable Deposit (returned later), Owner Paid (excluded) for costs paid from an owner's money, Pass-through (excluded) for items that net to zero."],
    4: EXPENSE_HEADERS.map(v => ({ v, s: S.header })),
  };
  result.expense.forEach((r, i) => {
    const n = 5 + i;
    exp[n] = [{ v: excelDate(r.date), s: S.date }, r.category, r.property, r.paidBy, r.description, aed(r.amount), r.paymentStatus, r.treatment, { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: monthLabel(r.date) }];
  });
  for (let n = 5 + result.expense.length; n <= 503; n++) exp[n] = [null, null, null, null, null, null, null, null, { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: '' }];

  // ── Expense Line Items (the master's sheet 6): every PMS expense line; ties to Expense Input ──
  const EL = result.expenseLines ?? [], elFirst = 5, elLast = Math.max(elFirst, elFirst + EL.length - 1);
  const elIn = S0 => S0.filter(x => x.inInput === 'Yes').reduce((n, x) => n + cents(x.amount), 0) / 100;
  const expTotal = result.expense.reduce((n, x) => n + cents(x.amount), 0) / 100;
  const el = {
    1: [{ v: `${company} - Expense Line Items`, s: S.banner }],
    2: ['On Expense Input (AED)', null, null, null, null, aed(elIn(EL), `SUMIFS(F${elFirst}:F${elLast + 500},M${elFirst}:M${elLast + 500},"Yes")`), 'Expense Input total', aed(expTotal, "SUM('Expense Input'!$F$5:$F$503)"), 'Tie', { f: `IF(ROUND(F2-H2,2)=0,"OK","REVIEW")`, v: cents(elIn(EL)) === cents(expTotal) ? 'OK' : 'REVIEW' }],
    3: [{ v: 'Every Co-Host Pro expense line in the export range. Lines not on Expense Input (other currencies, categories with no master equivalent) are listed with the reason.', s: S.note }],
    4: [...EXPENSE_HEADERS, 'Currency', 'Original Amount', 'PMS Source', 'In Expense Input', 'Note'].map(v => ({ v, s: S.header })),
  };
  EL.forEach((r, i) => {
    const n = elFirst + i;
    el[n] = [{ v: excelDate(r.date), s: S.date }, r.category, r.property, r.paidBy, r.description, r.amount == null ? null : aed(r.amount), r.paymentStatus, r.treatment, { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: monthLabel(r.date) },
      r.currency, { v: r.original, s: r.currency === 'USD' ? S.usd : r.currency === 'AED' ? S.aed : S.none }, r.source, r.inInput, r.note || null];
  });
  // ── Confirmed Booking (the master's sheet 7): confirmed stays overlapping the range ──
  const CB = result.confirmedBookings ?? [], cbFirst = 5, cbLast = Math.max(cbFirst, cbFirst + CB.length - 1), cbR = c => `${c}${cbFirst}:${c}${cbLast + 500}`;
  const aedSum = k => CB.filter(b => b.currency === 'AED').reduce((n, b) => n + cents(b[k] ?? 0), 0) / 100;
  const cb = {
    1: [{ v: `${company} - Confirmed Bookings`, s: S.banner }],
    2: ['Bookings', { f: `COUNT(${cbR('A')})`, v: CB.length }, 'Nights', { f: `SUM(${cbR('G')})`, v: CB.reduce((n, b) => n + b.nights, 0) }, 'Gross (AED)', aed(aedSum('gross'), `SUMIFS(${cbR('I')},${cbR('H')},"AED")`), 'Management fee (AED)', aed(aedSum('management'), `SUMIFS(${cbR('N')},${cbR('H')},"AED")`),
      'Airbnb earnings (AED)', aed(CB.filter(b => b.earningsCurrency === 'AED').reduce((x, b) => x + cents(b.airbnbEarnings), 0) / 100, `SUMIFS(${cbR('J')},${cbR('K')},"AED")`)],
    3: [{ v: 'Confirmed, checked-in and checked-out Co-Host Pro bookings whose stay overlaps the export range. Other currencies stay separate (not added to the AED totals).', s: S.note }],
    4: ['Booking ID', 'Reference', 'Property', 'Platform', 'Check-in', 'Check-out', 'Nights', 'Currency', 'Gross Amount', 'Airbnb Earnings', 'Earnings Currency', 'Cleaning Fee', 'Channel Fees', 'Management Fee', 'Owner Amount', 'Payment Status', 'Status', 'Statement Month'].map(v => ({ v, s: S.header })),
  };
  CB.forEach((b, i) => {
    const n = cbFirst + i, money = v => (v == null ? null : b.currency === 'AED' ? aed(v) : v);
    cb[n] = [b.id, b.reference || null, b.property, b.platform, { v: excelDate(b.checkIn), s: S.date }, { v: excelDate(b.checkOut), s: S.date }, { f: `IF(OR(E${n}="",F${n}=""),"",F${n}-E${n})`, v: b.nights },
      b.currency, money(b.gross), b.airbnbEarnings == null ? null : b.earningsCurrency === 'AED' ? aed(b.airbnbEarnings) : b.airbnbEarnings, b.earningsCurrency, money(b.cleaning), money(b.channel), money(b.management), money(b.owner), b.paymentStatus, b.status, { f: `IF(F${n}="","",TEXT(F${n},"mmm yyyy"))`, v: monthLabel(b.checkOut) }];
  });

  // ── Lists & Sources ──
  const L = result.lists, props = L.properties, N = props.length;
  const ls = { 1: [{ v: `${company} - Lists, Mapping & Sources`, s: S.banner }], 3: [{ v: 'Properties', s: S.listHeader }, { v: 'Active?', s: S.listHeader }, { v: 'Income Categories', s: S.listHeader }, null, { v: 'Expense Categories', s: S.listHeader }, null, { v: 'Payment Status', s: S.listHeader }, null, { v: 'Accounting Treatment', s: S.listHeader }] };
  const colA = [...props.map(p => p.name), 'Company', 'Various'], listEnd = 3 + colA.length;
  const setCell = (rows, r, c, v) => { rows[r] ??= []; rows[r][c] = v; };
  colA.forEach((v, i) => { setCell(ls, 4 + i, 0, v); if (i < N) setCell(ls, 4 + i, 1, props[i].active ? 'Yes' : 'No'); });
  MASTER_INCOME_CATEGORIES.forEach((v, i) => setCell(ls, 4 + i, 2, v));
  MASTER_EXPENSE_CATEGORIES.forEach((v, i) => setCell(ls, 4 + i, 4, v));
  MASTER_PAYMENT_STATUSES.forEach((v, i) => setCell(ls, 4 + i, 6, v));
  MASTER_TREATMENTS.forEach((v, i) => setCell(ls, 4 + i, 8, v));
  const itemsRow = Math.max(22, 4 + Math.max(colA.length, MASTER_INCOME_CATEGORIES.length, MASTER_EXPENSE_CATEGORIES.length) + 0);
  ls[itemsRow] = ['Item', 'Value', 'Units', 'Period / As-of', 'Source', 'Reference', 'Treatment', 'Notes'].map(v => ({ v, s: S.header }));
  let ir = itemsRow + 1;
  const CK = result.checks ?? checkValues(result), ckFirst = 4, ckStatus = ckFirst + CK.checks.length;
  const itemRow = i => itemsRow + 1 + i;
  const checkRowOf = i => { const k = CK.checks.findIndex(c => (c.items ?? []).includes(i)); return k < 0 ? null : ckFirst + k; };
  (L.items ?? []).forEach((it, i) => {
    const cr = checkRowOf(i), notes = it.notes == null ? null : cr == null ? it.notes.replace(/ ?\(?Checks row \{check\}\)?/, '') || null : it.notes.replace('{check}', String(cr));
    ls[ir++] = [it.item, { v: it.value, s: it.units === 'USD' ? S.usd : it.units === 'AED' ? S.aed : S.none }, it.units, it.period, it.source, it.reference ?? null, it.treatment ?? null, notes];
  });
  const depTitle = Math.max(33, ir + 2), depFirst = depTitle + 2, depLast = Math.max(depFirst + 5, depFirst + L.depositsHeld.length - 1);
  ls[depTitle] = [{ v: 'Deposits held for guests / tenants (owed back - liability, not income)', s: S.header }];
  ls[depTitle + 1] = ['Date', 'Property', 'From', 'Amount (AED)', 'Status', 'Notes'].map(v => ({ v, s: S.listHeader }));
  L.depositsHeld.forEach((d, i) => { ls[depFirst + i] = [{ v: excelDate(d.date), s: S.date }, d.property, d.from, d.amount == null ? `${d.currency} ${d.original.toFixed(2)}` : aed(d.amount), d.status, d.notes]; });

  // ── Monthly Summary ──
  const months = m3.summary, mFirst = 4, mLast = 3 + months.length, mTot = mLast + 1;
  const ms = { 1: [{ v: 'Monthly Summary - Formula Driven', s: S.banner }], 3: ['Month', 'Income (AED)', 'Operating Expenses (AED)', 'Refundable Deposits (AED)', 'Net Operating Profit (AED)', 'Margin', 'Total Cash Outflow (AED)', 'Status'].map(v => ({ v, s: S.headerWrap })) };
  months.forEach((x, i) => {
    const n = mFirst + i, win = (rng, crit) => `${rng},">="&A${n},${crit},"<"&EDATE(A${n},1)`;
    ms[n] = [{ v: excelDate(`${x.month}-01`), s: S.monthYear },
      aed(x.income, `SUMIFS('Income Input'!$H$7:$H$507,${win("'Income Input'!$A$7:$A$507", "'Income Input'!$A$7:$A$507")},'Income Input'!$L$7:$L$507,"<>Airbnb Property Report")`),
      aed(x.opex, `SUMIFS('Expense Input'!$F$5:$F$503,${win("'Expense Input'!$A$5:$A$503", "'Expense Input'!$A$5:$A$503")},'Expense Input'!$H$5:$H$503,"Operating Expense")`),
      aed(x.deposits, `SUMIFS('Expense Input'!$F$5:$F$503,${win("'Expense Input'!$A$5:$A$503", "'Expense Input'!$A$5:$A$503")},'Expense Input'!$H$5:$H$503,"Refundable Deposit")`),
      aed(x.net, `B${n}-C${n}`), { f: `IFERROR(E${n}/B${n},0)`, v: x.margin, s: S.pct }, aed(x.cashOut, `C${n}+D${n}`),
      { f: `IF(AND(B${n}=0,C${n}=0,D${n}=0),"No activity",IF(E${n}>=0,"Profit","Loss"))`, v: x.status }];
  });
  const T = m3.totals;
  ms[mTot] = [{ v: 'TOTAL', s: S.header }, ...['income', 'opex', 'deposits', 'net'].map((k, i) => ({ f: `SUM(${'BCDE'[i]}${mFirst}:${'BCDE'[i]}${mLast})`, v: T[k], s: S.headerAed })), { f: `IFERROR(E${mTot}/B${mTot},0)`, v: T.margin, s: S.headerPct }, { f: `SUM(G${mFirst}:G${mLast})`, v: T.cashOut, s: S.headerAed }];

  // ── Apartment Performance ──
  const aFirst = 5, aLast = 4 + N, aTot = aLast + 3, G = `$G$${aFirst}:$G$${aLast}`, B2 = 'Dashboard!$B$2';
  const ap = {
    1: [{ v: 'Apartment Performance - Ranked by Net Income', s: S.banner }],
    2: [{ v: 'Figures to the reporting month end (Dashboard B2), from Income Input and Expense Input. Property list comes from Lists & Sources. Airbnb property report rows are shown per property but excluded from company totals to avoid double counting. Rank ties are broken by list order.', s: S.note }],
    4: [{ v: 'Rank', s: S.header }, { v: null, s: S.header }, ...['Property', 'Gross Income (AED)', 'Direct Costs (AED)', 'Allocated Expenses (AED)', 'Net Contribution (AED)', 'Share of Property Income'].map(v => ({ v, s: S.header }))],
  };
  ap[4][1] = { v: '', s: S.header };
  const ownerCol = result.config?.apartmentOwnerPaidColumn !== false;
  if (ownerCol) { ap[4][8] = null; ap[4][9] = { v: 'Owner Paid (AED) - flagged, excluded', s: S.header }; }
  m3.apartments.forEach((x, i) => {
    const n = aFirst + i;
    const inc = col => `SUMIFS('Income Input'!$${col}$7:$${col}$507,'Income Input'!$C$7:$C$507,C${n},'Income Input'!$L$7:$L$507,"<>Airbnb Monthly Report",'Income Input'!$A$7:$A$507,"<="&${B2})`;
    const ex = tr => `SUMIFS('Expense Input'!$F$5:$F$503,'Expense Input'!$C$5:$C$503,C${n},'Expense Input'!$H$5:$H$503,"${tr}",'Expense Input'!$A$5:$A$503,"<="&${B2})`;
    ap[n] = [{ f: `RANK(G${n},${G},0)+COUNTIF($G$${aFirst}:G${n},G${n})-1`, v: x.rank }, null, { f: `'Lists & Sources'!A${4 + i}`, v: x.property },
      aed(x.gross, inc('F')), aed(x.directCosts, inc('G')), aed(x.allocated, ex('Operating Expense')), aed(x.net, `D${n}-E${n}-F${n}`), { f: `IFERROR(D${n}/SUM($D$${aFirst}:$D$${aLast}),0)`, v: x.share, s: S.pct }];
    if (ownerCol) { ap[n][8] = null; ap[n][9] = aed(x.ownerPaid, ex('Owner Paid (excluded)')); }
  });
  const AT = m3.apartmentTotals;
  ap[aTot] = [null, null, { v: 'TOTAL', s: S.header }, ...['gross', 'directCosts', 'allocated', 'net'].map((k, i) => ({ f: `SUM(${'DEFG'[i]}${aFirst}:${'DEFG'[i]}${aLast})`, v: AT[k], s: S.headerAed })), { f: `SUM(H${aFirst}:H${aLast})`, v: AT.share, s: S.headerPct }];
  if (ownerCol) { ap[aTot][8] = null; ap[aTot][9] = { f: `SUM(J${aFirst}:J${aLast})`, v: AT.ownerPaid, s: S.headerAed }; }

  // ── Checks (M4): the master's formulas; Expected points at the Lists & Sources items ──
  const II = "'Income Input'!", EI = "'Expense Input'!", MSr = "'Monthly Summary'!";
  const expectedF = c => { const rows = (c.items ?? []).map(itemRow); if (!rows.length) return null; return rows.length === 1 ? `'Lists & Sources'!B${rows[0]}` : `SUM(${rows.map(n => `'Lists & Sources'!B${n}`).join(',')})`; };
  const actualF = c => ({
    'airbnb-monthly': `SUMIFS(${II}$H$7:$H$507,${II}$L$7:$L$507,"Airbnb Monthly Report")/${II}$D$2`,
    'airbnb-property': `SUMIFS(${II}$H$7:$H$507,${II}$L$7:$L$507,"Airbnb Property Report")/${II}$D$2`,
    'income-check': c.month && `SUMIFS(${II}$H$7:$H$507,${II}$C$7:$C$507,"${c.property}",${II}$A$7:$A$507,">="&DATE(${Number(c.month.slice(0, 4))},${Number(c.month.slice(5))},1),${II}$A$7:$A$507,"<"&DATE(${Number(addMonths(c.month, 1).slice(0, 4))},${Number(addMonths(c.month, 1).slice(5))},1))`,
    'summary-tie': `SUM(${MSr}$B$${mFirst}:$B$${mLast})`,
    'ranking': `COUNTA('Apartment Performance'!C${aFirst}:C${aLast})`,
    'opex-tie': `SUM(${MSr}C${mFirst}:C${mLast})`,
    'deposits': `SUMIFS(${EI}$F$5:$F$503,${EI}$H$5:$H$503,"Refundable Deposit")`,
    'lease': `SUMIFS(${EI}$F$5:$F$503,${EI}$B$5:$B$503,"Rent",${EI}$C$5:$C$503,"${c.property}")`,
  })[c.key];
  const fixedExpected = c => ({
    'summary-tie': `SUMIFS(${II}$H$7:$H$507,${II}$L$7:$L$507,"<>Airbnb Property Report")`,
    'ranking': `COUNTIFS('Lists & Sources'!A4:A${listEnd},"<>",'Lists & Sources'!A4:A${listEnd},"<>Company",'Lists & Sources'!A4:A${listEnd},"<>Various")`,
    'opex-tie': `SUMIFS(${EI}$F$5:$F$503,${EI}$H$5:$H$503,"Operating Expense",${EI}$A$5:$A$503,">="&${MSr}$A$${mFirst},${EI}$A$5:$A$503,"<"&EDATE(${MSr}$A$${mLast},1))`,
  })[c.key];
  const ck = { 1: [{ v: 'Model Checks', s: S.banner }], 3: ['Check', 'Actual', 'Expected', 'Difference', 'Tolerance', 'Status', 'Fix / Notes'].map(v => ({ v, s: S.headerWrap })) };
  CK.checks.forEach((c, i) => {
    const n = ckFirst + i, num = (v, f) => (f ? { f, v, s: S.checkNum } : { v, s: S.checkNum });
    ck[n] = [{ v: c.label, s: S.checkText }, num(c.actual, actualF(c)), num(c.expected, fixedExpected(c) ?? expectedF(c)), num(c.diff, `B${n}-C${n}`), num(c.tolerance), { f: `IF(ABS(D${n})<=E${n},"OK","REVIEW")`, v: c.status, s: S.checkText }, { v: c.note, s: S.checkText }];
  });
  ck[ckStatus] = [{ v: 'MODEL STATUS', s: S.header }, { f: `IF(COUNTIF(F${ckFirst}:F${ckStatus - 1},"REVIEW")=0,"PASS","REVIEW")`, v: CK.status, s: S.header }];

  // ── Forecast (M5): the master's "Cash Forecast" sheet, wired to Dashboard J5, Lists & Sources and the Inputs ──
  const FC = result.forecast ?? forecastValues(result), FI = FC.inputs, up = FI.lease?.upcoming ?? [];
  const dashLabel = iso => `${Number(iso.slice(8, 10))} ${MON3[Number(iso.slice(5, 7)) - 1]}${' ' + iso.slice(0, 4)}`;
  const spanLabel = (a, b) => a.slice(0, 4) === b.slice(0, 4) ? `${dashLabel(a).slice(0, -5)} - ${dashLabel(b)}` : `${dashLabel(a)} - ${dashLabel(b)}`;
  const dFirst = 15, dLast = 14 + up.length, oneRow = Math.max(dLast, 14) + 1, oneMonthRow = oneRow + 1, expRow = oneMonthRow + 1, expFromRow = expRow + 1, fHdr = expFromRow + 2, f1 = fHdr + 1, fN = fHdr + FC.months.length, fTot = fN + 1, fSum = fTot + 2;
  const iiWin = `'Income Input'!$A$7:$A$507,">="&$B$8,'Income Input'!$A$7:$A$507,"<="&'Income Input'!$B$2`;
  const eiWin = `'Expense Input'!$A$5:$A$503,">="&$B$8,'Expense Input'!$A$5:$A$503,"<="&'Income Input'!$B$2`;
  const opx = extra => `SUMIFS('Expense Input'!$F$5:$F$503,'Expense Input'!$H$5:$H$503,"Operating Expense",${extra}${eiWin})`;
  const ml = iso => `${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const avail = (FI.openingBasis ?? 'available') === 'available', OO = FI.oneOff ?? { amount: 0, rows: [], items: [], month: FI.start };
  const fc = {
    1: [{ v: `Cash Forecast - ${FC.months.length} Months (${ml(FI.start)} to ${ml(`${FC.months[FC.months.length - 1].month}-01`)})`, s: S.bannerDark }],
    2: [{ v: 'Yellow cells are inputs. Defaults link to the workbook; type over any yellow cell to test a scenario and every month updates.', s: S.note }],
    4: [{ v: 'Input', s: S.headerWrap }, { v: 'Value', s: S.headerWrap }, { v: 'Source / note', s: S.headerWrap }],
    5: avail ? ['Opening balance - available after deposits held', { f: 'Dashboard!J13', v: FI.opening, s: S.fInAed }, `Dashboard: bank balance less tenant deposits held${L.bank ? ` (${dashLabel(L.bank.balanceDate)})` : ' (bank balance not entered)'}`]
      : ['Opening bank balance', { f: 'Dashboard!J5', v: FI.opening, s: S.fInAed }, L.bank ? `Dashboard current bank balance (${L.bank.account}, ${dashLabel(L.bank.balanceDate)})` : 'Dashboard current bank balance (not entered)'],
    6: ['Forecast start month', { v: excelDate(FI.start), s: S.fInMonth }, 'First forecast month'],
    7: ['Months used for averages', { v: FI.averageMonths, s: S.fInInt }, 'Last complete months up to the reporting month end (Income Input B2)'],
    8: ['Average window starts', { f: "EOMONTH('Income Input'!$B$2,-B7)+1", v: excelDate(FI.windowStart), s: S.fCalcDate }, 'Calculated - not an input'],
    9: ['Monthly income - Airbnb net payouts', { f: `SUMIFS('Income Input'!$H$7:$H$507,'Income Input'!$L$7:$L$507,"Airbnb Monthly Report",${iiWin})/$B$7`, v: FI.airbnb, s: S.fInAed }, result.config?.forecastAirbnbNote ?? 'Average of Airbnb Monthly Report rows'],
    10: ['Monthly income - fees, commissions & other', { f: `SUMIFS('Income Input'!$H$7:$H$507,'Income Input'!$L$7:$L$507,"Transaction",${iiWin})/$B$7`, v: FI.other, s: S.fInAed }, 'Average of Transaction rows: management fees, commissions, cleaning, bookings'],
    11: ['Monthly operating expenses (excl. rent & salary)', { f: `(${opx('')}-${opx(`'Expense Input'!$B$5:$B$503,"Rent",`)}-${opx(`'Expense Input'!$B$5:$B$503,"Salary",`)})/$B$7`, v: FI.opex, s: S.fInAed }, 'Average of Operating Expense rows, excluding Rent and Salary'],
    12: ['Monthly salary - Clifford', { v: FI.salary, s: S.fInAed }, result.config?.forecastSalaryNote ?? ''],
    13: [`${FI.lease?.property ?? 'Lease'} annual rent`, FI.rentItem >= 0 ? { f: `'Lists & Sources'!B${itemRow(FI.rentItem)}`, v: FI.annualRent, s: S.fInAed } : { v: 0, s: S.fInAed }, FI.lease ? `Lease ${spanLabel(FI.lease.startDate, FI.lease.endDate)}` : 'No lease'],
    14: [`Rent cheque amount (${(FI.lease?.cheques ?? 4) === 4 ? 'quarterly' : `${FI.lease.cheques} cheques`})`, { f: `B13/${FI.lease?.cheques ?? 4}`, v: FI.chequeAmount, s: S.fInAed }, `Annual rent / ${FI.lease?.cheques ?? 4}`],
  };
  up.forEach((u, i) => { fc[dFirst + i] = [`Rent cheque date - Q${u.seq}`, { v: excelDate(u.dueDate), s: S.fInDate }, `Covers ${spanLabel(u.coverStart, u.coverEnd)}`]; });
  // One-off income (master B18:B19): pending company income after the reporting month, outside the averages.
  const ooItem = OO.items[0], ooF = OO.rows.length ? OO.rows.map(n => `'Income Input'!H${n}`).join('+') : null;
  fc[oneRow] = [OO.items.length === 1 ? `One-off income - ${ooItem.description}` : OO.items.length ? `One-off income - ${OO.items.length} pending company items` : 'One-off income',
    ooF ? { f: ooF, v: OO.amount, s: S.fInAed } : { v: 0, s: S.fInAed },
    OO.rows.length ? `Income Input row${OO.rows.length > 1 ? 's' : ''} ${OO.rows.join(', ')} (Pending, expected ${dashLabel(ooItem.date)}); not part of the averages` : 'No pending company income after the reporting month end; not part of the averages'];
  fc[oneMonthRow] = ['One-off income month', { v: excelDate(OO.month), s: S.fInMonth }, 'Month the one-off income lands'];
  const EX = FI.expected ?? { monthly: 0, from: FI.start }, avgLabel = `${MON3[Number(FI.windowStart.slice(5, 7)) - 1]}-${MON3[Number(end.slice(5, 7)) - 1]}`;
  fc[expRow] = [`Expected commissions / month (from ${ml(EX.from)})`, { v: EX.monthly, s: S.fInAed }, `Expected future commissions, separate from the ${avgLabel} averages and the ${MONTHS[Number(OO.month.slice(5, 7)) - 1]} one-off`];
  fc[expFromRow] = ['Expected commissions start month', { v: excelDate(EX.from), s: S.fInMonth }, 'Applies from this month to the end of the forecast'];
  fc[fHdr] = ['Month', 'Opening balance', 'Income', 'One-off income', 'Expected commissions', 'Operating expenses', 'Salary', `Rent - ${FI.lease?.property ?? 'lease'}`, 'Net cash flow', 'Closing balance'].map(v => ({ v, s: S.headerWrap }));
  const rentRange = up.length ? `$B$${dFirst}:$B$${dLast}` : null;
  FC.months.forEach((x, i) => {
    const n = f1 + i, A = v => ({ ...v, s: S.fAed });
    fc[n] = [{ f: i ? `EDATE(A${n - 1},1)` : '$B$6', v: excelDate(`${x.month}-01`), s: S.fMonth }, A({ f: i ? `J${n - 1}` : '$B$5', v: x.opening }), A({ f: '$B$9+$B$10', v: x.income }),
      A({ f: `IF(AND(YEAR($B$${oneMonthRow})=YEAR(A${n}),MONTH($B$${oneMonthRow})=MONTH(A${n})),$B$${oneRow},0)`, v: x.oneOff ?? 0 }), A({ f: `IF(A${n}>=$B$${expFromRow},$B$${expRow},0)`, v: x.expected ?? 0 }),
      A({ f: '$B$11', v: x.opex }), A({ f: '$B$12', v: x.salary }),
      A(rentRange ? { f: `SUMPRODUCT((${rentRange}>=A${n})*(${rentRange}<EDATE(A${n},1)))*$B$14`, v: x.rent } : { v: 0 }), A({ f: `C${n}+D${n}+E${n}-F${n}-G${n}-H${n}`, v: x.net }), A({ f: `B${n}+I${n}`, v: x.closing })];
  });
  fc[fTot] = [{ v: 'TOTAL', s: S.header }, null, ...['income', 'oneOff', 'expected', 'opex', 'salary', 'rent', 'net'].map((k, i) => ({ f: `SUM(${'CDEFGHI'[i]}${f1}:${'CDEFGHI'[i]}${fN})`, v: FC.totals[k] ?? 0, s: S.headerAed })), { f: `J${fN}`, v: FC.totals.closing, s: S.headerAed }];
  fc[fSum] = [{ v: 'Closing balance summary', s: S.headerWrap }];
  FC.after.forEach((a, i) => {
    const src = f1 + a.months - 1, label = a.months === 1 ? MONTHS[Number(a.month.slice(5, 7)) - 1] : `${a.months} months`;
    fc[fSum + 1 + i] = [{ f: `"${label} ("&TEXT(A${src},"mmm yyyy")&")"`, v: `${label} (${ml(`${a.month}-01`)})` }, { f: `J${src}`, v: a.closing, s: S.fAed }];
  });
  fc[fSum + 1 + FC.after.length] = ['Lowest month-end balance', { f: `MIN(J${f1}:J${fN})`, v: FC.lowest, s: S.fAed }];
  fc[fSum + 2 + FC.after.length] = ['Lowest month', { f: `INDEX(A${f1}:A${fN},MATCH(B${fSum + 1 + FC.after.length},J${f1}:J${fN},0))`, v: FC.lowestMonth ? excelDate(`${FC.lowestMonth}-01`) : '', s: S.fMonth }];

  // ── Dashboard ──
  const D = m3.dashboard, bank = L.bank;
  const kpi = v => ({ v, s: S.kpiAed });
  const db = {
    1: [{ v: `${company} - Finance Dashboard`, s: S.banner }],
    2: [{ v: 'Reporting period', s: S.greyLabel }, { f: "'Income Input'!B2", v: excelDate(end), s: S.greyDate }, null, { v: 'Currency', s: S.greyLabel }, { v: 'AED', s: S.greyLabel }, null, { v: 'Model status', s: S.greyLabel }, { f: `Checks!B${ckStatus}`, v: CK.status, s: S.greyLabel }, null, { v: 'Updated', s: S.greyLabel }, { v: result.today ? dayLabel(result.today) : dayLabel(end), s: S.greyLabel }],
    4: [{ v: 'PROPERTIES MANAGED', s: S.kpiTeal }, null, null, { v: 'INCOME - REPORTING MONTH', s: S.kpiTeal }, null, null, { v: 'TENANT DEPOSITS HELD', s: S.kpiTeal }, null, null, { v: `BANK BALANCE - ADIB - ${bank ? dayLabel(bank.balanceDate).toUpperCase() : 'NOT ENTERED'}`, s: S.kpiTeal }],
    5: [{ f: `COUNTIF('Lists & Sources'!$B$4:$B$${listEnd},"Yes")`, v: D.propertiesManaged, s: S.kpiInt }, null, null,
      { f: `SUMIFS('Monthly Summary'!$B$${mFirst}:$B$${mLast},'Monthly Summary'!$A$${mFirst}:$A$${mLast},DATE(YEAR($B$2),MONTH($B$2),1))`, v: D.incomeMonth, s: S.kpiAed }, null, null,
      { f: `SUMIFS('Lists & Sources'!$D$${depFirst}:$D$${depLast},'Lists & Sources'!$E$${depFirst}:$E$${depLast},"Held")`, v: D.depositsHeld, s: S.kpiAed }, null, null,
      bank ? kpi(bank.balance) : { v: '', s: S.kpiAed }],
    8: [{ v: 'INCOME YTD', s: S.kpiTeal }, null, null, { v: 'OPERATING EXPENSES', s: S.kpiRed }, null, null, { v: 'NET OPERATING PROFIT', s: S.kpiNavy }, null, null, { v: 'REFUNDABLE DEPOSITS', s: S.kpiAmber }],
    9: [{ f: `SUMIFS('Income Input'!$H$7:$H$507,'Income Input'!$L$7:$L$507,"<>Airbnb Property Report",'Income Input'!$A$7:$A$507,"<="&$B$2)`, v: D.incomeYtd, s: S.kpiAed }, null, null,
      { f: `SUMIFS('Expense Input'!$F$5:$F$503,'Expense Input'!$A$5:$A$503,"<="&$B$2,'Expense Input'!$H$5:$H$503,"Operating Expense")`, v: D.opex, s: S.kpiAed }, null, null,
      { f: 'A9-D9', v: D.netProfit, s: S.kpiAed }, null, null,
      { f: `SUMIFS('Expense Input'!$F$5:$F$503,'Expense Input'!$A$5:$A$503,"<="&$B$2,'Expense Input'!$H$5:$H$503,"Refundable Deposit")`, v: D.refundableDeposits, s: S.kpiAed }],
    12: [null, null, null, null, null, null, null, null, null, { v: 'AVAILABLE AFTER DEPOSITS HELD', s: S.kpiTeal }],
    13: [null, null, null, null, null, null, null, null, null, { f: 'J5-G5', v: (bank ? bank.balance : 0) - D.depositsHeld, s: S.kpiAed }],
    18: [{ v: 'Monthly Performance', s: S.header }, null, null, null, null, null, { v: 'Top Properties', s: S.header }],
    19: [...['Month', 'Income', 'Operating Expenses', 'Net Profit', 'Margin'].map(v => ({ v, s: S.header })), null, ...['Rank', 'Property', 'Net Contribution'].map(v => ({ v, s: S.header }))],
  };
  months.forEach((x, i) => {
    const n = 20 + i, src = mFirst + i;
    db[n] = [{ f: `TEXT('Monthly Summary'!A${src},"mmm yyyy")`, v: monthLabel(`${x.month}-01`) }, aed(x.income, `'Monthly Summary'!B${src}`), aed(x.opex, `'Monthly Summary'!C${src}`), aed(x.net, `'Monthly Summary'!E${src}`), { f: `'Monthly Summary'!F${src}`, v: x.margin, s: S.pct }];
  });
  D.top.forEach((t, i) => {
    const n = 20 + i; db[n] ??= []; while (db[n].length < 6) db[n].push(null);
    db[n][6] = t.rank;
    db[n][7] = { f: `INDEX('Apartment Performance'!$C$${aFirst}:$C$${aLast},MATCH(G${n},'Apartment Performance'!$A$${aFirst}:$A$${aLast},0))`, v: t.property ?? '#N/A' };
    db[n][8] = t.net == null ? { f: `INDEX('Apartment Performance'!$G$${aFirst}:$G$${aLast},MATCH(G${n},'Apartment Performance'!$A$${aFirst}:$A$${aLast},0))`, v: '#N/A', s: S.aed } : aed(t.net, `INDEX('Apartment Performance'!$G$${aFirst}:$G$${aLast},MATCH(G${n},'Apartment Performance'!$A$${aFirst}:$A$${aLast},0))`);
  });

  // Written into the master workbook itself (lib/yalla-master-template.mjs): its styles, widths, heights, merges,
  // conditional formats, validations, freeze panes, cards and charts; variable sections mapped onto the master's rows.
  const tpl = loadTemplate(TEMPLATE_GZ_B64), seg = (a, b, c, d) => (b >= a ? [{ our: [a, b], master: [c, d] }] : []);
  const ms0 = masterStyles(tpl);
  const role = s => (s === S.header || s === S.headerWrap || s === S.listHeader ? ms0.header : s === S.date ? ms0.date : s === S.aed || s === S.headerAed ? ms0.aed : s === S.usd ? ms0.usd
    : s === S.banner || s === S.bannerDark || s === S.title ? ms0.banner : s === S.note ? ms0.note : ms0.text);
  const listCols = '<cols>' + Object.entries({ A: 14, B: 20, C: 25, D: 16, E: 36, F: 18, G: 17, H: 22, I: 14, J: 10, K: 16, L: 26, M: 16, N: 44 }).map(([c, w]) => `<col min="${c.charCodeAt(0) - 64}" max="${c.charCodeAt(0) - 64}" width="${w}" customWidth="1" style="183"/>`).join('') + '</cols>';
  const cbCols = '<cols>' + Object.entries({ A: 11, B: 18, C: 25, D: 12, E: 14, F: 14, G: 8, H: 10, I: 16, J: 16, K: 12, L: 16, M: 16, N: 18, O: 16, P: 16, Q: 13, R: 16 }).map(([c, w]) => `<col min="${c.charCodeAt(0) - 64}" max="${c.charCodeAt(0) - 64}" width="${w}" customWidth="1" style="183"/>`).join('') + '</cols>';
  const nItems = (L.items ?? []).length;
  return fillTemplate(tpl, [
    { name: 'Dashboard', rows: db },
    { name: 'Apartment Performance', rows: ap, segments: seg(aFirst, aLast, 5, 16), keep: [[60, 1004]], styleCols: { J: 'G' } },
    { name: 'Monthly Summary', rows: ms, segments: seg(mFirst, mLast, 4, 12) },
    { name: 'Income Input', rows: inc },
    { name: 'Expense Input', rows: exp },
    { name: 'Expense Line Items', rows: el, roleStyle: role, cols: listCols, extraMerges: ['A1:H1', 'A3:H3'] },
    { name: 'Confirmed Booking', rows: cb, roleStyle: role, cols: cbCols, extraMerges: ['A1:H1', 'A3:H3'] },
    { name: 'Lists & Sources', rows: ls, segments: [...seg(4, itemsRow - 1, 4, 21), ...seg(itemsRow, itemsRow, 22, 22), ...seg(itemsRow + 1, itemsRow + nItems, 23, 30), ...seg(depTitle, depTitle + 1, 33, 34), ...seg(depFirst, depLast, 35, 40)] },
    { name: 'Checks', rows: ck, segments: seg(ckFirst, ckStatus - 1, 4, 11) },
    { name: 'Forecast', rows: fc, segments: [...seg(dFirst, dLast, 15, 17), ...seg(oneRow, expFromRow, 18, 21), ...seg(f1, fN, 24, 32), ...seg(fSum + 1, fSum + FC.after.length, 36, 39)] },
  ]);
}
