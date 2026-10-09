// YALLA workbook M1 + M2 + M3: lease accruals (9,583.33/9,583.33/9,583.34 per quarterly cheque, dated the 8th), the
// deposits register (asset/liability, held/refunded/kept), expense treatment (company/owner paid/pass-through),
// Salary, FX (USD fixed 3.6725, ZAR kept separate), monthly bank balance, and the Income/Expense Input .xlsx export
// with the master's sheet names and column order. Pass-through entries stay out of the company statement.
// M3: Monthly Summary, Apartment Performance (owner paid flagged), Dashboard (bank balance J5) and Lists & Sources with
// the master's formulas and cached values; Raju's answers (9 Oct) as settings in lib/yalla-config.mjs.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { leaseAccruals, equalCheques } from '../lib/lease-schedule.mjs';
import { buildWorkbookRows, workbookXlsx, INCOME_HEADERS, EXPENSE_HEADERS, mapExpenseCategory, mapIncomeCategory } from '../lib/yalla-workbook.mjs';
import { WORKBOOK_DEFAULTS } from '../lib/yalla-config.mjs';
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
}, '2026-09', { propertyReportYtdRows: false, propertyReportZeroRows: 'none', extraListProperties: [] });
assert.deepEqual(pure.income.map(r => [r.view, r.property, r.usd]), [['Airbnb Monthly Report', 'Various', 84], ['Airbnb Property Report', '2 Bedroom Mount Pleasant', 21.44], ['Airbnb Property Report', 'Garden', 62.56]]);
assert.equal(pure.totals.income, 308.49, 'only the monthly total counts (84 × 3.6725)');
console.log('OK pure: lease accruals, category map, pass-through, Airbnb monthly vs property rows');

// ── Pure M3 + Raju's answers (each a setting) ──
{
  assert.equal(mapExpenseCategory({ category: 'Cleaning', reportCategory: 'Cleaner' }, 'company'), 'Cleaner', 'Q4: the row\'s workbook category wins');
  assert.equal(mapExpenseCategory({ category: 'Transport' }, 'company'), 'Car');
  assert.equal(mapIncomeCategory({ category: 'Booking', reportCategory: 'Airbnb' }), 'Airbnb');
  const props = [{ id: 1, name: 'L', reportName: 'Lofts West 603', ownerId: 7, currency: 'AED' }, { id: 2, name: 'S', reportName: 'Sunrise Bay 2106', currency: 'AED' }, { id: 3, name: 'Serenity', currency: 'AED' }, { id: 4, name: 'P', reportName: 'Sunrise Bay 1406', currency: 'AED', status: 'planned' }];
  const base = {
    properties: props, owners: [{ id: 7, name: 'Prajyoth' }],
    payouts: [{ id: 'A', currency: 'USD', amount: '100.00', sourceDate: '2026-08-10' }, { id: 'B', currency: 'USD', amount: '50.00', sourceDate: '2026-09-10' }, { id: 'C', currency: 'USD', amount: '5.00', sourceDate: '3 September' }],
    earnings: [{ payoutId: 'A', propertyId: 2, currency: 'AED', amount: '367.25' }, { payoutId: 'B', propertyId: 2, currency: 'AED', amount: '183.63' }, { payoutId: 'C', propertyId: 2, currency: 'AED', amount: '18.36', checkIn: '2026-09-01' }, { payoutId: 'C', propertyId: 2, currency: 'AED', amount: '0.01', checkIn: '2025-09-01' }],
    bookings: [{ id: 50, propertyId: 1, financeMode: 'inclusive-v1', status: 'checked_out', checkOut: '2026-09-30', managementAmount: '1400', managementPercent: 10, paymentStatus: 'unknown', cleaningFee: '200' }],
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
  // active PMS property; Villa 7 (from the settings) is listed but gets no Airbnb rows.
  const ytd = r.income.filter(x => x.kind === 'airbnb-ytd'), mon = r.income.filter(x => x.kind === 'airbnb-property');
  assert.deepEqual(ytd.map(x => [x.date, x.property, x.usd]), [['2026-09-01', 'Sunrise Bay 2106', 100], ['2026-09-01', 'Lofts West 603', 0], ['2026-09-01', 'Sunrise Bay 1406', 0]]);
  assert.equal(ytd[0].description, 'Property allocation through 1 Sep 2026 - excluded from dashboard total');
  assert.deepEqual(mon.map(x => [x.property, x.usd]), [['Sunrise Bay 2106', 55], ['Lofts West 603', 0], ['Sunrise Bay 1406', 0]]);
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
  assert.ok(r.warnings.some(w => w.code === 'category' && w.category === 'Insurance'));
  // Direct cost and payer on Income Input.
  assert.deepEqual((({ category, payer, gross, cost }) => [category, payer, gross, cost])(r.income.find(x => x.kind === 'manual-income')), ['Airbnb', 'direct', 2250, 100]);
  // M3 values (as the master's formulas compute them).
  const m = r.m3, sep = m.summary.find(x => x.month === '2026-09');
  assert.deepEqual(m.months[0], '2026-04'); assert.equal(m.months.length, 9);
  const usd55 = 55 * 3.6725;
  assert.ok(Math.abs(sep.income - (usd55 + 2150 + 1400)) < 1e-6, 'B: Income Input net (Pending counts too), property rows excluded');
  assert.equal(sep.opex, 4774 + 260 + 10 + 500); assert.equal(sep.deposits, 0); assert.equal(sep.status, 'Loss');
  const lofts = m.apartments.find(a => a.property === 'Lofts West 603');
  assert.deepEqual([lofts.gross, lofts.directCosts, lofts.allocated, lofts.ownerPaid], [3650, 100, 0, 200], 'owner paid is flagged in its own column, outside the net');
  assert.deepEqual(m.apartments.map(a => a.rank).sort(), [1, 2, 3, 4]);
  assert.equal(m.apartments.find(a => a.property === 'Villa 7').rank, 2, 'zero ties broken by list order (Villa 7 before Sunrise Bay 1406)');
  assert.deepEqual([m.dashboard.propertiesManaged, m.dashboard.depositsHeld, m.dashboard.bankBalance], [4, 1000, 7259.22]);
  // The .xlsx: master sheet order, Dashboard J5 = the ADIB balance, the master's formulas.
  const parts = unzip(workbookXlsx(r));
  assert.deepEqual([...parts['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, '&')), ['Dashboard', 'Apartment Performance', 'Monthly Summary', 'Income Input', 'Expense Input', 'Lists & Sources']);
  const dash = parts['xl/worksheets/sheet1.xml'];
  assert.ok(dash.includes('<c r="J5" s="16"><v>7259.22</v></c>'), 'J5 bank balance');
  assert.ok(dash.includes('BANK BALANCE - ADIB - 30 SEP 2026'));
  assert.ok(dash.includes('<f>SUMIFS(&apos;Monthly Summary&apos;!$B$4:$B$12') || dash.includes("<f>SUMIFS('Monthly Summary'!$B$4:$B$12"), 'D5 formula');
  assert.ok(dash.includes('<mergeCell ref="J5:L6"/>'));
  assert.ok(parts['xl/worksheets/sheet2.xml'].includes('RANK(G5,$G$5:$G$8,0)+COUNTIF($G$5:G5,G5)-1'));
  assert.ok(parts['xl/worksheets/sheet3.xml'].includes('IF(AND(B9=0,C9=0,D9=0),&quot;No activity&quot;,IF(E9&gt;=0,&quot;Profit&quot;,&quot;Loss&quot;))'));
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

  // Migration 0026: direct cost and payer (income only), workbook category.
  const dir = await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-01', amount: '2250', directCost: '100', payer: 'direct', propertyId: LW.id, allocation: 'company', category: 'Booking', reportCategory: 'Airbnb', description: 'Direct booking Lofts West 603', currency: 'AED' }, 201);
  assert.deepEqual([dir.directCost, dir.payer, dir.reportCategory], [100, 'direct', 'Airbnb']);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'expense', date: '2026-09-01', amount: '5', directCost: '1', category: 'Other', description: 'x', allocation: 'company' }, 400)).error, /income only/);
  assert.match((await api('/accounting/transactions', 'POST', { type: 'income', date: '2026-09-01', amount: '5', directCost: '6', category: 'Other', description: 'x', allocation: 'company' }, 400)).error, /more than the amount/);
  assert.equal((await api(`/accounting/transactions/${plain.id}`, 'PATCH', { reportCategory: 'Software' })).reportCategory, 'Software');
  assert.equal((await api('/accounting/transactions?month=2026-09')).find(t => t.id === dir.id).directCost, 100);

  // M2 export
  const wb = await api('/accounting/workbook/2026-09');
  assert.deepEqual((({ category, payer, gross, cost }) => [category, payer, gross, cost])(wb.income.find(r => r.transactionId === dir.id)), ['Airbnb', 'direct', 2250, 100]);
  assert.equal(wb.m3.dashboard.bankBalance, 100, 'Dashboard J5 = the month\'s ADIB balance');
  const exp = d => wb.expense.filter(r => r.description === d);
  assert.equal(exp('DEWA Sunrise Bay 2106')[0].treatment, 'Pass-through (excluded)'); assert.equal(exp('DEWA Sunrise Bay 2106')[0].category, 'DEWA');
  assert.deepEqual([exp('Cleaning Lofts West 603')[0].treatment, exp('Cleaning Lofts West 603')[0].paidBy, exp('Cleaning Lofts West 603')[0].property], ['Owner Paid (excluded)', 'Owner (Prajyoth)', 'Lofts West 603']);
  assert.equal(exp('Rent 8 Sep-7 Oct (1/3 of Q1 cheque 28,750 paid 29 Jul)')[0].amount, 9583.33);
  assert.equal(exp('USD tool')[0].amount, 36.73); assert.equal(exp('USD tool')[0].paymentStatus, 'Pending');
  assert.equal(exp('Clifford - September salary (part 1)')[0].property, 'Company');
  assert.ok(wb.excluded.some(x => x.currency === 'ZAR' && x.description === 'Green Lawn clean'), 'ZAR is listed, never converted');
  assert.ok(!wb.expense.some(r => /Tonye/.test(r.description)) && !wb.income.some(r => /Tonye/.test(r.payer || '')), 'a held liability deposit is not P&L');
  assert.equal(wb.totals.passThrough, 60); assert.equal(wb.totals.ownerPaid, 200);
  const jul = await api('/accounting/workbook/2026-07');
  assert.deepEqual(jul.expense.map(r => [r.category, r.amount, r.treatment]), [['Security Deposit', 11500, 'Refundable Deposit']]);
  const aug = await api('/accounting/workbook/2026-08');
  assert.ok(aug.expense.some(r => r.category === 'Agent Commission' && r.amount === 6037.5 && r.date === '2026-08-17'));
  // A deposit kept against damage becomes income (damage recovery) in the month it was kept.
  await api(`/accounting/deposits/${dep.id}`, 'PATCH', { status: 'kept', settledOn: '2026-10-03', keptAmount: 400, keptReason: 'broken lamp' });
  const oct = await api('/accounting/workbook/2026-10');
  assert.deepEqual(oct.income.filter(r => r.kind === 'deposit-kept').map(r => [r.category, r.gross, r.payer]), [['Damage recovery', 400, 'Tonye']]);
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
  // The .xlsx: master sheet names, header rows and column order.
  const r = await raw('/accounting/workbook/2026-09.xlsx'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /YALLA_Workbook_2026-09\.xlsx/);
  const parts = unzip(Buffer.from(await r.arrayBuffer()));
  assert.match(parts['xl/workbook.xml'], /<sheet name="Dashboard" sheetId="1"[^>]*\/><sheet name="Apartment Performance" sheetId="2"[^>]*\/><sheet name="Monthly Summary" sheetId="3"[^>]*\/><sheet name="Income Input" sheetId="4"[^>]*\/><sheet name="Expense Input" sheetId="5"[^>]*\/><sheet name="Lists &amp; Sources" sheetId="6"/);
  const texts = xml => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const row = (xml, n) => texts((xml.match(new RegExp(`<row r="${n}">(.*?)</row>`)) || [])[1] || '');
  assert.deepEqual(row(parts['xl/worksheets/sheet4.xml'], 6), INCOME_HEADERS);
  assert.deepEqual(row(parts['xl/worksheets/sheet5.xml'], 4), EXPENSE_HEADERS);
  assert.ok(parts['xl/worksheets/sheet5.xml'].includes('<f>IF(A5=&quot;&quot;,&quot;&quot;,TEXT(A5,&quot;mmm yyyy&quot;))</f><v>Sep 2026</v>'), 'Month formula as in the master, with its value');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'yalla_workbook_export'));
  console.log('OK YALLA M1 inputs (deposits, leases, treatment, salary, FX, bank balance), M2 Income/Expense Input and M3 sheets export');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
