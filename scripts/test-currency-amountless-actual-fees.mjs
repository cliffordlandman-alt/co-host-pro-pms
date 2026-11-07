// (1) A property currency change stamps the old currency only on bookings with recorded amounts; amount-less
// bookings (calendar stays waiting for figures) follow the new currency. (2) The breakdown import compares a
// linked booking with ITS currency (a stamped AED booking never receives ZAR amounts). (3) Bookings verified from a
// breakdown use Airbnb's actual fees on the standard basis (owner share, statement, Income), never the channel %.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bookingFinance } from '../lib/booking-finance.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Unit: standard basis with and without actual fees ──
const est = bookingFinance({ total: '132.30', managementPercent: 0, cleaningFee: 0, nights: 1, rooms: 1, dubai: false, channelPercent: 3 });
assert.equal(est.channelAmount, 3.97); assert.equal(est.ownerAmount, 128.33);
const act = bookingFinance({ total: '132.30', managementPercent: 0, cleaningFee: 0, nights: 1, rooms: 1, dubai: false, channelPercent: 3, channelFees: '21.54' });
assert.equal(act.channelAmount, 21.54); assert.equal(act.ownerAmount, 110.76); assert.equal(act.channelFees, 21.54); assert.equal(act.feeBasis, null);
const mg = bookingFinance({ total: '1000.00', managementPercent: 15, cleaningFee: 0, nights: 2, rooms: 1, dubai: false, channelPercent: 3, channelFees: '155.00' });
assert.equal(mg.managementAmount, 150); assert.equal(mg.ownerAmount, 695, 'management % of revenue, actual fees as the channel line');
assert.throws(() => bookingFinance({ total: '100.00', managementPercent: 0, nights: 1, rooms: 1, dubai: false, channelFees: '150.00' }), /exceed/);

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-amountless-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3027', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, RESEND_API_KEY: 're_test_only', FX_FIXED_RATES: JSON.stringify({ USD: 3.6725, ZAR: 0.2, EUR: 4, GBP: 4.8 }) };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3027/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const H = 'confirmation_code,listing_name,guest_name,check_in,checkout,nights,status,guest_paid_total,accommodation_total,cleaning_fee,guest_service_fee,host_service_fee,taxes,tax_types,other_fees,cohost_payout,cohost_payout_to,host_payout,currency,payout_date,source,notes';
const L = (code, listing, ci, co, total, hostFee, payout, cur) => [code, listing, 'G', ci, co, '2', 'past guest', total, total, '', '0.00', hostFee, '', '', '', '', '', payout, cur, '', 'reservation details page', ''].join(',');
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Amt Admin', email: 'amt@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const GL = await api('/properties', 'POST', { name: 'Green Lawn Test', unitNumber: 'GL', city: 'Gqeberha', currency: 'AED', bedrooms: 3 }, 201);
  await api(`/accounting/settings/${GL.id}`, 'PUT', { managementFeePercent: 0, includeCleaning: false });
  const mk = async (p, ci, co, code, total) => {
    const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code || ci}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co }, 201);
    if (code) await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` });
    return total ? api(`/reservations/${b.id}`, 'PATCH', { grossAmount: total, financeMode: 'inclusive-v1', cleaningFee: '0' }) : api(`/reservations/${b.id}`);
  };
  const empty = await mk(GL, '2026-09-11', '2026-09-13', 'HMEMPTY001');
  const withAmt = await mk(GL, '2026-09-01', '2026-09-03', 'HMAMOUNT01', '900.00');
  const manual = await mk(GL, '2026-09-20', '2026-09-22', null, '500.00');   // entered by hand, no code yet
  // (1) Only the booking with amounts keeps AED.
  const ch = await api(`/accounting/settings/${GL.id}`, 'PUT', { currency: 'ZAR' });
  assert.equal(ch.currencyChange.bookingsKeptInOldCurrency, 2); assert.equal(ch.currencyChange.bookingsFollowingNewCurrency, 1);
  assert.equal((await api(`/reservations/${empty.id}`)).currency, 'ZAR', 'amount-less booking follows the new currency');
  assert.equal((await api(`/reservations/${withAmt.id}`)).currency, 'AED', 'booking with amounts keeps AED');
  assert.equal((await api(`/reservations/${manual.id}`)).currency, 'AED');
  // A booking with a linked payment but no other amounts also keeps the old currency.
  const P2 = await api('/properties', 'POST', { name: 'Paid Place', unitNumber: 'PP', city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const pb = await mk(P2, '2026-09-05', '2026-09-07', 'HMPAID0001');
  await api('/payments', 'POST', { reservationId: pb.id, propertyId: P2.id, amount: '100', method: 'cash', status: 'completed', paymentDate: '2026-09-05' }, 201);
  const ch2 = await api(`/accounting/settings/${P2.id}`, 'PUT', { currency: 'ZAR' });
  assert.equal(ch2.currencyChange.bookingsKeptInOldCurrency, 1, 'a booking with a payment keeps its currency');

  // (2) ZAR row for the amount-less booking: applies. ZAR row linking the stamped AED booking: blocked.
  const csv = [H, L('HMEMPTY001', 'Green Lawn Test', '2026-09-11', '2026-09-13', '2543.80', '453.43', '2090.37', 'ZAR'),
    L('HMNEWLINK1', 'Green Lawn Test', '2026-09-20', '2026-09-22', '600.00', '90.00', '510.00', 'ZAR')].join('\n');
  const pv = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv });
  const rE = pv.rows.find(r => r.code === 'HMEMPTY001'), rL = pv.rows.find(r => r.code === 'HMNEWLINK1');
  assert.deepEqual(rE.blocking, []); assert.equal(rE.bulkOk, true); assert.equal(rE.currencyExpected, 'ZAR');
  assert.equal(rL.action, 'link'); assert.equal(rL.currencyExpected, 'AED');
  assert.ok(rL.blocking.some(m => /File currency ZAR differs from the booking's AED/.test(m)), 'stamped AED booking never receives ZAR amounts');
  const ap = await api('/reservations/airbnb-breakdowns/apply', 'POST', { csv, fileName: 't.csv', codes: ['HMEMPTY001', 'HMNEWLINK1'] });
  assert.equal(ap.results.HMEMPTY001.ok, true); assert.equal(ap.results.HMNEWLINK1.ok, false);
  const m = await api(`/reservations/${manual.id}`);
  assert.equal(m.externalId, null); assert.equal(m.currency, 'AED'); assert.equal(m.grossAmount, 500);

  // (3) Actual Airbnb fees on the standard basis.
  const v = await api(`/reservations/${empty.id}`);
  assert.equal(v.currency, 'ZAR'); assert.equal(v.financeMode, 'inclusive-v1');
  assert.equal(Number(v.channelAmount), 453.43); assert.equal(Number(v.ownerAmount), 2090.37, 'owner = guest total − Airbnb fees (0% management, no cleaning)');
  // Re-running the same file changes nothing.
  const again = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv });
  assert.equal(again.rows.find(r => r.code === 'HMEMPTY001').action, 'none');
  // Income per property and the owner statement use the actual fees.
  const inc = await api('/reports/income?month=2026-09');
  const shown = inc.properties.find(p => p.propertyId === GL.id).rows[0];
  assert.equal(shown.currency, 'AED');
  const stay = (await api('/reservations')).filter(b => b.propertyId === GL.id && b.financeMode === 'inclusive-v1');
  const asAed = (n, c) => Math.round(Number(n) * (c === 'ZAR' ? 0.2 : 1) * 100) / 100;
  assert.equal(shown.channelFees, stay.reduce((n, b) => n + asAed(b.channelAmount, b.currency), 0));
  assert.equal(shown.ownerShare, stay.reduce((n, b) => n + asAed(b.ownerAmount, b.currency), 0), 'dirham total of each booking, ZAR at 0.2');
  assert.equal(Number((await api(`/reservations/${empty.id}`)).channelAmount), 453.43, 'stored ZAR fees are not rewritten');
  // Unverified bookings still get no figures (the estimate is only for them).
  const GR = await api('/properties', 'POST', { name: 'Garden Test', unitNumber: 'GT', city: 'Gqeberha', currency: 'AED', bedrooms: 1 }, 201);
  await api(`/accounting/settings/${GR.id}`, 'PUT', { managementFeePercent: 0, includeCleaning: false });
  const own = await api('/owners', 'POST', { name: 'Test Owner', phone: '+27000000000' }, 201);
  await api(`/properties/${GR.id}`, 'PATCH', { ownerId: own.id });
  const gs = [['HMG0000001', '2026-08-31', '2026-09-01', '132.30', '21.54', '110.76'], ['HMG0000002', '2026-09-03', '2026-09-05', '274.40', '44.66', '229.74']];
  for (const [c, ci, co] of gs) await mk(GR, ci, co, c);
  const gcsv = [H, ...gs.map(([c, ci, co, t, f, p]) => L(c, 'Garden Test', ci, co, t, f, p, 'AED'))].join('\n');
  const gp = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv: gcsv });
  assert.equal(gp.summary.clean, 2);
  await api('/reservations/airbnb-breakdowns/apply', 'POST', { csv: gcsv, fileName: 'g.csv', codes: gp.rows.map(r => r.code) });
  const gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  assert.ok(!gen.skipped.some(s => s.propertyId === GR.id), JSON.stringify(gen.skipped));
  const st = (await api('/accounting/statements?month=2026-09')).find(s => s.propertyId === GR.id);
  assert.equal(st.grossRevenue, 406.7); assert.equal(st.platformFees, 66.2); assert.equal(st.ownerPayout, 340.5, 'statement owner share = gross − actual Airbnb fees');
  console.log('PASS currency (amount-less follow the new currency), link currency check, actual Airbnb fees');
} finally {
  child.kill();
  if (process.exitCode) console.log(logs.slice(-3000));
}
