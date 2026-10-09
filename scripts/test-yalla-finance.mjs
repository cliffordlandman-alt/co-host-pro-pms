// YALLA workbook M1 + M2 + M3: lease accruals (9,583.33/9,583.33/9,583.34 per quarterly cheque, dated the 8th), the
// deposits register (asset/liability, held/refunded/kept), expense treatment (company/owner paid/pass-through),
// Salary, FX (USD fixed 3.6725, ZAR kept separate), monthly bank balance, and the Income/Expense Input .xlsx export
// with the master's sheet names and column order. Pass-through entries stay out of the company statement.
// M3: Monthly Summary, Apartment Performance (owner paid flagged), Dashboard (bank balance J5) and Lists & Sources with
// the master's formulas and cached values; Raju's answers (9 Oct) as settings in lib/yalla-config.mjs. M4: Checks
// sheet; round 2: Show in report flag, latest bank balance, off-list categories excluded, remainder on the largest row.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { leaseAccruals, equalCheques } from '../lib/lease-schedule.mjs';
import { buildWorkbookRows, companyMonthSummary, workbookXlsx, INCOME_HEADERS, EXPENSE_HEADERS, mapExpenseCategory, mapIncomeCategory } from '../lib/yalla-workbook.mjs';
import { WORKBOOK_DEFAULTS } from '../lib/yalla-config.mjs';
import { loadTemplate } from '../lib/xlsx-template.mjs';
import { TEMPLATE_GZ_B64 } from '../lib/yalla-master-template.mjs';
import { companyStatement } from '../lib/company-statement.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Read the parts of a zip (our writer deflates every part).
function unzip(buf) {
  const out = {}; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString(), data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString(); i += 30 + nlen + xlen + size;
  }
  return out;
}

// ── Pure ──
const lease = { startDate: '2026-08-08', endDate: '2027-08-07', annualRent: 115000 };
const cheques = equalCheques(lease, 4, '2026-07-29'); cheques[0].paidOn = '2026-07-29';
assert.deepEqual(cheques.map(c => [c.dueDate, c.amount]), [['2026-07-29', 28750], ['2026-11-08', 28750], ['2027-02-08', 28750], ['2027-05-08', 28750]]);
const acc = leaseAccruals(lease, cheques);
assert.equal(acc.length, 12);
assert.deepEqual(acc.slice(0, 3).map(a => [a.date, a.amount]), [['2026-08-08', 9583.33], ['2026-09-08', 9583.33], ['2026-10-08', 9583.34]]);
assert.equal(acc[1].description, 'Rent 8 Sep-7 Oct (1/3 of Q1 cheque 28,750 paid 29 Jul)', 'same wording as the master');
assert.equal(Math.round(acc.reduce((n, a) => n + a.amount * 100, 0)), 11500000, 'accruals add up to the annual rent');
assert.equal(mapExpenseCategory({ category: 'Utilities', description: 'DEWA 2106' }, 'pass_through'), 'DEWA');
assert.equal(mapExpenseCategory({ category: 'Utilities', description: 'du bill' }, 'company'), 'Supplies');
assert.equal(mapExpenseCategory({ category: 'Cleaning' }, 'company'), 'Cleaning');
const cs = companyStatement({ transactions: [{ id: 1, allocation: 'company', type: 'expense', date: '2026-09-05', currency: 'AED', amount: '60', treatment: 'pass_through' }, { id: 2, allocation: 'company', type: 'expense', date: '2026-09-05', currency: 'AED', amount: '10' }] }, '2026-09-01', '2026-09-30');
assert.deepEqual(cs.totals, [{ currency: 'AED', income: 0, expenses: 10, net: -10 }], 'pass-through stays out of the company statement');
// Airbnb payouts: the USD monthly total counts; property rows split AED lines at the peg, the rest to the ZAR property.
const pure = buildWorkbookRows({
  properties: [{ id: 1, name: 'Garden', currency: 'AED' }, { id: 2, name: 'Grey', reportName: '2 Bedroom Mount Pleasant', currency: 'ZAR' }],
  payouts: [{ id: 'P1', currency: 'USD', amount: '84.00', sourceDate: '4 September' }, { id: 'P2', currency: 'USD', amount: '10.00', sourceDate: '4 August' }],
  earnings: [{ payoutId: 'P1', propertyId: 2, currency: 'ZAR', amount: '-1942.83', checkIn: '2026-09-01' }, { payoutId: 'P1', propertyId: 2, currency: 'ZAR', amount: '2285.69', checkIn: '2026-09-01' }, { payoutId: 'P1', propertyId: 1, currency: 'AED', amount: '229.74', checkIn: '2026-09-01' }],
}, '2026-09', { propertyReportYtdRows: false, propertyReportZeroRows: 'none', inputFrom: 'month', inputThrough: 'month_end' });
assert.deepEqual(pure.income.map(r => [r.view, r.property, r.usd]), [['Airbnb Monthly Report', 'Various', 84], ['Airbnb Property Report', '2 Bedroom Mount Pleasant', 21.44], ['Airbnb Property Report', 'Garden', 62.56]]);
assert.equal(pure.totals.income, 308.49, 'only the monthly total counts (84 × 3.6725)');
console.log('OK pure: lease accruals, category map, pass-through, Airbnb monthly vs property rows');

// ── Pure M3 + Raju's answers (each a setting) ──
{
  assert.equal(mapExpenseCategory({ category: 'Cleaning', reportCategory: 'Cleaner' }, 'company'), 'Cleaner', 'Q4: the row\'s workbook category wins');
  assert.equal(mapExpenseCategory({ category: 'Transport' }, 'company'), 'Car');
  assert.equal(mapIncomeCategory({ category: 'Booking', reportCategory: 'Airbnb' }), 'Airbnb');
  const props = [{ id: 1, name: 'L', reportName: 'Lofts West 603', ownerId: 7, currency: 'AED' }, { id: 2, name: 'S', reportName: 'Sunrise Bay 2106', currency: 'AED' }, { id: 3, name: 'Serenity', currency: 'AED' }, { id: 4, name: 'P', reportName: 'Sunrise Bay 1406', currency: 'AED', status: 'planned' }, { id: 5, name: 'Villa 7', reportName: 'Villa 7', ownerId: 8, currency: 'AED', showInReport: false }];
  const base = {
    properties: props, owners: [{ id: 7, name: 'Prajyoth' }],
    payouts: [{ id: 'A', currency: 'USD', amount: '100.00', sourceDate: '2026-08-10' }, { id: 'B', currency: 'USD', amount: '50.00', sourceDate: '2026-09-10' }, { id: 'C', currency: 'USD', amount: '5.00', sourceDate: '3 September' }],
    earnings: [{ payoutId: 'A', propertyId: 2, currency: 'AED', amount: '367.25' }, { payoutId: 'B', propertyId: 2, currency: 'AED', amount: '183.63' }, { payoutId: 'C', propertyId: 2, currency: 'AED', amount: '18.36', checkIn: '2026-09-01' }, { payoutId: 'C', propertyId: 2, currency: 'AED', amount: '0.01', checkIn: '2025-09-01' }],
    bookings: [{ id: 50, propertyId: 1, financeMode: 'inclusive-v1', status: 'checked_out', checkIn: '2026-09-27', checkOut: '2026-09-30', managementAmount: '1400', managementPercent: 10, paymentStatus: 'unknown', cleaningFee: '200' }],
    statements: [{ id: 9, propertyId: 1, month: '2026-09', status: 'draft' }],
    transactions: [
      { id: 1, type: 'income', allocation: 'company', date: '2026-09-01', amount: '2250', directCost: '100', payer: 'direct', propertyId: 1, category: 'Booking', reportCategory: 'Airbnb', description: 'Direct booking', currency: 'AED' },
      { id: 2, type: 'expense', allocation: 'company', treatment: 'company', date: '2026-09-09', amount: '4774', category: 'Salary', description: 'Salary 1', currency: 'AED' },
      { id: 3, type: 'expense', allocation: 'owner', date: '2026-09-22', amount: '200', propertyId: 1, category: 'Cleaning', description: 'Owner clean', currency: 'AED' },
      { id: 4, type: 'expense', allocation: 'company', date: '2026-09-17', amount: '260', propertyId: 2, category: 'Utilities', description: 'Chiller', currency: 'AED' },
      { id: 5, type: 'expense', allocation: 'company', date: '2026-09-30', amount: '10', category: 'Insurance', description: 'Policy', currency: 'AED' },
      { id: 6, type: 'expense', allocation: 'company', date: '2026-08-31', amount: '12192', category: 'Salary', description: 'Salary Aug', currency: 'AED' },
    ],
    deposits: [{ id: 1, kind: 'liability', propertyId: 1, counterparty: 'Tonye', amount: '1000', currency: 'AED', date: '2026-09-06', status: 'held' }, { id: 2, kind: 'asset', propertyId: 2, counterparty: 'Landlord', amount: '11500', currency: 'AED', date: '2026-07-29', status: 'kept', settledOn: '2026-09-15', keptAmount: '500', keptReason: 'paint' }],
    bankBalances: [{ account: 'ADIB 19589605', month: '2026-09', balanceDate: '2026-09-30', balance: '7259.22', currency: 'AED' }],
  };
  const r = buildWorkbookRows(base, '2026-09', {}, { today: '2026-10-09', companyName: 'Co-Host Pro' });
  const codes = r.warnings.map(w => w.code);
  // Q8: a cumulative row per active property dated the 1st (through 1 Sep) and the month's rows, zero rows for every
  // active property with "Show in report" on; Villa 7 (show off) is listed but gets no zero Airbnb rows.
  const ytd = r.income.filter(x => x.kind === 'airbnb-ytd'), mon = r.income.filter(x => x.kind === 'airbnb-property');
  assert.deepEqual(ytd.map(x => [x.date, x.property, x.usd]), [['2026-09-01', 'Lofts West 603', 0], ['2026-09-01', 'Sunrise Bay 2106', 100], ['2026-09-01', 'Sunrise Bay 1406', 0]], 'the Airbnb report order (airbnbPropertyOrder), others after');
  assert.equal(ytd[0].description, 'Property allocation through 1 Sep 2026 - excluded from dashboard total');
  assert.deepEqual(mon.map(x => [x.property, x.usd]), [['Lofts West 603', 0], ['Sunrise Bay 2106', 55], ['Sunrise Bay 1406', 0]]);
  assert.deepEqual(r.lists.properties.map(p => p.name), ['Sunrise Bay 2106', 'Lofts West 603', 'Villa 7', 'Sunrise Bay 1406'], 'master order');
  const none = buildWorkbookRows(base, '2026-09', { propertyReportZeroRows: 'none', propertyReportYtdRows: false });
  assert.deepEqual(none.income.filter(x => x.view === 'Airbnb Property Report').map(x => x.property), ['Sunrise Bay 2106']);
  // Q11: payout C ("3 September") has bookings checking in on 1 Sep 2025 and 1 Sep 2026: both years fit, flagged.
  assert.ok(r.warnings.some(w => w.code === 'payout-year' && w.payoutId === 'C'));
  assert.ok(!buildWorkbookRows(base, '2026-09', { flagAmbiguousPayoutYear: false }).warnings.some(w => w.code === 'payout-year'));
  // Q5: Pending until the fee is received (fee_received_on, an owner payout, a paid statement or a paid booking).
  const fee = x => x.income.find(y => y.kind === 'management-fee').status;
  assert.equal(fee(r), 'Pending');
  assert.equal(fee(buildWorkbookRows({ ...base, bookings: [{ ...base.bookings[0], feeReceivedOn: '2026-09-18' }] }, '2026-09')), 'Received');
  assert.equal(fee(buildWorkbookRows({ ...base, ownerPayouts: [{ statementId: 9, paidOn: '2026-09-18' }] }, '2026-09')), 'Received', 'netted from a paid payout');
  assert.equal(fee(buildWorkbookRows({ ...base, ownerPayouts: [{ statementId: 9, paidOn: '2026-09-18' }] }, '2026-09', { managementFeeReceivedWhen: ['statement_paid'] })), 'Pending');
  // Q6: booking cleaning fees stay out unless switched on.
  assert.ok(!r.income.some(x => x.kind === 'booking-cleaning'));
  assert.equal(buildWorkbookRows(base, '2026-09', { bookingCleaningIncome: true }).income.find(x => x.kind === 'booking-cleaning').gross, 200);
  // Q7: an asset deposit the landlord keeps is an expense row (Operating Expense by default).
  assert.equal(r.expense.find(x => x.kind === 'deposit-kept').treatment, 'Operating Expense');
  assert.equal(buildWorkbookRows(base, '2026-09', { keptAssetDepositTreatment: 'Refundable Deposit' }).expense.find(x => x.kind === 'deposit-kept').treatment, 'Refundable Deposit');
  // Q9: salary check (15,000, August override 12,192).
  assert.ok(r.warnings.some(w => w.code === 'salary' && w.month === '2026-09' && w.expected === 15000 && w.entered === 4774));
  assert.ok(!buildWorkbookRows(base, '2026-09', {}, { from: '2026-08' }).warnings.some(w => w.code === 'salary' && w.month === '2026-08'), 'August matches its 12,192 override');
  assert.ok(buildWorkbookRows(base, '2026-09', { salaryOverrides: { '2026-08': 15000 } }, { from: '2026-08' }).warnings.some(w => w.code === 'salary' && w.month === '2026-08'));
  // Q10: Serenity has no workbook name: flagged, not listed. Q4: Insurance has no master category: flagged.
  assert.ok(codes.includes('unmapped-property') && !r.lists.properties.some(p => p.name === 'Serenity'));
  // Round 2: a category with no master equivalent stays out of the export, warned with its amount.
  assert.ok(r.warnings.some(w => w.code === 'category' && w.category === 'Insurance' && w.amount === '10'));
  assert.ok(r.excluded.some(x => x.description === 'Policy' && /no master equivalent/.test(x.reason)) && !r.expense.some(x => x.description === 'Policy'));
  assert.ok(buildWorkbookRows(base, '2026-09', { unmappedCategoryRows: 'keep' }).expense.some(x => x.description === 'Policy'));
  assert.ok(!buildWorkbookRows({ ...base, transactions: [...base.transactions, { id: 9, type: 'expense', allocation: 'company', date: '2026-09-30', amount: '0', category: 'Gifts', description: 'zero', currency: 'AED' }] }, '2026-09').warnings.some(w => w.category === 'Gifts'), 'no warning without a value');
  // Direct cost and payer on Income Input.
  assert.deepEqual((({ category, payer, gross, cost }) => [category, payer, gross, cost])(r.income.find(x => x.kind === 'manual-income')), ['Airbnb', 'direct', 2250, 100]);
  // M3 values (as the master's formulas compute them).
  const m = r.m3, sep = m.summary.find(x => x.month === '2026-09');
  assert.deepEqual(m.months[0], '2026-04'); assert.equal(m.months.length, 9);
  const usd55 = 55 * 3.6725;
  assert.ok(Math.abs(sep.income - (usd55 + 2150 + 1400)) < 1e-6, 'B: Income Input net (Pending counts too), property rows excluded');
  assert.equal(sep.opex, 4774 + 260 + 500); assert.equal(sep.deposits, 0); assert.equal(sep.status, 'Loss');
  const lofts = m.apartments.find(a => a.property === 'Lofts West 603');
  assert.deepEqual([lofts.gross, lofts.directCosts, lofts.allocated, lofts.ownerPaid], [3650, 100, 0, 200], 'owner paid is flagged in its own column, outside the net');
  assert.deepEqual(m.apartments.map(a => a.rank).sort(), [1, 2, 3, 4]);
  assert.equal(m.apartments.find(a => a.property === 'Villa 7').rank, 2, 'zero ties broken by list order (Villa 7 before Sunrise Bay 1406)');
  assert.deepEqual([m.dashboard.propertiesManaged, m.dashboard.depositsHeld, m.dashboard.bankBalance], [4, 1000, 7259.22]);
  // Round 2: "Show in report" off = no zero rows (1406 off here); on = zero rows.
  const off1406 = buildWorkbookRows({ ...base, properties: props.map(p => (p.id === 4 ? { ...p, showInReport: false } : p)) }, '2026-09');
  assert.deepEqual(off1406.income.filter(x => x.kind === 'airbnb-property').map(x => x.property), ['Lofts West 603', 'Sunrise Bay 2106']);
  // Round 2: J5 = the latest dated balance up to the export's last day; month ends stay as history.
  const withLatest = { ...base, bankBalances: [...base.bankBalances, { account: 'ADIB 19589605', kind: 'latest', month: '2026-10', balanceDate: '2026-10-09', balance: '11126.24', currency: 'AED' }] };
  const rl = buildWorkbookRows(withLatest, '2026-09', {}, { today: '2026-10-09' });
  assert.deepEqual([rl.lists.bank.balance, rl.lists.bank.balanceDate, rl.lists.bankHistory.map(b => b.balance)], [11126.24, '2026-10-09', [7259.22]]);
  assert.ok(unzip(workbookXlsx(rl))['xl/worksheets/sheet1.xml'].includes('BANK BALANCE - ADIB - 9 OCT 2026'));
  assert.equal(buildWorkbookRows(withLatest, '2026-09', {}, { today: '2026-10-09', through: '2026-09-30' }).lists.bank.balance, 7259.22, 'a month-end export shows the month end');
  assert.equal(buildWorkbookRows(withLatest, '2026-09', { bankBalanceShows: 'month_end' }, { today: '2026-10-09' }).lists.bank.balance, 7259.22);
  // Input range: from the summary's first month to today; entered rows after the month end come in (e.g. October
  // rent, as the master), generated rows (Airbnb payouts) stop at the month end.
  assert.deepEqual([r.from, r.through], ['2026-04', '2026-10-09']);
  const oct = { ...base, transactions: [...base.transactions, { id: 10, type: 'income', allocation: 'company', date: '2026-10-06', amount: '7000', category: 'Commission', description: 'Oct commission', currency: 'AED', paymentStatus: 'pending' }], payouts: [...base.payouts, { id: 'D', currency: 'USD', amount: '9.00', sourceDate: '2026-10-02' }] };
  const ro = buildWorkbookRows(oct, '2026-09', {}, { today: '2026-10-09' });
  assert.ok(ro.income.some(x => x.description === 'Oct commission') && !ro.income.some(x => x.date > '2026-09-30' && x.kind.startsWith('airbnb')));
  assert.equal(ro.m3.summary.find(x => x.month === '2026-10').income, 7000);
  { // A pending commission dated after today (10 Oct, exported 9 Oct) is listed and is the one-off; a paid one is not; an explicit through stays strict.
    const tx = (id, paymentStatus) => ({ id, type: 'income', allocation: 'company', date: '2026-10-10', amount: '6750', category: 'Commission', description: `ahead ${id}`, currency: 'AED', payer: 'TBC', paymentStatus });
    const fa = { ...base, transactions: [...base.transactions, tx(11, 'pending'), tx(12, 'paid')] };
    const ra = buildWorkbookRows(fa, '2026-09', {}, { today: '2026-10-09' });
    assert.ok(ra.income.some(x => x.description === 'ahead 11' && x.payer === 'TBC' && x.status === 'Pending') && !ra.income.some(x => x.description === 'ahead 12'));
    assert.equal(ra.forecast.inputs.oneOff.amount, 6750);
    // Workbook property / source / forecast label as the master's row 51 and Forecast A18; default source is blank.
    const fl = { ...fa, transactions: fa.transactions.map(t => (t.id === 11 ? { ...t, reportProperty: 'Company', reportSource: 'Clifford', forecastLabel: '3% commission (AED 225,000 deal)' } : t)) };
    const rl = buildWorkbookRows(fl, '2026-09', {}, { today: '2026-10-09' }), row = rl.income.find(x => x.description === 'ahead 11');
    assert.deepEqual([row.property, row.source], ['Company', 'Clifford']); assert.equal(ra.income.find(x => x.description === 'ahead 11').source, '');
    assert.equal(rl.forecast.inputs.oneOff.items[0].label, '3% commission (AED 225,000 deal)');
    assert.ok(unzip(workbookXlsx(rl))['xl/worksheets/sheet10.xml'].includes('One-off income - 3% commission (AED 225,000 deal)'));
    assert.deepEqual(rl.lists.items.slice(0, 3).map(i => [i.source, i.reference]), [['Airbnb report', 'Page 1'], ['Airbnb report', 'Page 2'], ['Airbnb report', 'Page 1']]);
    assert.ok(rl.income.filter(x => x.kind === 'airbnb-monthly').every(x => x.source === 'Airbnb report p.2') && rl.income.filter(x => x.view === 'Airbnb Property Report').every(x => x.source === 'Airbnb report p.1'));
    assert.ok(!buildWorkbookRows(fa, '2026-09', {}, { today: '2026-10-09', through: '2026-10-09' }).income.some(x => x.description === 'ahead 11')); }
  assert.equal(ro.m3.dashboard.incomeYtd, rl.m3.dashboard.incomeYtd, 'YTD stops at the reporting month end');
  assert.ok(!buildWorkbookRows(oct, '2026-09', { inputThrough: 'month_end' }, { today: '2026-10-09' }).income.some(x => x.description === 'Oct commission'));
  // Blank status (payment_status none), as on some master rows.
  assert.equal(buildWorkbookRows({ ...base, transactions: [{ ...base.transactions[0], paymentStatus: 'none' }] }, '2026-09').income.find(x => x.kind === 'manual-income').status, '');
  // Round 2: a payout's rounding remainder goes on its largest row, so the rows sum exactly to the payout.
  const split = buildWorkbookRows({ properties: [1, 2, 3].map(id => ({ id, name: `P${id}`, reportName: `P${id}`, currency: 'AED' })), payouts: [{ id: 'Q', currency: 'USD', amount: '0.10', sourceDate: '2026-09-05' }],
    earnings: [{ payoutId: 'Q', propertyId: 1, currency: 'AED', amount: '0.12' }, { payoutId: 'Q', propertyId: 2, currency: 'AED', amount: '0.13' }, { payoutId: 'Q', propertyId: 3, currency: 'AED', amount: '0.12' }] }, '2026-09', { propertyReportYtdRows: false });
  assert.deepEqual(split.income.filter(x => x.kind === 'airbnb-property').map(x => [x.property, x.usd]), [['P1', 0.03], ['P2', 0.04], ['P3', 0.03]]);
  // M4 Checks: the master's checks with their values; PASS when everything ties.
  assert.deepEqual(r.checks.checks.map(c => c.key), ['airbnb-monthly', 'airbnb-property', 'income-check', 'summary-tie', 'ranking', 'opex-tie']);
  assert.equal(r.checks.checks.find(c => c.key === 'income-check').status, 'REVIEW', 'no Villa 7 income in August here');
  assert.equal(r.checks.checks.find(c => c.key === 'airbnb-property').status, 'OK');
  assert.equal(buildWorkbookRows(base, '2026-09', { incomeChecks: [] }).checks.status, 'PASS');
  // The .xlsx: master sheet order, Dashboard J5 = the ADIB balance, the master's formulas.
  const parts = unzip(workbookXlsx(r));
  assert.deepEqual([...parts['xl/workbook.xml'].matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, '&')), ['Dashboard', 'Apartment Performance', 'Monthly Summary', 'Income Input', 'Expense Input', 'Expense Line Items', 'Confirmed Booking', 'Lists & Sources', 'Checks', 'Forecast', 'Reconciliation']);
  { // Reconciliation is a separate sheet at the end (Expense Line Items keeps only the lines); no app branding anywhere.
    const rcx = parts['xl/worksheets/sheet11.xml'];
    assert.ok(rcx && parts['[Content_Types].xml'].includes('/xl/worksheets/sheet11.xml') && parts['xl/_rels/workbook.xml.rels'].includes('worksheets/sheet11.xml'));
    assert.ok(rcx.includes('On Expense Input (AED)') && rcx.includes('In Expense Input') && rcx.includes(`SUM('Expense Input'!$F$5:$F$503)`) && !/<drawing /.test(rcx));
    assert.ok(!parts['xl/worksheets/sheet6.xml'].includes('In Expense Input') && !parts['xl/worksheets/sheet6.xml'].includes('On Expense Input'));
    for (const [k, v] of Object.entries(parts)) assert.ok(!String(v).includes('Co-Host Pro'), `no "Co-Host Pro" in ${k}`); }
  const dash = parts['xl/worksheets/sheet1.xml'];
  assert.match(dash, /<c r="J5" s="\d+"><v>7259.22<\/v><\/c>/, 'J5 bank balance');
  assert.ok(dash.includes('AVAILABLE AFTER DEPOSITS HELD') && dash.includes('<f>J5-G5</f><v>6259.22</v>'), 'J13 available after deposits held');
  assert.ok(dash.includes('BANK BALANCE - ADIB - 30 SEP 2026'));
  assert.ok(dash.includes('<f>SUMIFS(&apos;Monthly Summary&apos;!$B$4:$B$12') || dash.includes("<f>SUMIFS('Monthly Summary'!$B$4:$B$12"), 'D5 formula');
  assert.ok(dash.includes('<mergeCell ref="J5:L6"/>'));
  assert.ok(dash.includes('<f>Checks!B10</f><v>REVIEW</v>'), 'H2 = Checks MODEL STATUS');
  const ck = parts['xl/worksheets/sheet9.xml'];
  assert.ok(ck.includes('<f>IF(COUNTIF(F4:F9,&quot;REVIEW&quot;)=0,&quot;PASS&quot;,&quot;REVIEW&quot;)</f>') && ck.includes('<conditionalFormatting sqref="F4:F9">'));
  assert.ok(ck.includes("<f>SUMIFS('Income Input'!$H$7:$H$507,'Income Input'!$L$7:$L$507,&quot;Airbnb Monthly Report&quot;)/'Income Input'!$D$2</f>"), 'check 4 formula');
  assert.ok(parts['xl/worksheets/sheet2.xml'].includes('RANK(G5,$G$5:$G$8,0)+COUNTIF($G$5:G5,G5)-1'));
  // Master template: 4 properties here vs the master's 12 -> rows, totals, chart ranges and drawing anchors move.
  assert.ok(parts['xl/charts/chart4.xml'].includes("<c:f>'Apartment Performance'!$C$5:$C$8</c:f>") && parts['xl/charts/chart3.xml'].includes("<c:f>'Apartment Performance'!$G$5:$G$8</c:f>"), 'AP chart ranges follow the rows');
  assert.ok(parts['xl/charts/chart1.xml'].includes('<c:f>Dashboard!$B$20:$B$28</c:f>'), 'Dashboard chart = the 9 summary months');
  { const apx = parts['xl/worksheets/sheet2.xml'], sOf = (x, ref) => (x.match(new RegExp(`<c r="${ref}" s="(\\d+)"`)) || [])[1];
    assert.ok(apx.includes('<c r="C11"') && /<c r="C11" s="\d+" t="inlineStr"><is><t xml:space="preserve">TOTAL<\/t>/.test(apx), 'TOTAL row 3 below the last property, as in the master');
    assert.equal(sOf(apx, 'D11'), (loadTemplate(TEMPLATE_GZ_B64)['xl/worksheets/sheet2.xml'].match(/<c r="D19" s="(\d+)"/) || [])[1], 'total row keeps the master total style (master D19)');
    assert.match(parts['xl/drawings/drawing2.xml'], /<xdr:row>14<\/xdr:row>/, 'AP charts move up with the rows'); }
  assert.ok(parts['xl/worksheets/sheet3.xml'].includes('IF(AND(B9=0,C9=0,D9=0),&quot;No activity&quot;,IF(E9&gt;=0,&quot;Profit&quot;,&quot;Loss&quot;))'));
  // Accounting > Transactions month cards = the export's Monthly Summary row for the month (same rows, no drift).
  {
    const zData = { ...base, payouts: [...base.payouts, { id: 'Z', currency: 'USD', amount: '19.46', sourceDate: '12 September' }],
      earnings: [...base.earnings, { payoutId: 'Z', propertyId: 2, currency: 'ZAR', amount: '313.56', kind: 'cohost', status: 'paid', checkIn: '2026-09-11', confirmationCode: 'HMZ' }],
      transactions: [...base.transactions, { id: 9, type: 'income', allocation: 'company', date: '2026-09-20', amount: '500', category: 'Booking', description: 'ZAR clean', currency: 'ZAR' }] };
    const cm = companyMonthSummary(zData, '2026-09', {}, { today: '2026-10-09' }), wr = buildWorkbookRows(zData, '2026-09', {}, { today: '2026-10-09' });
    const msRow = wr.m3.summary.find(x => x.month === '2026-09');
    assert.equal(cm.revenue.total, Math.round(msRow.income * 100) / 100, 'revenue = Monthly Summary B');
    assert.equal(cm.expenses.total, msRow.opex, 'expenses = Monthly Summary C');
    assert.equal(cm.profit, Math.round(msRow.net * 100) / 100, 'profit = Monthly Summary E');
    assert.equal(cm.expenses.ownerPaid, 200); assert.equal(cm.revenue.managementFeesAndCommissions, 1400);
    assert.ok(Math.abs(cm.revenue.airbnb - Math.round((50 + 5 + 19.46) * 3.6725 * 100) / 100) < 0.011, 'ZAR listing paid in USD: in Airbnb revenue at the USD paid');
    assert.deepEqual(cm.otherCurrencies, [{ currency: 'ZAR', airbnbInAedRevenue: 313.56, usdPayouts: 1, separate: { airbnb: 0, income: 500, expenses: 0, net: 500 } }], 'ZAR never converted, not added twice');
    assert.equal(cm.tags[3], 'Owner paid'); assert.equal(cm.tags[9], 'ZAR (separate)'); assert.equal(cm.tags[5], 'Not in company totals'); assert.equal(cm.tags[2], undefined);
  }
  // Raju's fix: Expense Line Items (every PMS expense line, the left-out ones with the reason) and Confirmed Booking.
  assert.equal(r.expenseLines.filter(x => x.inInput === 'Yes').length, r.expense.length);
  assert.ok(r.expenseLines.some(x => x.inInput === 'No' && x.description === 'Policy' && /no master equivalent/.test(x.note)));
  assert.deepEqual(r.confirmedBookings.map(b => [b.id, b.status, b.management]), [[50, 'checked_out', 1400]]);
  // M5 Forecast: the master's inputs and formulas, 9 months from the month after the report, wired to the exported sheets.
  const F = r.forecast;
  assert.equal(F.inputs.opening, 6259.22, 'bank balance less tenant deposits held (master B5 = Dashboard J13)'); assert.equal(F.inputs.start, '2026-10-01'); assert.equal(F.inputs.windowStart, '2026-07-01');
  assert.equal(F.months.length, 9); assert.equal(F.months[0].month, '2026-10'); assert.equal(F.months[8].month, '2027-06');
  assert.equal(F.inputs.salary, WORKBOOK_DEFAULTS.salaryMonthly);
  for (let i = 1; i < 9; i++) assert.ok(Math.abs(F.months[i].opening - F.months[i - 1].closing) < 1e-9);
  assert.deepEqual(F.after.map(a => a.months), [1, 3, 6, 9]);
  // Master since 9 Oct: expected commissions from Nov (own column) and the one-off: pending company income after the month end.
  assert.deepEqual(F.inputs.expected, { monthly: 0, from: '2026-10-01' }, 'none entered');
  { const fe = buildWorkbookRows(base, '2026-09', { forecastExpectedCommissions: { monthly: 15000, from: '2026-11' } }, { today: '2026-10-09' }).forecast;
    assert.deepEqual(fe.inputs.expected, { monthly: 15000, from: '2026-11-01' }); assert.deepEqual(fe.months.map(m => m.expected).slice(0, 3), [0, 15000, 15000]);
    assert.ok(Math.abs(fe.totals.closing - F.totals.closing - 8 * 15000) < 1e-6, '8 months x 15,000 from Nov'); }
  assert.equal(F.inputs.oneOff.amount, 0);

  { const oo = ro.forecast.inputs.oneOff; assert.equal(oo.amount, 7000); assert.equal(oo.month, '2026-10-01'); assert.equal(ro.forecast.months[0].oneOff, 7000); assert.equal(ro.forecast.months[1].oneOff, 0);
    const fx = unzip(workbookXlsx(ro))['xl/worksheets/sheet10.xml']; assert.ok(fx.includes(`<f>'Income Input'!H${oo.rows[0]}</f><v>7000</v>`) && fx.includes('One-off income - Oct commission'));
    assert.match(fx, /<f>C(\d+)\+D\1\+E\1-F\1-G\1-H\1<\/f>/); assert.match(fx, /<f>IF\(A\d+&gt;=\$B\$\d+,\$B\$\d+,0\)<\/f>/, 'master month-row formulas'); }
  { const fx = parts['xl/worksheets/sheet10.xml']; } assert.equal(F.lowest, Math.min(...F.months.map(m => m.closing)));
  const fc = parts['xl/worksheets/sheet10.xml'];
  assert.ok(fc.includes('<f>Dashboard!J13</f><v>6259.22</v>'), 'B5 = Dashboard J13');
  assert.ok(fc.includes('<f>EOMONTH(B6,-1)</f>') || /<f>EOMONTH\(/.test(fc), 'B8 EOMONTH');
  assert.ok(/<f>SUMIFS\(&apos;Income Input&apos;!\$H|<f>SUMIFS\('Income Input'!\$H/.test(fc), 'B9 Airbnb average from Income Input');
  assert.ok(/<f>MIN\(J\d+:J\d+\)<\/f>/.test(fc), 'lowest balance');
  assert.ok(fc.includes('Cash Forecast - 9 Months (Oct 2026 to Jun 2027)'));
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('YallaStay - Finance Dashboard'), 'report title (export only)');
  assert.ok(buildWorkbookRows(base, '2026-09', {}, { today: '2026-10-09', companyName: 'Co-Host Pro', reportTitle: 'Other title' }).reportTitle === 'Other title');
  assert.equal(Object.keys(WORKBOOK_DEFAULTS).length >= 18, true);
  console.log('OK pure M3: Monthly Summary, Apartment Performance, Dashboard, Lists & Sources; Raju answers as settings');
}

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-yalla-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3031', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function raw(route, method = 'GET', body) { return fetch('http://127.0.0.1:3031/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
async function api(route, method = 'GET', body, expected = 200) { const r = await raw(route, method, body); const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null; }
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Yalla Admin', email: 'yalla@example.invalid', password: 'Test-only-7391!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Prajyoth' }, 201);
  const LW = await api('/properties', 'POST', { name: 'The Lofts West | Downtown', unitNumber: '603', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const SB = await api('/properties', 'POST', { name: 'Sea View 1BR', unitNumber: '2106', city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const ZA = await api('/properties', 'POST', { name: 'Green Lawn', unitNumber: 'GL', city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  assert.deepEqual((await api('/accounting/report-names', 'PUT', [{ id: LW.id, reportName: 'Lofts West 603' }, { id: SB.id, reportName: 'Sunrise Bay 2106' }])), { changed: 2 });
  assert.equal((await api('/accounting/report-names')).find(p => p.id === LW.id).reportName, 'Lofts West 603');

  // Existing behaviour kept: an entry with no treatment follows its allocation and reads back null fields.
  const plain = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-04', amount: '341.18', category: 'Software', description: 'PriceLabs', allocation: 'company', currency: 'AED' }, 201);
  assert.deepEqual([plain.treatment, plain.fxRate, plain.paymentStatus], [null, null, null]);
  // Treatment
  const dewa = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-16', amount: '60', category: 'Utility', description: 'DEWA Sunrise Bay 2106', propertyId: SB.id, treatment: 'pass_through' }, 201);
  assert.deepEqual([dewa.allocation, dewa.treatment], ['company', 'pass_through']);
  const own = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-22', amount: '200', category: 'Cleaning', description: 'Cleaning Lofts West 603', propertyId: LW.id, treatment: 'owner_paid' }, 201);
  assert.equal(own.allocation, 'owner', 'owner paid is charged to the owner');
  // Migration 0028: workbook property (income with no property) and forecast label (income only).
  { const wp = await api('/accounting/transactions', 'POST', { type: 'income', date: '2025-01-15', amount: '10', category: 'Commission', description: 'wp', allocation: 'company', currency: 'AED', reportProperty: 'Company', forecastLabel: 'Label' }, 201);
    assert.deepEqual([wp.reportProperty, wp.forecastLabel], ['Company', 'Label']);
    assert.ok((await api('/accounting/transactions')).some(t => t.id === wp.id && t.reportProperty === 'Company' && t.forecastLabel === 'Label'));
    await api('/accounting/transactions', 'POST', { type: 'income', date: '2025-01-15', amount: '10', category: 'Commission', description: 'wp', propertyId: LW.id, reportProperty: 'Company' }, 400);
    await api('/accounting/transactions', 'POST', { type: 'expense', date: '2025-01-15', amount: '10', category: 'Software', description: 'wp', allocation: 'company', forecastLabel: 'x' }, 400);
    assert.equal((await api(`/accounting/transactions/${wp.id}`, 'PATCH', { reportProperty: '' })).reportProperty, null); }
  // Migration 0029: workbook description (Expense Input wording; full description on Expense Line Items) and fixed order.
  { const a = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2025-02-10', amount: '20', category: 'Software', description: 'Zeta full, inv 123', allocation: 'company', reportDescription: 'Zeta', reportOrder: 2 }, 201);
    const b = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2025-02-10', amount: '30', category: 'Software', description: 'Alpha', allocation: 'company', reportOrder: 1 }, 201);
    const c = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2025-02-10', amount: '40', category: 'Car', description: 'Aardvark', allocation: 'company' }, 201);
    assert.deepEqual([a.reportDescription, a.reportOrder], ['Zeta', 2]);
    await api('/accounting/transactions', 'POST', { type: 'expense', date: '2025-02-10', amount: '1', category: 'Software', description: 'x', allocation: 'company', reportOrder: 0 }, 400);
    const wb = await api('/accounting/workbook/2025-02');
    assert.deepEqual(wb.expense.filter(x => x.date === '2025-02-10').map(x => x.description), ['Alpha', 'Zeta', 'Aardvark'], 'fixed order first, then the usual order');
    assert.ok(wb.expenseLines.some(x => x.description === 'Zeta full, inv 123') && !wb.expenseLines.some(x => x.description === 'Zeta'), 'full description on Expense Line Items');
    for (const t of [a, b, c]) await api(`/accounting/transactions/${t.id}`, 'DELETE', undefined, 204); }
  const moved = await api(`/accounting/transactions/${own.id}`, 'PATCH', { allocation: 'company' });
  assert.deepEqual([moved.allocation, moved.treatment], ['company', 'company'], 'changing charge-to moves the treatment with it');
  await api(`/accounting/transactions/${own.id}`, 'PATCH', { treatment: 'owner_paid' });
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-22', amount: '1', category: 'Cleaning', description: 'x', treatment: 'owner_paid' }, 400)).error, /property/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-22', amount: '1', category: 'Other', description: 'x', treatment: 'pass_through' }, 400)).error, /expenses only/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-22', amount: '1', category: 'Other', description: 'x', treatment: 'bogus' }, 400)).error, /Treatment/);
  // Salary
  const sal = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-09', amount: '4774', category: 'salary', description: 'Clifford - September salary (part 1)', propertyId: LW.id, allocation: 'owner' }, 201);
  assert.deepEqual([sal.category, sal.allocation, sal.treatment, sal.propertyId], ['Salary', 'company', 'company', null], 'salary is a company operating expense with no property');
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-09', amount: '1', category: 'Salary', description: 'x', treatment: 'pass_through' }, 400)).error, /Salary/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-09', amount: '1', category: 'Salary', description: 'x' }, 400)).error, /Salary is an expense/);
  // FX
  const usd = await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-30', amount: '10', category: 'Software', description: 'USD tool', allocation: 'company', currency: 'USD', paymentStatus: 'pending' }, 201);
  assert.deepEqual([usd.fxRate, usd.paymentStatus], [3.6725, 'pending'], 'USD gets the fixed peg');
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-30', amount: '10', category: 'Software', description: 'x', allocation: 'company', currency: 'USD', fxRate: 3.7 }, 400)).error, /fixed at 3.6725/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-30', amount: '10', category: 'Cleaning', description: 'x', allocation: 'company', currency: 'ZAR', fxRate: 0.2 }, 400)).error, /ZAR is kept separate/);
  await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-12', amount: '500', category: 'Cleaning', description: 'Green Lawn clean', propertyId: ZA.id, allocation: 'company', currency: 'ZAR' }, 201);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-30', amount: '1', category: 'Other', description: 'x', paymentStatus: 'later' }, 400)).error, /Payment status/);
  const listed = (await api('/accounting/transactions?month=2026-09')).find(t => t.id === dewa.id);
  assert.equal(listed.treatment, 'pass_through');
  const cstate = await api('/accounting/company-statement?start=2026-09-01&end=2026-09-30');
  assert.ok(!cstate.lines.some(l => l.id === `manual-${dewa.id}`), 'pass-through DEWA is not in the company statement');

  // Deposits register
  const dep = await api('/accounting/deposits', 'POST', { kind: 'liability', propertyId: LW.id, counterparty: 'Tonye', amount: 1000, date: '2026-09-06', method: 'Ziina', notes: 'Paid with Sep rent via Ziina; refund when due' }, 201);
  assert.equal(dep.status, 'held');
  const asset = await api('/accounting/deposits', 'POST', { kind: 'asset', propertyId: SB.id, counterparty: 'Landlord', amount: 11500, date: '2026-07-29', notes: 'Security deposit 10% of 115,000 - refundable at lease end' }, 201);
  assert.match((await api('/accounting/deposits', 'POST', { kind: 'other', counterparty: 'x', amount: 1, date: '2026-09-06' }, 400)).error, /asset/);
  assert.match((await api(`/accounting/deposits/${dep.id}`, 'PATCH', { status: 'kept', settledOn: '2026-09-20' }, 400)).error, /amount kept/);
  assert.match((await api(`/accounting/deposits/${dep.id}`, 'PATCH', { status: 'kept', settledOn: '2026-09-20', keptAmount: 1200, keptReason: 'x' }, 400)).error, /more than the deposit/);
  assert.match((await api(`/accounting/deposits/${dep.id}`, 'PATCH', { status: 'refunded', settledOn: '2026-09-01' }, 400)).error, /before the deposit/);
  let regs = await api('/accounting/deposits');
  assert.deepEqual(regs.held, [{ currency: 'AED', asset: 11500, liability: 1000 }]);

  // Lease + cheques
  const L = await api('/accounting/leases', 'POST', { name: 'Sunrise Bay 2106 lease', propertyId: SB.id, startDate: '2026-08-08', endDate: '2027-08-07', annualRent: 115000, agencyFee: 6037.5, agencyFeeDate: '2026-08-17', agencyFeeNote: 'Agency fee - paid by Aziza, repaid 17 Aug (one-off)',
    cheques: cheques.map(c => ({ seq: c.seq, dueDate: c.dueDate, amount: c.amount, months: c.months, paidOn: c.paidOn })) }, 201);
  assert.equal(L.chequesMatchRent, true); assert.equal(L.accruals.length, 12);
  assert.match((await api('/accounting/leases', 'POST', { name: 'Bad', startDate: '2026-08-08', endDate: '2026-08-01', annualRent: 1 }, 400)).error, /end after/);
  assert.match((await api('/accounting/leases', 'POST', { name: 'Bad', startDate: '2026-08-08', endDate: '2027-08-01', annualRent: 1, agencyFee: 5 }, 400)).error, /agency fee/);
  await api(`/accounting/deposits/${asset.id}`, 'PATCH', { leaseId: L.id });
  assert.match((await api(`/accounting/leases/${L.id}`, 'DELETE', null, 409)).error, /deposit is linked/);
  assert.equal((await api(`/accounting/leases/${L.id}/schedule`)).accruals[1].amount, 9583.33);

  // Bank balance
  const bb = await api('/accounting/bank-balances/2026-09', 'PUT', { balance: 12345.67, notes: 'test' });
  assert.deepEqual([bb.account, bb.balanceDate, bb.balance], ['ADIB 19589605', '2026-09-30', 12345.67]);
  await api('/accounting/bank-balances/2026-09', 'PUT', { balance: 100 });
  assert.equal((await api('/accounting/bank-balances')).length, 1, 'one balance per account and month (upsert)');
  await api('/accounting/bank-balances/2026-13', 'PUT', { balance: 1 }, 400);
  // Migration 0027: one dated latest balance per account, next to the month ends.
  const lt = await api('/accounting/bank-balances/latest', 'PUT', { balanceDate: '2026-10-01', balance: 50 });
  assert.deepEqual([lt.kind, lt.month, lt.balanceDate], ['latest', '2026-10', '2026-10-01']);
  await api('/accounting/bank-balances/latest', 'PUT', { balanceDate: '2026-10-02', balance: 55.5 });
  assert.deepEqual((await api('/accounting/bank-balances')).map(b => [b.kind, b.balance]), [['month_end', 100], ['latest', 55.5]], 'the latest replaces the latest');
  await api('/accounting/bank-balances/latest', 'PUT', { balanceDate: '2999-01-01', balance: 1 }, 400);
  await api('/accounting/bank-balances/latest', 'PUT', { balanceDate: '2026-10-02', balance: 1.234 }, 400);
  // Show in report flag (and names untouched when only the flag is sent).
  await api('/accounting/report-names', 'PUT', [{ id: SB.id, showInReport: false }]);
  assert.deepEqual((({ reportName, showInReport }) => [reportName, showInReport])((await api('/accounting/report-names')).find(p => p.id === SB.id)), ['Sunrise Bay 2106', false]);
  await api('/accounting/report-names', 'PUT', [{ id: SB.id, showInReport: true }]);

  // Migration 0026: direct cost and payer (income only), workbook category.
  const dir = await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-01', amount: '2250', directCost: '100', payer: 'direct', propertyId: LW.id, allocation: 'company', category: 'Booking', reportCategory: 'Airbnb', description: 'Direct booking Lofts West 603', currency: 'AED' }, 201);
  assert.deepEqual([dir.directCost, dir.payer, dir.reportCategory], [100, 'direct', 'Airbnb']);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-01', amount: '5', directCost: '1', category: 'Other', description: 'x', allocation: 'company' }, 400)).error, /income only/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-01', amount: '5', directCost: '6', category: 'Other', description: 'x', allocation: 'company' }, 400)).error, /more than the amount/);
  assert.equal((await api(`/accounting/transactions/${plain.id}`, 'PATCH', { reportCategory: 'Software' })).reportCategory, 'Software');
  assert.equal((await api('/accounting/transactions?month=2026-09')).find(t => t.id === dir.id).directCost, 100);
  // Migration 0027: workbook source text and the blank status.
  const src = await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-08-31', amount: '8000', payer: 'Nguyen', category: 'Commission', description: 'Current month income', allocation: 'company', currency: 'AED', reportSource: 'User instruction', paymentStatus: 'none' }, 201);
  assert.deepEqual([src.reportSource, src.paymentStatus], ['User instruction', 'none']);

  // M2 export (default range: the summary's first month to today; one month with from/through)
  const wb = await api('/accounting/workbook/2026-09');
  assert.equal(wb.from, '2026-04');
  const one = m => api(`/accounting/workbook/${m}?from=${m}&through=${new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10)}`);
  assert.deepEqual((({ source, status }) => [source, status])(wb.income.find(r => r.transactionId === src.id)), ['User instruction', '']);
  assert.deepEqual((({ category, payer, gross, cost }) => [category, payer, gross, cost])(wb.income.find(r => r.transactionId === dir.id)), ['Airbnb', 'direct', 2250, 100]);
  assert.equal(wb.m3.dashboard.bankBalance, 55.5, 'Dashboard J5 = the latest ADIB balance');
  assert.equal((await one('2026-09')).m3.dashboard.bankBalance, 100, 'a month-end export shows the month end');
  const exp = d => wb.expense.filter(r => r.description === d);
  assert.equal(exp('DEWA Sunrise Bay 2106')[0].treatment, 'Pass-through (excluded)'); assert.equal(exp('DEWA Sunrise Bay 2106')[0].category, 'DEWA');
  assert.deepEqual([exp('Cleaning Lofts West 603')[0].treatment, exp('Cleaning Lofts West 603')[0].paidBy, exp('Cleaning Lofts West 603')[0].property], ['Owner Paid (excluded)', 'Owner (Prajyoth)', 'Lofts West 603']);
  assert.equal(exp('Rent 8 Sep-7 Oct (1/3 of Q1 cheque 28,750 paid 29 Jul)')[0].amount, 9583.33);
  assert.equal(exp('USD tool')[0].amount, 36.73); assert.equal(exp('USD tool')[0].paymentStatus, 'Pending');
  assert.equal(exp('Clifford - September salary (part 1)')[0].property, 'Company');
  assert.ok(wb.excluded.some(x => x.currency === 'ZAR' && x.description === 'Green Lawn clean'), 'ZAR is listed, never converted');
  assert.ok(!wb.expense.some(r => /Tonye/.test(r.description)) && !wb.income.some(r => /Tonye/.test(r.payer || '')), 'a held liability deposit is not P&L');
  assert.equal(wb.totals.passThrough, 60); assert.equal(wb.totals.ownerPaid, 200);
  const jul = await one('2026-07');
  assert.deepEqual(jul.expense.map(r => [r.category, r.amount, r.treatment]), [['Security Deposit', 11500, 'Refundable Deposit']]);
  const aug = await one('2026-08');
  assert.ok(aug.expense.some(r => r.category === 'Agent Commission' && r.amount === 6037.5 && r.date === '2026-08-17'));
  // A deposit kept against damage becomes income (damage recovery) in the month it was kept.
  await api(`/accounting/deposits/${dep.id}`, 'PATCH', { status: 'kept', settledOn: '2026-10-03', keptAmount: 400, keptReason: 'broken lamp' });
  // Round 3: mapped to Other income, labelled "Damage recovery (deposit kept)".
  const oct = await one('2026-10');
  const dk = oct.income.filter(r => r.kind === 'deposit-kept');
  assert.equal(dk.length, 1); assert.equal(dk[0].category, 'Other'); assert.equal(dk[0].description, 'Damage recovery (deposit kept): broken lamp'); assert.equal(dk[0].gross, 400);
  assert.ok(!oct.excluded.some(x => /Damage recovery/.test(x.reason || '')) && !oct.warnings.some(w => w.code === 'category' && w.category === 'Damage recovery'));
  regs = await api('/accounting/deposits'); assert.equal(regs.items.find(d => d.id === dep.id).refundedAmount, 600);
  // Q5: the management fee received date (audited).
  const bk = await api('/reservations', 'POST', { propertyId: LW.id, platform: 'direct', guestName: 'Sept income', checkIn: '2026-09-28', checkOut: '2026-09-30', status: 'checked_out', financeMode: 'inclusive-v1', grossAmount: '14000.00', cleaningFee: '0', channelFees: '0' }, 201);
  assert.equal((await api('/accounting/workbook/2026-09')).income.find(x => x.bookingId === bk.id)?.status, 'Pending');
  await api(`/accounting/workbook/fee-received/${bk.id}`, 'PUT', { receivedOn: '2026-09-18', note: 'netted from the owner payout' });
  assert.equal((await api('/accounting/workbook/2026-09')).income.find(x => x.bookingId === bk.id).status, 'Received');
  await api(`/accounting/workbook/fee-received/${bk.id}`, 'PUT', { receivedOn: '2999-01-01' }, 400);
  await api('/accounting/workbook/fee-received/999999', 'PUT', { receivedOn: '2026-09-18' }, 404);
  assert.ok((await api('/audit-log')).some(a => a.entity === 'reservation_fee_received'));
  assert.equal((await api('/accounting/workbook/2026-09?from=2026-07')).from, '2026-07');
  await api('/accounting/workbook/2026-09?from=2026-10', 'GET', null, 400);
  await api('/accounting/workbook/2026-09?through=2026-09-15', 'GET', null, 400);
  // The .xlsx: master sheet names, header rows and column order.
  const r = await raw('/accounting/workbook/2026-09.xlsx'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /YALLA_Workbook_2026-09\.xlsx/);
  const parts = unzip(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual([...parts['xl/workbook.xml'].matchAll(/<sheet [^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/g)].map(x => [x[1].replace(/&amp;/g, '&'), x[2]]), ['Dashboard', 'Apartment Performance', 'Monthly Summary', 'Income Input', 'Expense Input', 'Expense Line Items', 'Confirmed Booking', 'Lists & Sources', 'Checks', 'Forecast', 'Reconciliation'].map((n, i) => [n, String(i + 1)]));
  // Template: the master's styles, charts and drawings are in the export (identical look).
  for (const k of ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/charts/chart1.xml', 'xl/charts/chart4.xml', 'xl/drawings/drawing1.xml']) assert.ok(parts[k], k);
  assert.ok(!/macroEnabled/.test(parts['[Content_Types].xml']), 'plain .xlsx, no macros');
  // Expense Line Items ties to Expense Input; Confirmed Booking lists the confirmed stays (no guest names).
  assert.ok(parts['xl/worksheets/sheet11.xml'].includes('<f>IF(ROUND(F2-H2,2)=0,&quot;OK&quot;,&quot;REVIEW&quot;)</f><v>OK</v>'), 'line items tie (Reconciliation)');
  assert.ok(!parts['xl/worksheets/sheet7.xml'].includes('Sept income'), 'no guest names');
  assert.ok(parts['xl/worksheets/sheet7.xml'].includes('<t xml:space="preserve">checked_out</t>'));
  assert.ok(parts['xl/worksheets/sheet10.xml'].includes('<f>Dashboard!J13</f>'));
  // Company month cards: the API returns the export's figures for the month (owner/pass-through tagged, not counted).
  { const cm = await api('/accounting/company-month/2026-09'); const w = await api('/accounting/workbook/2026-09');
    assert.equal(cm.revenue.total, w.totals.income); assert.equal(cm.expenses.total, w.totals.operatingExpenses); assert.equal(cm.expenses.passThrough, w.totals.passThrough);
    assert.equal(cm.profit, Math.round((w.totals.income - w.totals.operatingExpenses) * 100) / 100);
    await api('/accounting/company-month/2026-9', 'GET', null, 400); }
  // Round 3: the report title is a setting, used only in the export (audited).
  assert.equal((await api('/accounting/workbook-settings')).reportTitle, null, 'unset = WORKBOOK_DEFAULTS.reportTitle');
  // Expected commissions (Finance inputs) feed Forecast B20:B21; the title is kept.
  assert.deepEqual(await api('/accounting/workbook-settings', 'PUT', { expectedCommissions: { monthly: 15000, from: '2026-11' } }), { reportTitle: null, expectedCommissions: { monthly: 15000, from: '2026-11' } });
  { const wf = await api('/accounting/workbook/2026-09'); assert.deepEqual(wf.forecast.inputs.expected, { monthly: 15000, from: '2026-11-01' }); }
  await api('/accounting/workbook-settings', 'PUT', { expectedCommissions: { monthly: 1, from: '2026-1' } }, 400);
  await api('/accounting/workbook-settings', 'PUT', { expectedCommissions: null });
  assert.equal((await api('/accounting/workbook/2026-09')).lists.items.find(i => i.key.startsWith('lease-agency')).reference, 'Paid by Aziza, repaid by company');
  assert.equal((await api('/accounting/workbook-settings')).expectedCommissions, null);
  assert.ok(parts['xl/worksheets/sheet1.xml'].includes('YallaStay - Finance Dashboard'));
  await api('/accounting/workbook-settings', 'PUT', { reportTitle: 'Test Title' });
  const t2 = unzip(Buffer.from(await (await raw('/accounting/workbook/2026-09.xlsx')).arrayBuffer()));
  assert.ok(t2['xl/worksheets/sheet1.xml'].includes('Test Title - Finance Dashboard'));
  await api('/accounting/workbook-settings', 'PUT', { reportTitle: 'x'.repeat(81) }, 400);
  assert.deepEqual(await api('/accounting/workbook-settings', 'PUT', { reportTitle: '' }), { reportTitle: null, expectedCommissions: null });
  assert.ok((await api('/audit-log')).some(a => a.entity === 'workbook_settings'));
  const texts = xml => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const row = (xml, n) => texts((xml.match(new RegExp(`<row r="${n}"[^>]*>(.*?)</row>`)) || [])[1] || '');
  assert.deepEqual(row(parts['xl/worksheets/sheet4.xml'], 6), INCOME_HEADERS);
  assert.deepEqual(row(parts['xl/worksheets/sheet5.xml'], 4), EXPENSE_HEADERS);
  assert.ok(parts['xl/worksheets/sheet5.xml'].includes('<f>IF(A5=&quot;&quot;,&quot;&quot;,TEXT(A5,&quot;mmm yyyy&quot;))</f><v>Jul 2026</v>'), 'Month formula as in the master, with its value');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'yalla_workbook_export'));
  console.log('OK YALLA M1 inputs (deposits, leases, treatment, salary, FX, bank balance), M2 Income/Expense Input and M3 sheets export');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
