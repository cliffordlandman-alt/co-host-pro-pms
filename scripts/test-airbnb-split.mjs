// Full Airbnb earnings on Income per property: for co-host-payout properties, total Airbnb earnings, the co-host
// payout (owner's share, paid by Airbnb) and the company's share side by side, per booking and per currency, each
// marked paid or expected. Grey House: the export amount is before the co-host cut (the negative co-host line is
// paid). Green Lawn / JVC Penthouse: the co-host payout only comes from the breakdown, so it is expected. Lakeside:
// no co-host line, the payout went to the owner's own bank, so no company share is shown. Currencies never mix.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { airbnbSplit, addSplitTotals } from '../lib/airbnb-split.mjs';
import { parsePayoutFile } from '../lib/payout-recon.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const EH = 'listing_name,confirmation_code,guest_name,check_in,checkout,cohost_payout,cohost_payout_to,host_payout,currency,payout_status,payout_date,notes';
const earnings = [EH,
  'Grey Test,HMGREY0001,Cat,2026-09-03,2026-09-06,-1942.83,Dylan (expected),2285.69,ZAR,paid,2026-09-04,Export rows: Co-Host payout -1942.83 + Reservation 2285.69',
  'Lawn Test,HMLAWN0001,Bea,2026-09-11,2026-09-14,1776.81,Dylan (expected),313.56,ZAR,paid,2026-09-12,"Export rows: Co-Host payout 313.56; Export has only a positive \'Co-Host payout\' row"',
  'Lawn Test,HMLAWN0002,Gus,2026-09-28,2026-09-30,6149.09,Dylan (expected),1085.14,ZAR,upcoming,2026-10-05,Export rows: Co-Host payout 1085.14',
  'Lawn Test,HMLAWN0003,Ida,2026-09-01,2026-09-02,,,351.23,ZAR,paid,2026-09-02,Export rows: Co-Host payout 351.23; not in reservation_breakdowns.csv',
  'Penthouse Test,HMPENT0001,Jo,2026-09-20,2026-09-25,,,180.33,AED,paid,2026-09-21,Export rows: Co-Host payout 180.33; Export has only a positive \'Co-Host payout\' row',
  'Lake Test,HMLAKE0001,Eve,2026-09-10,2026-09-13,,,3719.24,ZAR,paid,2026-09-11,"Export rows: Reservation 3719.24; File has no Co-Host payout row; paid out via Transfer to Atj Fourie"',
].join('\n');
const lines = parsePayoutFile(earnings).lines;
const period = { start: '2026-09-01', end: '2026-09-30' };
const P = (id, name, currency) => ({ id, name, currency });
const bk = (id, propertyId, code, checkIn, checkOut, extra = {}) => ({ id, propertyId, externalId: code ? `airbnb:${code}` : null, guestName: `G${id}`, platform: 'airbnb', status: 'confirmed', checkIn, checkOut, ...extra });
// ── Pure ──
{
  const grey = airbnbSplit({ property: P(1, 'Grey Test', 'ZAR'), rules: { cohostPaidToOwner: true }, bookings: [bk(1, 1, 'HMGREY0001', '2026-09-03', '2026-09-06')], lines, period });
  assert.deepEqual(grey.rows.map(r => [r.total, r.cohostPayout, r.cohostBasis, r.company, r.companyBasis]), [[2285.69, 1942.83, 'paid', 342.86, 'paid']], 'Grey House: total before the cut, co-host paid, company = the rest');
  const lawn = airbnbSplit({ property: P(2, 'Lawn Test', 'ZAR'), rules: { cohostPaidToOwner: true }, bookings: [bk(2, 2, 'HMLAWN0001', '2026-09-11', '2026-09-14'), bk(3, 2, 'HMLAWN0002', '2026-09-28', '2026-09-30'), bk(4, 2, 'HMLAWN0003', '2026-09-01', '2026-09-02')], lines, period });
  const row = c => lawn.rows.find(r => r.code === c);
  assert.deepEqual([row('HMLAWN0001').total, row('HMLAWN0001').cohostPayout, row('HMLAWN0001').cohostBasis, row('HMLAWN0001').company], [2090.37, 1776.81, 'expected', 313.56], 'Green Lawn: owner share from the breakdown is expected, not paid');
  assert.equal(row('HMLAWN0002').companyBasis, 'upcoming');
  assert.equal(row('HMLAWN0003').cohostPayout, null, 'no co-host figure anywhere: not known, never 0'); assert.equal(row('HMLAWN0003').total, null); assert.match(row('HMLAWN0003').reason, /isn't known/);
  assert.deepEqual(lawn.totals, [{ currency: 'ZAR', bookings: 3, total: 9324.6, cohostPayout: 7925.9, cohostPaid: 0, cohostExpected: 7925.9, company: 1749.93, companyPaid: 664.79, companyNotYet: 1085.14, cohostUnknown: 1 }]);
  // Not switched on in Fee settings, but the files show co-host payouts: shown, with a note.
  const pent = airbnbSplit({ property: P(3, 'Penthouse Test', 'AED'), rules: { cohostPaidToOwner: false }, bookings: [], lines, period });
  assert.equal(pent.settingOn, false); assert.equal(pent.fileHasCohost, true); assert.equal(pent.rows[0].inYallaPMS, false, 'a payout with no YallaPMS booking still counts toward full earnings');
  assert.equal(airbnbSplit({ property: P(4, 'Lake Test', 'ZAR'), rules: {}, bookings: [bk(5, 4, 'HMLAKE0001', '2026-09-10', '2026-09-13')], lines, period }), null, 'Lakeside: no co-host line, so no company share shown');
  assert.equal(airbnbSplit({ property: P(5, 'Plain', 'AED'), rules: {}, bookings: [], lines, period }), null, 'not a co-host-payout property');
  // Verified booking, no files: total = guest paid − Airbnb fees; company = total − co-host payout (expected).
  const ver = airbnbSplit({ property: P(6, 'Verified', 'AED'), rules: { cohostPaidToOwner: true }, bookings: [bk(6, 6, 'HMVER00001', '2026-09-05', '2026-09-08', { financeMode: 'inclusive-v1', grossAmount: '1000.00', channelFees: '150.00', cohostPayout: '600.00' }), bk(7, 6, 'HMVER00002', '2026-09-09', '2026-09-10')], lines: [], period });
  assert.deepEqual(ver.rows.map(r => [r.known, r.total, r.cohostPayout, r.company, r.source]), [[true, 850, 600, 250, 'verified booking'], [false, undefined, undefined, undefined, undefined]]);
  assert.equal(ver.withoutFigures, 1);
  // Totals per currency over properties; AED and ZAR stay apart.
  const all = addSplitTotals([grey, lawn, pent, ver]);
  assert.deepEqual(all.map(t => [t.currency, t.properties, t.total, t.cohostPayout, t.company]), [['AED', 2, 850, 600, 430.33], ['ZAR', 2, 11610.29, 9868.73, 2092.79]]);
}

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-split-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3031', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', FX_FIXED_RATES: JSON.stringify({ USD: 3.6725, ZAR: 0.2, EUR: 4, GBP: 4.8 }) };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3031/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Split Admin', email: 'split@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Dylan' }, 201);
  const G = await api('/properties', 'POST', { name: 'Grey Test', unitNumber: 'G1', ownerId: owner.id, city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const L = await api('/properties', 'POST', { name: 'Lawn Test', unitNumber: 'L1', ownerId: owner.id, city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const K = await api('/properties', 'POST', { name: 'Lake Test', unitNumber: 'K1', city: 'Cape Town', country: 'South Africa', currency: 'ZAR', bedrooms: 3 }, 201);
  await api(`/accounting/settings/${G.id}`, 'PUT', { cohostPaidToOwner: true });
  const mk = async (p, code, ci, co) => { const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co }, 201); await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` }); return b; };
  await mk(G, 'HMGREY0001', '2026-09-03', '2026-09-06'); await mk(L, 'HMLAWN0001', '2026-09-11', '2026-09-14'); await mk(K, 'HMLAKE0001', '2026-09-10', '2026-09-13');
  assert.deepEqual((await api('/reports/income?month=2026-09')).airbnbSplit.map(s => s.name), ['Grey Test'], 'before any file: only the property switched on (its booking has no figures yet)');
  await api('/accounting/payout-check/import', 'POST', { csv: earnings, fileName: 'cohost_earnings.csv' });
  const rep = await api('/reports/income?month=2026-09');
  assert.deepEqual(rep.airbnbSplit.map(s => s.name), ['Grey Test', 'Lawn Test'], 'Lakeside not shown');
  assert.ok(rep.airbnbSplit.every(s => s.rows === undefined), 'list page gets totals only');
  const aed = rep.airbnbSplitTotals.find(t => t.currency === 'AED');
  const dirham = n => Math.round(n * 20) / 100;
  assert.deepEqual([aed.properties, aed.total, aed.cohostPaid, aed.cohostExpected, aed.company, aed.companyNotYet, aed.cohostUnknown], [2, dirham(11610.29), dirham(1942.83), dirham(7925.9), dirham(2092.79), dirham(1085.14), 1]);
  assert.equal(rep.airbnbSplitTotals.length, 1, 'ZAR and any other currency are shown together in dirhams');
  const det = await api(`/reports/income/${L.id}?month=2026-09`);
  assert.equal(det.airbnbSplit.settingOn, false); assert.ok(det.airbnbSplit.rows.some(r => r.code === 'HMLAWN0003' && !r.inYallaPMS && r.cohostPayout === null));
  assert.equal((await api(`/reports/income/${K.id}?month=2026-09`)).airbnbSplit, null);
  const year = await api(`/reports/income/${G.id}?year=2026`);
  assert.equal(year.airbnbSplit.totals[0].currency, 'AED');
  assert.equal(year.airbnbSplit.totals[0].company, Math.round(342.86 * 20) / 100, 'year view in dirhams');
  console.log('OK full Airbnb earnings split on Income per property');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
