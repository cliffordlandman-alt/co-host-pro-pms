// Income per property reconciles with owner statements (Clifford, 3 Oct 2026): every property's figures for a
// month come from the same owner-statement calculation (lib/owner-statement-calc.mjs), or the published statement
// as stored; currencies are never added together; unverified bookings are marked as estimates and never counted;
// "net to YallaStay" adds up to the company statement; the year view is the sum of its months; read only.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ownerStatementCalc } from '../lib/owner-statement-calc.mjs';
import { incomeReport } from '../lib/income-report.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} vs ${b}`);

// ── Pure: the calculation, a held month, mixed currency ──
{
  const property = { id: 1, name: 'P', currency: 'AED', ownerId: 9 };
  const b = (id, extra) => ({ id, propertyId: 1, guestName: `G${id}`, status: 'checked_out', platform: 'airbnb', checkIn: '2026-09-01', checkOut: '2026-09-04', nights: 3, financeMode: 'inclusive-v1', grossAmount: '1000.00', vatAmount: '0', tourismFee: '0', channelAmount: '150.00', managementAmount: '170.00', cleaningFee: '100.00', ownerAmount: '580.00', ...extra });
  const exp = [{ id: 1, propertyId: 1, type: 'expense', allocation: 'owner', date: '2026-09-10', amount: '30.00', currency: 'AED' }, { id: 2, propertyId: 1, type: 'expense', allocation: 'company', date: '2026-09-10', amount: '99.00' }];
  const c = ownerStatementCalc({ property, rules: null, bookings: [b(1), b(2, { checkOut: '2026-10-01' }), b(3, { status: 'cancelled' })], expenses: exp, tickets: [], month: '2026-09' });
  assert.equal(c.hold, null); assert.equal(c.statement.ownerPayout, '550.00'); assert.equal(c.statement.bookingsCount, 1); assert.equal(c.groups.length, 1);
  const held = ownerStatementCalc({ property, rules: null, bookings: [b(1), b(4, { financeMode: null, grossAmount: null })], expenses: [], tickets: [], month: '2026-09' });
  assert.match(held.hold.reason, /1 booking checked out this month need the guest total verified/); assert.equal(held.statement, null);
  assert.equal(held.groups[0].gross, 100000, 'figures still worked out over the verified bookings'); assert.equal(held.unverified.length, 1);
  const mixed = ownerStatementCalc({ property, rules: null, bookings: [b(1, { currency: 'ZAR' }), b(5)], expenses: [], tickets: [], month: '2026-09' });
  assert.match(mixed.hold.reason, /^Mixed currency/); assert.deepEqual(mixed.groups.map(g => g.currency).sort(), ['AED', 'ZAR'], 'one group per currency, never added');
  const r = incomeReport({ properties: [{ ...property, status: 'active' }], settings: [], bookings: [b(1, { currency: 'ZAR' }), b(5)], transactions: [], tickets: [], earnings: [], statements: [], owners: [] }, { month: '2026-09' });
  assert.deepEqual(r.totals.map(t => [t.currency, t.gross]), [['AED', 1000], ['ZAR', 1000]], 'totals per currency');
  assert.equal(r.properties[0].held.slice(0, 14), 'Mixed currency');
}

// ── Pure: per-currency boxes add up (Clifford, 12 Oct 2026): gross - Airbnb host fees = net payout;
// net payout - other deductions = management fee + owner share, no gap; the property's own fee %; date range;
// bookings with no gross or host fee counted and flagged; one box per property currency. ──
{
  const props = [{ id: 1, name: 'Dubai 15', currency: 'AED', status: 'active' }, { id: 2, name: 'Lofts 603', currency: 'AED', status: 'active' }, { id: 3, name: 'Lakeside', currency: 'ZAR', status: 'active' }];
  const settings = [{ propertyId: 1, managementFeePercent: '15' }, { propertyId: 2, managementFeePercent: '10' }, { propertyId: 3, managementFeePercent: '0' }];
  // net payout basis: gross 1000, host fee 150 -> net 850; fee 15 % = 127.50, owner 722.50 (no cleaning)
  const v = (id, propertyId, pct, extra = {}) => ({ id, propertyId, guestName: `G${id}`, status: 'checked_out', platform: 'airbnb', checkIn: '2026-09-02', checkOut: '2026-09-05', nights: 3, financeMode: 'inclusive-v1', grossAmount: '1000.00', vatAmount: '0', tourismFee: '0',
    channelAmount: '150.00', channelFees: '150.00', managementAmount: (850 * pct / 100).toFixed(2), cleaningFee: '0', ownerAmount: (850 - 850 * pct / 100).toFixed(2), ...extra });
  const bookings = [v(1, 1, 15), v(2, 2, 10, { checkIn: '2026-09-20', checkOut: '2026-09-25', nights: 5 }), v(3, 3, 0),
    { id: 4, propertyId: 1, guestName: 'Blank', status: 'checked_out', platform: 'airbnb', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, financeMode: null, grossAmount: null },
    { id: 5, propertyId: 3, guestName: 'Blank ZAR', status: 'checked_out', platform: 'airbnb', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, financeMode: null, grossAmount: null },
    { id: 6, propertyId: 1, guestName: 'Cancelled', status: 'cancelled', platform: 'airbnb', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, grossAmount: null }];
  const r = incomeReport({ properties: props, settings, bookings, transactions: [], tickets: [], earnings: [], statements: [], owners: [] }, { month: '2026-09' });
  const aed = r.totals.find(t => t.currency === 'AED'), zar = r.totals.find(t => t.currency === 'ZAR');
  assert.deepEqual(r.totals.map(t => t.currency), ['AED', 'ZAR'], 'a box per property currency');
  near(aed.gross, 2000, 'AED gross'); near(aed.airbnbFees, 300, 'AED Airbnb host fees'); near(aed.netPayout, 1700, 'AED net payout');
  near(aed.managementFee, 212.5, 'AED fee: 15 % + Lofts 10 %'); near(aed.ownerShare, 1487.5, 'AED owner share');
  near(aed.netPayout - aed.otherDeductions, aed.managementFee + aed.ownerShare, 'AED adds up'); near(aed.unexplained, 0, 'no gap');
  near(aed.expectedManagementFee, 212.5, 'fee from each property\'s own setting'); near(aed.feeDifference, 0, 'fee agrees with settings');
  assert.equal(aed.missingAmounts, 1, 'blank gross counted, cancelled not'); assert.equal(aed.bookings, 2); assert.equal(aed.nights, 8);
  assert.deepEqual(aed.range, { start: '2026-09-01', end: '2026-09-30', firstCheckIn: '2026-09-02', lastCheckOut: '2026-09-25' }, 'date range shown');
  assert.deepEqual(aed.propertyNames, ['Dubai 15', 'Lofts 603']);
  near(zar.managementFee, 0, 'Lakeside 0 %'); near(zar.ownerShare, 850, 'ZAR owner share'); assert.equal(zar.missingAmounts, 1); near(zar.unexplained, 0, 'ZAR adds up');
  // A booking carrying a fee the settings would not give is flagged, not hidden.
  const off = incomeReport({ properties: props.slice(0, 1), settings, bookings: [v(1, 1, 20)], transactions: [], tickets: [], earnings: [], statements: [], owners: [] }, { month: '2026-09' }).totals[0];
  near(off.feeDifference, 42.5, 'fee difference flagged'); near(off.unexplained, 0, 'still adds up');
  // Only blank bookings: the box still appears with its warning.
  const onlyBlank = incomeReport({ properties: props.slice(0, 1), settings, bookings: [bookings[3]], transactions: [], tickets: [], earnings: [], statements: [], owners: [] }, { month: '2026-09' });
  assert.equal(onlyBlank.totals[0].missingAmounts, 1, 'blank-only currency still shows a box');
}

// ── API: real statements vs Income per property ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-income-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3026', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, RESEND_API_KEY: 're_test_only', FX_FIXED_RATES: JSON.stringify({ USD: 3.6725, ZAR: 0.2, EUR: 4, GBP: 4.8 }) };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3026/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
// Maintenance tickets are completed "now" (UTC), so the test month is the current UTC month.
const M = new Date().toISOString().slice(0, 7);
const prev = (() => { const d = new Date(Date.UTC(Number(M.slice(0, 4)), Number(M.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); })();
const year = M.slice(0, 4);
const statementRow = (s) => ({ currency: s.currency, bookings: s.bookingsCount, nights: s.nightsOccupied, gross: s.grossRevenue, taxes: s.vatAmount + s.tourismFee, channelFees: s.platformFees, cleaning: s.cleaningCosts,
  expenses: s.maintenanceCosts + s.otherExpenses, managementFee: s.managementFee, ownerBalance: s.ownerPayout, paidByAirbnb: s.paidByAirbnb, ownerShare: s.ownerPayout + s.paidByAirbnb });
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Income Admin', email: 'income@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Owner One', phone: '+971500000001' }, 201);
  // Dubai property: VAT 5 %, tourism fee, Booking.com 15 %, management 20 %.
  const DXB = await api('/properties', 'POST', { name: 'Marina Two', unitNumber: 'M2', city: 'Dubai', country: 'UAE', currency: 'AED', bedrooms: 2, bedroomType: '2 Bedroom', ownerId: owner.id, managementFee: '20', cleaningFee: '200' }, 201);
  await api(`/accounting/settings/${DXB.id}`, 'PUT', { managementFeePercent: 20, platformFeeBookingCom: 15, tourismRate: 10, tourismEnabled: true, vatEnabled: true, vatPercent: 5 });
  const ZA = await api('/properties', 'POST', { name: 'Zar House', unitNumber: 'ZH', city: 'Gqeberha', currency: 'ZAR', bedrooms: 1, ownerId: owner.id }, 201);
  const UN = await api('/properties', 'POST', { name: 'Unverified Flat', unitNumber: 'UF', city: 'Dubai', currency: 'AED', bedrooms: 1, ownerId: owner.id }, 201);
  const NO = await api('/properties', 'POST', { name: 'No Owner Studio', unitNumber: 'NO', city: 'Gqeberha', currency: 'AED', bedrooms: 1 }, 201);
  const book = (p, ci, co, extra = {}) => api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${p.unitNumber} ${ci}`, platform: 'booking_com', checkIn: ci, checkOut: co, status: 'confirmed', ...extra }, 201);
  const verified = (p, ci, co, gross, extra = {}) => book(p, ci, co, { financeMode: 'inclusive-v1', grossAmount: gross, managementPercent: 20, cleaningFee: 200, dubaiCharges: p.id === DXB.id, channelPercent: 15, ...extra });
  await verified(DXB, `${M}-02`, `${M}-05`, 3300);
  await verified(DXB, `${M}-10`, `${M}-12`, 1500);
  await verified(DXB, `${prev}-20`, `${prev}-23`, 2100);
  await verified(ZA, `${M}-03`, `${M}-06`, 4000, { cleaningFee: 0 });
  await verified(NO, `${M}-03`, `${M}-04`, 500, { cleaningFee: 0 });
  await book(UN, `${M}-07`, `${M}-09`); // no guest total: unverified
  await verified(UN, `${M}-14`, `${M}-16`, 900, { cleaningFee: 0 });
  // Owner expense, owner-charged repair, company cost for a property and one not tied to a property.
  await api('/accounting/transactions', 'POST', { type: 'expense', amount: '120.50', date: `${M}-15`, category: 'Supplies', description: 'Towels', propertyId: DXB.id, allocation: 'owner' }, 201);
  const t = await api('/maintenance', 'POST', { propertyId: DXB.id, issue: 'Tap', priority: 'low' }, 201);
  await api(`/maintenance/${t.id}`, 'PATCH', { status: 'completed', chargeType: 'owner', cost: '75.25' });
  await api('/accounting/transactions', 'POST', { type: 'expense', amount: '40.00', date: `${M}-16`, category: 'Cleaning', description: 'Cleaner', propertyId: DXB.id, allocation: 'company', currency: 'AED' }, 201);
  await api('/accounting/transactions', 'POST', { type: 'expense', amount: '10.00', date: `${M}-16`, category: 'Other', description: 'Office', allocation: 'company', currency: 'AED' }, 201);

  // Read only: viewing income creates no statement.
  const before = (await api('/accounting/statements')).length;
  const pre = await api(`/reports/income?month=${M}`);
  assert.equal((await api('/accounting/statements')).length, before, 'Income per property never writes statements');
  await api('/reports/income?month=2026-13', 'GET', null, 400); await api('/reports/income?year=99', 'GET', null, 400);
  await api(`/reports/income/999999?month=${M}`, 'GET', null, 404);

  // Generate the month's statements; every generated statement equals its property's income row.
  const gen = await api('/accounting/statements/generate', 'POST', { month: M });
  const statements = (await api(`/accounting/statements?month=${M}`));
  const report = await api(`/reports/income?month=${M}`);
  assert.equal(report.period.month, M);
  const byId = id => report.properties.find(p => p.propertyId === id);
  const shown = (n, currency) => currency === 'ZAR' ? Math.round(Number(n) * 20) / 100 : Number(n);
  for (const s of statements) {
    const p = byId(s.propertyId); assert.ok(p, `property ${s.propertyId} listed`);
    assert.equal(p.rows.length, 1); const row = p.rows[0], exp = statementRow(s);
    for (const k of Object.keys(exp)) k === 'currency' ? assert.equal(row[k], 'AED') : (k === 'bookings' || k === 'nights') ? assert.equal(row[k], exp[k]) : near(row[k], shown(exp[k], s.currency), `${p.name} ${k} is the statement in dirhams #${s.id}`);
    assert.equal(p.estimate, false); assert.equal(p.statement.status, 'draft'); assert.equal(p.held, null);
  }
  const zaStmt = statements.find(s => s.propertyId === ZA.id);
  assert.equal(zaStmt.currency, 'ZAR'); assert.equal(Number(zaStmt.grossRevenue), 4000, 'stored statement stays ZAR');
  near(byId(ZA.id).rows[0].gross, 800, 'ZAR 4,000 displays as AED 800');
  for (const s of statements) { const p0 = pre.properties.find(p => p.propertyId === s.propertyId); near(p0.rows[0].ownerBalance, shown(s.ownerPayout, s.currency), `${p0.name} live = generated`); }
  assert.deepEqual(statements.map(s => s.propertyId).sort(), [DXB.id, ZA.id].sort(), 'statements for the verified owned properties');
  const dx = byId(DXB.id).rows[0];
  near(dx.expenses, 120.50 + 75.25, 'owner expense + owner repair'); assert.ok(dx.taxes > 0, 'VAT and tourism shown');
  near(dx.gross - dx.taxes - dx.channelFees - dx.cleaning - dx.expenses - dx.managementFee, dx.ownerShare, 'columns add up to the owner share');

  // Unverified bookings: marked as an estimate, not counted, and held for the same reason as the statement.
  const un = byId(UN.id);
  assert.equal(un.estimate, true); assert.equal(un.unverified.count, 1); assert.equal(un.rows[0].bookings, 1, 'only the verified booking is counted');
  assert.equal(un.held, gen.skipped.find(x => x.propertyId === UN.id).reason, 'same hold reason as Generate');
  // A property without an owner still shows its income (no statement).
  const no = byId(NO.id); assert.equal(no.hasOwner, false); near(no.rows[0].gross, 500, 'no-owner property gross'); assert.equal(no.statement.status, 'none');

  assert.deepEqual(report.totals.map(t => t.currency), ['AED']);
  const tot = report.totals[0];
  for (const k of ['gross', 'managementFee', 'ownerShare', 'companyNet', 'channelFees']) {
    const sum = report.properties.flatMap(p => p.rows).reduce((n, r) => n + Math.round(r[k] * 100), 0) / 100;
    near(tot[k], sum, `AED total ${k}`);
  }
  assert.equal(tot.unverifiedBookings, 1);
  const cs = await api(`/accounting/company-statement?start=${M}-01&end=${report.period.end}`);
  assert.deepEqual(cs.totals.map(t => t.currency), ['AED']);
  const rowsNet = report.properties.flatMap(p => p.rows).reduce((n, r) => n + Math.round(r.companyNet * 100), 0);
  const other = Math.round((report.companyOther[0]?.net || 0) * 100);
  near((rowsNet + other) / 100, cs.totals[0].net, 'net to company = company statement in dirhams');
  near(report.companyOther.find(o => o.currency === 'AED').net, -10, 'company cost not tied to a property shown separately');

  // Drill-in: bookings and entries for the month add up to the row; the unverified booking is an estimate.
  const d = await api(`/reports/income/${DXB.id}?month=${M}`);
  near(d.bookings.reduce((n, b) => n + b.grossAmount, 0), dx.gross, 'drill-in bookings = gross');
  near(d.ownerEntries.reduce((n, e) => n + e.amount, 0) + d.maintenance.reduce((n, e) => n + e.amount, 0), dx.expenses, 'drill-in entries = expenses');
  const du = await api(`/reports/income/${UN.id}?month=${M}`);
  assert.deepEqual(du.bookings.map(b => b.verified).sort(), [false, true]); assert.ok(du.bookings.find(b => !b.verified).estimate, 'estimate marked');

  // Published statement: the income row is that statement as stored.
  const dxs = statements.find(s => s.propertyId === DXB.id);
  await api(`/accounting/statements/${dxs.id}`, 'PATCH', { status: 'sent' });
  const after = (await api(`/reports/income?month=${M}`)).properties.find(p => p.propertyId === DXB.id);
  assert.equal(after.statement.status, 'sent'); near(after.rows[0].ownerBalance, dxs.ownerPayout, 'sent statement figures');
  assert.equal((await api(`/reports/income/${DXB.id}?month=${M}`)).publishedFigures, true);

  // Year view = sum of its months, per currency.
  const y = await api(`/reports/income?year=${year}`);
  assert.equal(y.period.kind, 'year');
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => api(`/reports/income?month=${year}-${String(i + 1).padStart(2, '0')}`)));
  for (const tot of y.totals) for (const k of ['gross', 'managementFee', 'ownerShare', 'bookings']) {
    const sum = months.flatMap(m => m.totals).filter(t => t.currency === tot.currency).reduce((n, t) => n + Math.round(t[k] * 100), 0) / 100;
    near(tot[k], sum, `year ${tot.currency} ${k} = sum of months`);
  }
  const yd = await api(`/reports/income/${DXB.id}?year=${year}`);
  assert.equal(yd.months.length, 12);

  await new Promise(r => setTimeout(r, 300));
  assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'nothing sent');
  console.log('PASS: income per property = owner statements (same calculation; published statements as stored), currencies separate, unverified marked as estimates and not counted, net to YallaStay = company statement, year = sum of months, read only');
} catch (e) { console.error(logs.slice(-3000)); console.error(e); process.exitCode = 1; } finally { child.kill('SIGTERM'); }
