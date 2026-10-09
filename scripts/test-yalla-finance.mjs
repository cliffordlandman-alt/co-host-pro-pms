// YALLA workbook M1 + M2: lease accruals (9,583.33/9,583.33/9,583.34 per quarterly cheque, dated the 8th), the
// deposits register (asset/liability, held/refunded/kept), expense treatment (company/owner paid/pass-through),
// Salary, FX (USD fixed 3.6725, ZAR kept separate), monthly bank balance, and the Income/Expense Input .xlsx export
// with the master's sheet names and column order. Pass-through entries stay out of the company statement.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { leaseAccruals, equalCheques } from '../lib/lease-schedule.mjs';
import { buildWorkbookRows, INCOME_HEADERS, EXPENSE_HEADERS, mapExpenseCategory } from '../lib/yalla-workbook.mjs';
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
}, '2026-09');
assert.deepEqual(pure.income.map(r => [r.view, r.property, r.usd]), [['Airbnb Monthly Report', 'Various', 84], ['Airbnb Property Report', '2 Bedroom Mount Pleasant', 21.44], ['Airbnb Property Report', 'Garden', 62.56]]);
assert.equal(pure.totals.income, 308.49, 'only the monthly total counts (84 × 3.6725)');
console.log('OK pure: lease accruals, category map, pass-through, Airbnb monthly vs property rows');

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

  // M2 export
  const wb = await api('/accounting/workbook/2026-09');
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
  // The .xlsx: master sheet names, header rows and column order.
  const r = await raw('/accounting/workbook/2026-09.xlsx'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /YALLA_Income_Expense_2026-09\.xlsx/);
  const parts = unzip(Buffer.from(await r.arrayBuffer()));
  assert.match(parts['xl/workbook.xml'], /<sheet name="Income Input" sheetId="1"[^>]*\/><sheet name="Expense Input" sheetId="2"/);
  const texts = xml => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const row = (xml, n) => texts((xml.match(new RegExp(`<row r="${n}">(.*?)</row>`)) || [])[1] || '');
  assert.deepEqual(row(parts['xl/worksheets/sheet1.xml'], 6), INCOME_HEADERS);
  assert.deepEqual(row(parts['xl/worksheets/sheet2.xml'], 4), EXPENSE_HEADERS);
  assert.ok(parts['xl/worksheets/sheet2.xml'].includes('<f>IF(A5=&quot;&quot;,&quot;&quot;,TEXT(A5,&quot;mmm yyyy&quot;))</f><v>Sep 2026</v>'), 'Month formula as in the master, with its value');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'yalla_workbook_export'));
  console.log('OK YALLA M1 inputs (deposits, leases, treatment, salary, FX, bank balance) and M2 Income/Expense Input export');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
