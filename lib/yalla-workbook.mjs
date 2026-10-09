// YALLA monthly workbook export. M2: Income Input and Expense Input; M3: Monthly Summary, Apartment Performance,
// Dashboard (+ the Lists & Sources sheet their formulas read), in the master workbook's exact sheet names, layout,
// column order and formulas (YALLA_Financial_Report_with_Forecast.xlsm). Rules: /workspace/finance/yalla_export_spec.md
// (Raju, 9 Oct 2026). Every behaviour behind an open finance answer is a setting in ./yalla-config.mjs.
import { earningsDate } from './company-statement.mjs';
import { leaseAccruals } from './lease-schedule.mjs';
import { writeXlsx, excelDate, STYLE } from './xlsx-writer.mjs';
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
    const pool = other.size ? other : aed, rest = total - used, sum = [...pool.values()].reduce((a, b) => a + b, 0); let left = rest; const ids = [...pool.keys()];
    ids.forEach((pid, i) => { const u = i === ids.length - 1 ? left : Math.round(rest * pool.get(pid) / sum); add(pid, u); left -= u; });
  }
  return byProp;
}

/**
 * @param data { properties, owners, transactions, bookings (managementAmount resolved), earnings, payouts, statements,
 *   ownerPayouts, leases (with cheques), deposits, maintenance, bankBalances }
 * @param month YYYY-MM, the reporting month
 * @param overrides settings over WORKBOOK_DEFAULTS (yalla-config.mjs)
 * @param opts { from?: YYYY-MM (first month of Income/Expense rows; default the reporting month), today?, companyName? }
 */
export function buildWorkbookRows(data, month, overrides = {}, opts = {}) {
  const cfg = workbookConfig(overrides);
  const { properties = [], owners = [], transactions = [], bookings = [], earnings = [], payouts = [], statements = [], ownerPayouts = [], leases = [], deposits = [], maintenance = [], bankBalances = [] } = data;
  const from = opts.from && opts.from <= month ? opts.from : month;
  const start = `${from}-01`, reportStart = `${month}-01`, end = monthEnd(month), year = Number(month.slice(0, 4));
  const within = d => !!d && d >= start && d <= end;
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
  const catWarn = (sheet, cat, entered) => { const list = sheet === 'Income Input' ? MASTER_INCOME_CATEGORIES : MASTER_EXPENSE_CATEGORIES; if (!list.includes(cat)) warn('category', sheet + cat, `${sheet}: category "${cat}"${entered && entered !== cat ? ` (entered as "${entered}")` : ''} is not on the master's list`, { sheet, category: cat }); };

  // Properties on Lists & Sources: every property with a workbook name, in the master's order, then by name.
  const order = n => { const i = MASTER_PROPERTY_ORDER.indexOf(n); return i < 0 ? 999 : i; };
  const listed = properties.filter(p => p.reportName).map(p => ({ id: p.id, name: p.reportName, active: !cfg.inactiveReportNames.includes(p.reportName) }));
  for (const x of cfg.extraListProperties ?? []) if (!listed.some(p => p.name === x.name)) {
    listed.push({ id: null, name: x.name, active: x.active !== false, external: true });
    warn('extra-property', x.name, `${x.name} is on Lists & Sources from the export settings (not a PMS property): no rows come from Co-Host Pro for it`);
  }
  listed.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  for (const p of properties) if (!p.reportName && !['inactive', 'archived'].includes(p.status)) pname(p.id);

  // 1+2. Airbnb payouts by payout date (cash basis): each month's USD total counts; per-property rows are view-only.
  const allPayouts = payouts.map(p => { const lines = earnings.filter(e => e.payoutId === p.id); return { ...p, lines, ...payoutDate(p, lines, year) }; });
  const ytdStart = `${year}-01-01`;
  for (const p of allPayouts) if (p.ambiguous && cfg.flagAmbiguousPayoutYear && p.date && ((p.date >= ytdStart && p.date <= end) || within(p.date)))
    warn('payout-year', p.id, `Airbnb payout ${p.id} (${p.sourceDate}, ${p.currency} ${Number(p.amount).toFixed(2)}) has no year: ${p.ambiguous}; counted on ${p.date}`, { payoutId: p.id, date: p.date });
  for (const p of allPayouts) if (within(p.date) && p.currency !== 'USD') excluded.push({ sheet: 'Income Input', date: p.date, description: `Airbnb payout ${p.id}`, currency: p.currency, amount: Number(p.amount), reason: 'Only USD Airbnb payouts are converted (fixed 3.6725); other currencies stay separate' });
  const usdIn = (a, b) => allPayouts.filter(p => p.currency === 'USD' && p.date && p.date >= a && p.date <= b);
  for (let m = from; m <= month; m = addMonths(m, 1)) {
    const usd = usdIn(`${m}-01`, monthEnd(m)); if (!usd.length) continue;
    const total = usd.reduce((n, p) => n + cents(p.amount), 0) / 100;
    income.push({ kind: 'airbnb-monthly', date: monthEnd(m), category: 'Airbnb', property: 'Various', payer: 'Airbnb', description: `Exact Airbnb monthly net - ${m}`, usd: total, fx: USD_AED, gross: r2(total * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Monthly Report', payouts: usd.length });
  }
  const propertyRows = (byProp, row) => {
    const keys = new Set(byProp.keys());
    if (cfg.propertyReportZeroRows === 'active') for (const p of listed) if (p.active && !p.external) keys.add(p.id);
    const nm = k => k === 'unallocated' ? 'Various' : pname(k);
    for (const k of [...keys].sort((a, b) => order(nm(a)) - order(nm(b)) || String(nm(a)).localeCompare(String(nm(b))))) {
      const u = (byProp.get(k) ?? 0) / 100;
      if (!u && cfg.propertyReportZeroRows !== 'active') continue;
      income.push({ ...row, category: 'Airbnb', property: nm(k), payer: 'Airbnb', usd: u, fx: USD_AED, gross: r2(u * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Property Report' });
    }
  };
  if (cfg.propertyReportYtdRows) {
    const before = usdIn(ytdStart, monthEnd(addMonths(month, -1)));
    if (before.length) propertyRows(allocatePayouts(before), { kind: 'airbnb-ytd', date: reportStart, description: `Property allocation through 1 ${MON3[Number(month.slice(5)) - 1]} ${year} - excluded from dashboard total` });
  }
  { const cur = usdIn(reportStart, end); if (cur.length || cfg.propertyReportZeroRows === 'active') propertyRows(allocatePayouts(cur), { kind: 'airbnb-property', date: end, description: `${MONTHS[Number(month.slice(5)) - 1]} ${year} property allocation - excluded from dashboard total` }); }

  // 3. Management fees (and, if switched on, booking cleaning fees) from bookings in the owner-statement (checkout)
  //    month, for owned properties; bookings paid through the Airbnb USD payouts are already in the monthly total.
  const payoutCodes = new Set(earnings.filter(e => e.payoutId && payouts.some(p => p.id === e.payoutId)).map(e => `airbnb:${e.confirmationCode}`));
  for (const b of bookings) {
    if (b.financeMode !== 'inclusive-v1' || ['cancelled', 'blocked'].includes(b.status) || !within(b.checkOut) || payoutCodes.has(b.externalId)) continue;
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
    const category = mapIncomeCategory(t, cfg); catWarn('Income Input', category, t.category);
    const base = { kind: 'manual-income', date: t.date, category, property: pname(t.propertyId) ?? 'Various', payer: t.payer ?? ownerName(t.propertyId) ?? '', description: t.description, cost: cents(t.directCost) / 100, status: t.paymentStatus && t.paymentStatus !== 'paid' ? 'Pending' : 'Received', source: t.reference ? `Co-Host Pro entry ${t.reference}` : 'Co-Host Pro entry', view: 'Transaction', transactionId: t.id };
    if (t.currency === 'AED') income.push({ ...base, gross: cents(t.amount) / 100 });
    else if (t.currency === 'USD') { const fx = Number(t.fxRate || USD_AED); income.push({ ...base, usd: cents(t.amount) / 100, fx, gross: r2(Number(t.amount) * fx), cost: r2(Number(t.directCost || 0) * fx) }); }
    else excluded.push({ sheet: 'Income Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)` });
  }

  // 5. Deposits kept: a liability deposit kept against damage is income; an asset deposit the landlord keeps is an expense.
  for (const d of deposits) {
    if (d.status !== 'kept' || !within(d.settledOn) || !cents(d.keptAmount)) continue;
    if (d.kind === 'liability') { catWarn('Income Input', 'Damage recovery'); income.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Damage recovery', property: pname(d.propertyId) ?? 'Various', payer: d.counterparty, description: `Deposit kept against damage${d.keptReason ? `: ${d.keptReason}` : ''}`, gross: cents(d.keptAmount) / 100, cost: 0, status: 'Received', source: 'Deposits register', view: 'Transaction', depositId: d.id }); }
    else expense.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Security Deposit', property: pname(d.propertyId) ?? 'Company', paidBy: 'Company', description: `Deposit kept by ${d.counterparty}${d.keptReason ? `: ${d.keptReason}` : ''}`, amount: cents(d.keptAmount) / 100, paymentStatus: 'Paid', treatment: cfg.keptAssetDepositTreatment, depositId: d.id });
  }

  // Expenses 1: manual entries (and automatic cleaning costs), every treatment, flagged.
  for (const t of transactions) {
    if (t.type !== 'expense' || !within(t.date)) continue;
    const tr = effectiveTreatment(t), category = mapExpenseCategory(t, tr, cfg); catWarn('Expense Input', category, t.category);
    const row = { kind: 'entry', date: t.date, category, property: pname(t.propertyId) ?? 'Company', paidBy: tr === 'owner_paid' ? `Owner (${ownerName(t.propertyId) ?? 'unknown'})` : 'Company', description: t.description, paymentStatus: t.paymentStatus === 'pending' ? 'Pending' : t.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid', treatment: TREATMENT_LABEL[tr], transactionId: t.id, enteredCategory: t.category, ...(t.notes ? { notes: t.notes } : {}) };
    if (t.currency === 'AED') expense.push({ ...row, amount: cents(t.amount) / 100 });
    else if (t.currency === 'USD') expense.push({ ...row, amount: r2(Number(t.amount) * Number(t.fxRate || USD_AED)), usd: Number(t.amount) });
    else excluded.push({ sheet: 'Expense Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)` });
  }
  // Company maintenance charges completed in the period with no entry of their own (same as the company statement).
  for (const m of maintenance) {
    const d = String(m.completedAt || '').slice(0, 10);
    if (m.chargeType !== 'company' || m.status !== 'completed' || !within(d) || transactions.some(t => t.reference === `maintenance:${m.id}` && t.allocation === 'company')) continue;
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
  income.sort((a, b) => a.date.localeCompare(b.date) || (kindOrder[a.kind] - kindOrder[b.kind]) || (a.kind.startsWith('airbnb') ? listPos(a.property) - listPos(b.property) : 0) || String(a.property).localeCompare(String(b.property)));
  expense.sort((a, b) => a.date.localeCompare(b.date) || String(a.category).localeCompare(String(b.category)) || String(a.description).localeCompare(String(b.description)));
  const sum = (rows, f) => rows.reduce((n, r) => n + cents(f(r)), 0) / 100;
  const counted = income.filter(r => r.view !== 'Airbnb Property Report' && inReport(r.date));
  const monthExp = expense.filter(r => inReport(r.date));

  // Lists & Sources: deposits held for guests / tenants (liabilities) as at the month end; bank balance of the month.
  const depositsHeld = deposits.filter(d => d.kind === 'liability' && d.date && d.date <= end && !(d.settledOn && d.settledOn < reportStart))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, property: pname(d.propertyId) ?? 'Various', from: d.counterparty, amount: (d.currency || 'AED') === 'AED' ? cents(d.amount) / 100 : null, original: Number(d.amount), currency: d.currency || 'AED', status: d.settledOn && d.settledOn <= end ? (d.status === 'kept' ? 'Kept' : 'Refunded') : 'Held', notes: d.notes ?? '' }));
  for (const d of depositsHeld) if (d.amount == null) warn('deposit-currency', d.from + d.date, `Deposit from ${d.from} is in ${d.currency}: not added to the AED deposits held`);
  const bank = bankBalances.find(b => b.month === month && (b.account || cfg.bankAccount) === cfg.bankAccount) ?? null;
  if (!bank) warn('bank-balance', month, `No ${cfg.bankAccount} closing balance entered for ${month} (Dashboard J5 left empty)`);

  // Lists & Sources items table: Airbnb USD year to date, and the lease / deposit facts the rows come from.
  const ytdUsd = usdIn(ytdStart, end).reduce((n, p) => n + cents(p.amount), 0) / 100, period = `1 Jan-${dayLabel(end)}`;
  const items = [
    { item: 'Airbnb net earnings', value: ytdUsd, units: 'USD', period, source: 'Airbnb payouts (Co-Host Pro)', treatment: 'Monthly totals drive company revenue', notes: 'Converted using FX rate on Income Input' },
    { item: 'Airbnb monthly totals', value: ytdUsd, units: 'USD', period, source: 'Airbnb payouts (Co-Host Pro)', treatment: 'One monthly input row per month', notes: 'By payout date (cash basis)' },
    { item: 'Airbnb property totals', value: ytdUsd, units: 'USD', period, source: 'Airbnb payouts (Co-Host Pro)', treatment: 'Property-view rows; excluded from company total', notes: 'Prevents double counting' },
  ];
  for (const l of leases) {
    const nm = pname(l.propertyId) ?? l.name;
    items.push({ item: `${nm} annual rent`, value: Number(l.annualRent), units: l.currency || 'AED', period: `${dayLabel(l.startDate)}-${dayLabel(l.endDate)}`, source: 'Lease schedule', reference: `${(l.cheques ?? []).length} cheques`, treatment: 'Rent spread monthly in Expense Input' });
    for (const ch of [...(l.cheques ?? [])].sort((a, b) => a.seq - b.seq)) if (ch.paidOn && ch.paidOn <= end) items.push({ item: `${nm} Q${ch.seq} rent cheque`, value: Number(ch.amount), units: l.currency || 'AED', period: `Paid ${dayLabel(ch.paidOn)}`, source: 'Lease schedule', reference: ch.reference ?? null, treatment: `Booked as ${ch.months ?? 3} monthly rent rows` });
    if (cents(l.agencyFee) && l.agencyFeeDate && l.agencyFeeDate <= end) items.push({ item: `${nm} agency fee`, value: Number(l.agencyFee), units: l.currency || 'AED', period: `Paid ${dayLabel(l.agencyFeeDate)}`, source: 'Lease schedule', reference: l.agencyFeeNote ?? null, treatment: 'One-off operating expense' });
  }
  for (const d of deposits) if (d.kind === 'asset' && d.date && d.date <= end) items.push({ item: `${pname(d.propertyId) ?? d.counterparty} security deposit`, value: Number(d.amount), units: d.currency || 'AED', period: `Paid ${dayLabel(d.date)}`, source: 'Deposits register', reference: d.counterparty, treatment: d.status === 'held' ? 'Refundable Deposit (not opex)' : `Deposit ${d.status}` });

  const result = {
    month, from, monthEnd: end, usdAed: USD_AED, income, expense, excluded, warnings,
    totals: {
      income: sum(counted, r => r.gross - r.cost), incomeReceived: sum(counted.filter(r => r.status === 'Received'), r => r.gross - r.cost), incomePending: sum(counted.filter(r => r.status === 'Pending'), r => r.gross - r.cost),
      operatingExpenses: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.company), r => r.amount),
      ownerPaid: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.owner_paid), r => r.amount),
      passThrough: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.pass_through), r => r.amount),
      refundableDeposits: sum(monthExp.filter(r => r.treatment === TREATMENT_LABEL.deposit), r => r.amount),
    },
    lists: { properties: listed.map(p => ({ name: p.name, active: p.active, ...(p.external ? { external: true } : {}) })), depositsHeld, items, bank: bank ? { account: bank.account || cfg.bankAccount, balanceDate: bank.balanceDate || end, balance: Number(bank.balance), currency: bank.currency || 'AED' } : null },
    config: { summaryFirstMonth: cfg.summaryFirstMonth, summaryMonths: cfg.summaryMonths, apartmentOwnerPaidColumn: cfg.apartmentOwnerPaidColumn, checksPlaceholder: cfg.checksPlaceholder, bankAccount: cfg.bankAccount },
    today: opts.today ?? null, companyName: opts.companyName ?? null,
  };
  result.m3 = m3Values(result);
  return result;
}

/** Monthly Summary, Apartment Performance and Dashboard figures, computed exactly as the master's formulas compute
 *  them from the exported Income/Expense rows (written as the cached values of those formulas). */
export function m3Values(r) {
  const c = r.config, end = r.monthEnd;
  let first = c.summaryFirstMonth;
  if (r.month < first || r.month > addMonths(first, c.summaryMonths - 1)) first = addMonths(r.month, -(c.summaryMonths - 1));
  const months = Array.from({ length: c.summaryMonths }, (_, i) => addMonths(first, i));
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

const AED_W = 18;
/** The .xlsx, sheets in the master's order: Dashboard, Apartment Performance, Monthly Summary, Income Input,
 *  Expense Input, Lists & Sources. Formulas are the master's; cached values are computed here (Excel recalculates). */
export function workbookXlsx(result) {
  const S = STYLE, end = result.monthEnd, m3 = result.m3 ?? m3Values(result), company = result.companyName || 'Co-Host Pro';
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
  for (const it of L.items ?? []) { ls[ir++] = [it.item, { v: it.value, s: it.units === 'USD' ? S.usd : it.units === 'AED' ? S.aed : S.none }, it.units, it.period, it.source, it.reference ?? null, it.treatment ?? null, it.notes ?? null]; }
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

  // ── Dashboard ──
  const D = m3.dashboard, bank = L.bank;
  const kpi = v => ({ v, s: S.kpiAed });
  const db = {
    1: [{ v: `${company} - Finance Dashboard`, s: S.banner }],
    2: [{ v: 'Reporting period', s: S.greyLabel }, { f: "'Income Input'!B2", v: excelDate(end), s: S.greyDate }, null, { v: 'Currency', s: S.greyLabel }, { v: 'AED', s: S.greyLabel }, null, { v: 'Model status', s: S.greyLabel }, { v: result.config?.checksPlaceholder ?? '', s: S.greyLabel }, null, { v: 'Updated', s: S.greyLabel }, { v: result.today ? dayLabel(result.today) : dayLabel(end), s: S.greyLabel }],
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

  return writeXlsx([
    { name: 'Dashboard', rows: db, widths: { A: 15.1, B: 16, C: 13, D: 13, E: 13, F: 3, G: 12.5, H: 26.9, I: 20, J: 14, K: 16, L: 13 }, heights: { 1: 31.5, 2: 18.75, 4: 22.5, 5: 22.5, 6: 22.5, 7: 22.5, 8: 22.5, 9: 25.5, 10: 25.5, 17: 21.75, 18: 21.75, 19: 27.75 },
      merges: ['A1:L1', 'A4:C4', 'D4:F4', 'G4:I4', 'J4:L4', 'A5:C6', 'D5:F6', 'G5:I6', 'J5:L6', 'A8:C8', 'D8:F8', 'G8:I8', 'J8:L8', 'A9:C10', 'D9:F10', 'G9:I10', 'J9:L10', 'A18:E18', 'G18:L18'] },
    { name: 'Apartment Performance', rows: ap, widths: { A: 30.6, B: 2.5, C: 29.6, D: 20, E: AED_W, F: 21, G: 23, H: 20, I: 8.6, J: 26 }, heights: { 1: 45, 4: 27.75, [aTot]: 21.75 }, merges: ['A1:H1', 'A2:H2'] },
    { name: 'Monthly Summary', rows: ms, widths: { A: 14, B: 18, C: 24, D: 24, E: 24, F: 10, G: 22, H: 12 }, heights: { 1: 31.5, 3: 34.5, [mTot]: 21.75 }, merges: ['A1:H1'] },
    { name: 'Income Input', rows: inc, widths: { A: 14, B: 18, C: 31, D: 18, E: 48, F: 18, G: 18, H: 18, I: 17, J: 14, K: 21, L: 24, M: 21, N: 12 } },
    { name: 'Expense Input', rows: exp, widths: { A: 14, B: 20, C: 25, D: 16, E: 36, F: 18, G: 17, H: 22, I: 14 } },
    { name: 'Lists & Sources', rows: ls, widths: { A: 29, B: 16, C: 15, D: 20, E: 24, F: 18, G: 33.5, H: 40, I: 26 }, heights: { 1: 31.5, [itemsRow]: 27.75 }, merges: ['A1:H1'] },
  ]);
}
