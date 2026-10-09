// YALLA monthly workbook export, M2: Income Input and Expense Input for one month, in the master workbook's
// exact sheet names, layout and column order (YALLA_Financial_Report_with_Forecast.xlsm). Rules: see
// /workspace/finance/yalla_export_spec.md (confirmed by Raju, 9 Oct 2026).
import { earningsDate } from './company-statement.mjs';
import { leaseAccruals } from './lease-schedule.mjs';
import { writeXlsx, excelDate, STYLE } from './xlsx-writer.mjs';

export const USD_AED = 3.6725;
export const INCOME_HEADERS = ['Date', 'Category', 'Property', 'Owner / Payer', 'Description', 'Gross Income (AED)', 'Direct Cost (AED)', 'Net Income (AED)', 'Status', 'Month', 'Source', 'Data View', 'Original Airbnb (USD)', 'FX Rate'];
export const EXPENSE_HEADERS = ['Date', 'Category', 'Property', 'Paid By', 'Description', 'Amount (AED)', 'Payment Status', 'Accounting Treatment', 'Month'];
export const TREATMENT_LABEL = { company: 'Operating Expense', owner_paid: 'Owner Paid (excluded)', pass_through: 'Pass-through (excluded)', deposit: 'Refundable Deposit' };
/** Master expense categories (Lists & Sources E4:E21). Anything else is mapped below or kept as entered. */
export const MASTER_EXPENSE_CATEGORIES = ['Salary', 'Rent', 'Security Deposit', 'Agent Commission', 'Cleaning', 'DEWA Deposit', 'Cooling Deposit', 'Fuel', 'Noon', 'Car', 'Cleaner', 'Marketing', 'Photography', 'Software', 'DTCM', 'Supplies', 'DEWA', 'Refund'];
const CATEGORY_MAP = { utilities: 'Supplies', utility: 'Supplies', maintenance: 'Supplies', 'agent commission': 'Agent Commission', photos: 'Photography', transport: 'Car' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const cents = v => Math.round(Number(v || 0) * 100);
const r2 = n => Math.round(n * 100) / 100;
export const effectiveTreatment = t => t.treatment || (t.allocation === 'owner' ? 'owner_paid' : 'company');
export const monthEnd = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const monthLabel = iso => `${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function mapExpenseCategory(t, treatment) {
  const raw = String(t.category || '').trim();
  if (treatment === 'pass_through' && /dewa/i.test(`${raw} ${t.description || ''}`)) return 'DEWA';
  const exact = MASTER_EXPENSE_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  return exact ?? CATEGORY_MAP[raw.toLowerCase()] ?? raw ?? 'Other';
}

/** Payout date of an Airbnb payout: its own date, else the date on its earnings lines, else the export year. */
function payoutDate(p, lines, year) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.sourceDate || '')) return p.sourceDate;
  for (const e of lines) { const d = earningsDate({ sourceDate: p.sourceDate, checkIn: e.checkIn }); if (d) return d; }
  return earningsDate({ sourceDate: p.sourceDate, checkIn: `${year}-01-01` });
}

/**
 * @param data { properties, owners, transactions, bookings (managementAmount resolved), earnings, payouts, statements, leases (with cheques), deposits, maintenance }
 * @param month YYYY-MM
 */
export function buildWorkbookRows(data, month) {
  const { properties = [], owners = [], transactions = [], bookings = [], earnings = [], payouts = [], statements = [], leases = [], deposits = [], maintenance = [] } = data;
  const start = `${month}-01`, end = monthEnd(month), year = Number(month.slice(0, 4));
  const within = d => !!d && d >= start && d <= end;
  const prop = id => properties.find(p => p.id === id);
  const pname = id => { const p = prop(id); return p ? (p.reportName || p.name) : null; };
  const ownerName = id => owners.find(o => o.id === prop(id)?.ownerId)?.name ?? null;
  const income = [], expense = [], excluded = [];

  // 1+2. Airbnb payouts by payout date (cash basis): the month's USD total counts; per-property rows are view-only.
  const linesOf = p => earnings.filter(e => e.payoutId === p.id);
  const monthPayouts = payouts.map(p => ({ ...p, lines: linesOf(p) })).map(p => ({ ...p, date: payoutDate(p, p.lines, year) })).filter(p => within(p.date));
  for (const p of monthPayouts.filter(p => p.currency !== 'USD')) excluded.push({ sheet: 'Income Input', date: p.date, description: `Airbnb payout ${p.id}`, currency: p.currency, amount: Number(p.amount), reason: 'Only USD Airbnb payouts are converted (fixed 3.6725); other currencies stay separate' });
  const usd = monthPayouts.filter(p => p.currency === 'USD');
  if (usd.length) {
    const total = usd.reduce((n, p) => n + cents(p.amount), 0) / 100;
    income.push({ kind: 'airbnb-monthly', date: end, category: 'Airbnb', property: 'Various', payer: 'Airbnb', description: `Exact Airbnb monthly net - ${month}`, usd: total, fx: USD_AED, gross: r2(total * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Monthly Report', payouts: usd.length });
    const byProp = new Map(); const add = (k, c) => byProp.set(k, (byProp.get(k) ?? 0) + c);
    for (const p of usd) {
      const total = cents(p.amount), lines = p.lines;
      if (!lines.length) { add('unallocated', total); continue; }
      const aed = new Map(), other = new Map();
      for (const e of lines) (e.currency === 'AED' ? aed : other).set(e.propertyId, ((e.currency === 'AED' ? aed : other).get(e.propertyId) ?? 0) + cents(e.amount));
      let used = 0;
      for (const [pid, c] of aed) { const u = other.size ? Math.round(c / USD_AED) : 0; if (other.size) { add(pid, u); used += u; } }
      if (!other.size) { // all AED: split the USD by the AED amounts
        const sum = [...aed.values()].reduce((a, b) => a + b, 0); let left = total; const ids = [...aed.keys()];
        ids.forEach((pid, i) => { const u = i === ids.length - 1 ? left : Math.round(total * aed.get(pid) / sum); add(pid, u); left -= u; });
      } else {
        const rest = total - used, sum = [...other.values()].reduce((a, b) => a + b, 0); let left = rest; const ids = [...other.keys()];
        ids.forEach((pid, i) => { const u = i === ids.length - 1 ? left : Math.round(rest * other.get(pid) / sum); add(pid, u); left -= u; });
      }
    }
    for (const [pid, c] of [...byProp].sort((a, b) => String(pname(a[0]) ?? a[0]).localeCompare(String(pname(b[0]) ?? b[0])))) {
      const u = c / 100;
      income.push({ kind: 'airbnb-property', date: end, category: 'Airbnb', property: pid === 'unallocated' ? 'Various' : pname(pid), payer: 'Airbnb', description: `${MONTHS[Number(month.slice(5)) - 1]} ${year} property allocation - excluded from dashboard total`, usd: u, fx: USD_AED, gross: r2(u * USD_AED), cost: 0, status: 'Received', source: 'Airbnb payouts (Co-Host Pro)', view: 'Airbnb Property Report' });
    }
  }

  // 3. Management fees from bookings in the owner-statement (checkout) month, for owned properties; bookings
  //    paid through the Airbnb USD payouts are already in the monthly total.
  const payoutCodes = new Set(earnings.filter(e => e.payoutId && payouts.some(p => p.id === e.payoutId)).map(e => `airbnb:${e.confirmationCode}`));
  for (const b of bookings) {
    if (b.financeMode !== 'inclusive-v1' || ['cancelled', 'blocked'].includes(b.status) || !within(b.checkOut) || payoutCodes.has(b.externalId)) continue;
    const p = prop(b.propertyId); if (!p?.ownerId) continue;
    const fee = cents(b.managementAmount); if (!fee) continue;
    const cur = b.currency || p.currency || 'AED';
    const st = statements.find(s => s.propertyId === b.propertyId && s.month === month);
    const row = { kind: 'management-fee', date: end, category: 'Management Fee', property: pname(b.propertyId), payer: ownerName(b.propertyId), description: `${Number(b.managementPercent || 0)}% management fee, ${pname(b.propertyId)}, ${MONTHS[Number(month.slice(5)) - 1]} ${year} owner statement`, gross: fee / 100, cost: 0, status: st?.status === 'paid' || b.paymentStatus === 'paid' ? 'Received' : 'Pending', source: 'Owner statement', view: 'Transaction', bookingId: b.id };
    if (cur === 'AED') income.push(row); else excluded.push({ sheet: 'Income Input', date: end, description: row.description, currency: cur, amount: fee / 100, reason: `${cur} stays separate from AED (no conversion)` });
  }

  // 4. Manual company income.
  for (const t of transactions) {
    if (t.type !== 'income' || t.allocation !== 'company' || !within(t.date)) continue;
    const base = { kind: 'manual-income', date: t.date, category: t.category, property: pname(t.propertyId) ?? 'Various', payer: ownerName(t.propertyId) ?? '', description: t.description, cost: 0, status: t.paymentStatus && t.paymentStatus !== 'paid' ? 'Pending' : 'Received', source: t.reference ? `Co-Host Pro entry ${t.reference}` : 'Co-Host Pro entry', view: 'Transaction', transactionId: t.id };
    if (t.currency === 'AED') income.push({ ...base, gross: cents(t.amount) / 100 });
    else if (t.currency === 'USD') { const fx = Number(t.fxRate || USD_AED); income.push({ ...base, usd: cents(t.amount) / 100, fx, gross: r2(Number(t.amount) * fx) }); }
    else excluded.push({ sheet: 'Income Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)` });
  }

  // 5. Deposits kept against damage: the kept part is income (damage recovery) in the month it was kept.
  for (const d of deposits) {
    if (d.status !== 'kept' || !within(d.settledOn) || !cents(d.keptAmount)) continue;
    if (d.kind === 'liability') income.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Damage recovery', property: pname(d.propertyId) ?? 'Various', payer: d.counterparty, description: `Deposit kept against damage${d.keptReason ? `: ${d.keptReason}` : ''}`, gross: cents(d.keptAmount) / 100, cost: 0, status: 'Received', source: 'Deposits register', view: 'Transaction', depositId: d.id });
    else expense.push({ kind: 'deposit-kept', date: d.settledOn, category: 'Security Deposit', property: pname(d.propertyId) ?? 'Company', paidBy: 'Company', description: `Deposit kept by ${d.counterparty}${d.keptReason ? `: ${d.keptReason}` : ''}`, amount: cents(d.keptAmount) / 100, paymentStatus: 'Paid', treatment: 'Operating Expense', depositId: d.id });
  }

  // Expenses 1: manual entries (and automatic cleaning costs), every treatment, flagged.
  for (const t of transactions) {
    if (t.type !== 'expense' || !within(t.date)) continue;
    const tr = effectiveTreatment(t);
    const row = { kind: 'entry', date: t.date, category: mapExpenseCategory(t, tr), property: pname(t.propertyId) ?? 'Company', paidBy: tr === 'owner_paid' ? `Owner (${ownerName(t.propertyId) ?? 'unknown'})` : 'Company', description: t.description, paymentStatus: t.paymentStatus === 'pending' ? 'Pending' : t.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid', treatment: TREATMENT_LABEL[tr], transactionId: t.id, enteredCategory: t.category };
    if (t.currency === 'AED') expense.push({ ...row, amount: cents(t.amount) / 100 });
    else if (t.currency === 'USD') expense.push({ ...row, amount: r2(Number(t.amount) * Number(t.fxRate || USD_AED)), usd: Number(t.amount) });
    else excluded.push({ sheet: 'Expense Input', date: t.date, description: t.description, currency: t.currency, amount: Number(t.amount), reason: `${t.currency} stays separate from AED (no conversion)` });
  }
  // Company maintenance charges completed in the month with no entry of their own (same as the company statement).
  for (const m of maintenance) {
    const d = String(m.completedAt || '').slice(0, 10);
    if (m.chargeType !== 'company' || m.status !== 'completed' || !within(d) || transactions.some(t => t.reference === `maintenance:${m.id}` && t.allocation === 'company')) continue;
    const cur = prop(m.propertyId)?.currency || 'AED';
    if (cur !== 'AED') { excluded.push({ sheet: 'Expense Input', date: d, description: m.issue, currency: cur, amount: Number(m.cost), reason: `${cur} stays separate from AED (no conversion)` }); continue; }
    expense.push({ kind: 'maintenance', date: d, category: 'Supplies', property: pname(m.propertyId) ?? 'Company', paidBy: 'Company', description: m.issue, amount: cents(m.cost) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.company, maintenanceId: m.id });
  }

  // Expenses 2-4: lease accruals, agency fee, asset deposits paid.
  for (const l of leases) {
    for (const a of leaseAccruals(l, l.cheques ?? [])) if (within(a.date)) expense.push({ kind: 'lease-rent', date: a.date, category: 'Rent', property: pname(l.propertyId) ?? 'Company', paidBy: 'Company', description: a.description, amount: a.amount, paymentStatus: a.chequePaidOn && a.chequePaidOn <= end ? 'Paid' : 'Pending', treatment: TREATMENT_LABEL.company, leaseId: l.id });
    if (cents(l.agencyFee) && within(l.agencyFeeDate)) expense.push({ kind: 'lease-agency', date: l.agencyFeeDate, category: 'Agent Commission', property: pname(l.propertyId) ?? 'Company', paidBy: 'Company', description: l.agencyFeeNote || 'Agency fee (one-off)', amount: cents(l.agencyFee) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.company, leaseId: l.id });
  }
  for (const d of deposits) if (d.kind === 'asset' && within(d.date)) {
    if ((d.currency || 'AED') !== 'AED') { excluded.push({ sheet: 'Expense Input', date: d.date, description: `Deposit ${d.counterparty}`, currency: d.currency, amount: Number(d.amount), reason: `${d.currency} stays separate from AED (no conversion)` }); continue; }
    expense.push({ kind: 'deposit-paid', date: d.date, category: 'Security Deposit', property: pname(d.propertyId) ?? 'Company', paidBy: 'Company', description: d.notes || `Security deposit paid to ${d.counterparty} - refundable`, amount: cents(d.amount) / 100, paymentStatus: 'Paid', treatment: TREATMENT_LABEL.deposit, depositId: d.id });
  }

  const order = { 'airbnb-monthly': 0, 'management-fee': 1, 'manual-income': 1, 'deposit-kept': 1, 'airbnb-property': 2 };
  income.sort((a, b) => a.date.localeCompare(b.date) || (order[a.kind] - order[b.kind]) || String(a.property).localeCompare(String(b.property)));
  expense.sort((a, b) => a.date.localeCompare(b.date) || String(a.category).localeCompare(String(b.category)) || String(a.description).localeCompare(String(b.description)));
  const sum = (rows, f) => rows.reduce((n, r) => n + cents(f(r)), 0) / 100;
  const counted = income.filter(r => r.view !== 'Airbnb Property Report');
  return {
    month, monthEnd: end, usdAed: USD_AED, income, expense, excluded,
    totals: {
      income: sum(counted, r => r.gross - r.cost), incomeReceived: sum(counted.filter(r => r.status === 'Received'), r => r.gross - r.cost), incomePending: sum(counted.filter(r => r.status === 'Pending'), r => r.gross - r.cost),
      operatingExpenses: sum(expense.filter(r => r.treatment === TREATMENT_LABEL.company), r => r.amount),
      ownerPaid: sum(expense.filter(r => r.treatment === TREATMENT_LABEL.owner_paid), r => r.amount),
      passThrough: sum(expense.filter(r => r.treatment === TREATMENT_LABEL.pass_through), r => r.amount),
      refundableDeposits: sum(expense.filter(r => r.treatment === TREATMENT_LABEL.deposit), r => r.amount),
    },
  };
}

/** The .xlsx: sheets "Income Input" and "Expense Input", laid out exactly like the master. */
export function workbookXlsx(result) {
  const S = STYLE, end = result.monthEnd;
  const inc = {
    1: [{ v: 'Income Input - Month-by-Month (edit yellow cells only)', s: S.title }],
    2: ['Reporting month end', { v: excelDate(end), s: S.date }, 'USD to AED rate', { v: result.usdAed, s: S.rate }],
    3: ['Instructions', 'Add new income below. Use Data View carefully; Property Report rows are excluded from total revenue.', null, null, null, null, 'Received Net Income', { f: 'SUMIF(I7:I507,"Received",H7:H507)', v: 0, s: S.aed }],
    4: [null, null, null, null, null, null, 'Pending Net Income', { f: 'SUMIF(I7:I507,"Pending",H7:H507)', v: 0, s: S.aed }],
    6: INCOME_HEADERS.map(v => ({ v, s: S.header })),
  };
  let rec = 0, pen = 0;
  result.income.forEach((r, i) => {
    const n = 7 + i, net = r2(r.gross - r.cost);
    if (r.status === 'Received') rec += cents(net); if (r.status === 'Pending') pen += cents(net);
    const isUsd = r.usd != null;
    inc[n] = [{ v: excelDate(r.date), s: S.date }, r.category, r.property, r.payer, r.description,
      isUsd ? { f: `M${n}*N${n}`, v: r.gross, s: S.aed } : { v: r.gross, s: S.aed }, { v: r.cost, s: S.aed }, { f: `F${n}-G${n}`, v: net, s: S.aed }, r.status,
      { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: monthLabel(r.date) }, r.source, r.view,
      isUsd ? { v: r.usd, s: S.usd } : null, isUsd ? { f: '$D$2', v: r.fx, s: S.rate } : null];
  });
  inc[3][7].v = rec / 100; inc[4][7].v = pen / 100;
  const exp = {
    1: [{ v: 'Expense Input - Month-by-Month (edit yellow cells only)', s: S.title }],
    2: ["Add outgoing costs below. Treatment: Operating Expense (company P&L), Refundable Deposit (returned later), Owner Paid (excluded) for costs paid from an owner's money, Pass-through (excluded) for items that net to zero."],
    4: EXPENSE_HEADERS.map(v => ({ v, s: S.header })),
  };
  result.expense.forEach((r, i) => {
    const n = 5 + i;
    exp[n] = [{ v: excelDate(r.date), s: S.date }, r.category, r.property, r.paidBy, r.description, { v: r.amount, s: S.aed }, r.paymentStatus, r.treatment, { f: `IF(A${n}="","",TEXT(A${n},"mmm yyyy"))`, v: monthLabel(r.date) }];
  });
  return writeXlsx([
    { name: 'Income Input', rows: inc, widths: { A: 14, B: 18, C: 31, D: 18, E: 48, F: 18, G: 18, H: 18, I: 17, J: 14, K: 21, L: 24, M: 21, N: 12 } },
    { name: 'Expense Input', rows: exp, widths: { A: 14, B: 20, C: 25, D: 16, E: 36, F: 18, G: 17, H: 22, I: 14 } },
  ]);
}
