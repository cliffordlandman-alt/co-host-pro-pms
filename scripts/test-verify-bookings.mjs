// Verify bookings screen API: list unverified bookings per checkout month (property/owner filters),
// dry-run preview through the same calculation as the save, booking-level channel commission.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-verify-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3015', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3015/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Verify Admin', email: 'verify@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const o1 = await api('/owners', 'POST', { name: 'Owner One' }, 201), o2 = await api('/owners', 'POST', { name: 'Owner Two' }, 201);
  const pA = await api('/properties', 'POST', { name: 'Alpha 1BR', unitNumber: 'A1', ownerId: o1.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const pB = await api('/properties', 'POST', { name: 'Beta House', unitNumber: 'B1', ownerId: o2.id, city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  await api(`/accounting/settings/${pA.id}`, 'PUT', { cleaningFee: 150, platformFeeAirbnb: 3 });
  const mk = (p, ci, co, extra = {}) => api('/reservations', 'POST', { propertyId: p.id, guestName: `Guest ${p.name} ${ci}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co, ...extra }, 201);
  const a1 = await mk(pA, '2026-09-02', '2026-09-05'), a2 = await mk(pA, '2026-09-10', '2026-09-12'), b1 = await mk(pB, '2026-09-20', '2026-09-23');
  await mk(pA, '2026-08-20', '2026-08-25');                                           // other month
  await mk(pA, '2026-09-15', '2026-09-18', { financeMode: 'inclusive-v1', grossAmount: 2000 });  // already verified
  const c = await mk(pB, '2026-09-25', '2026-09-27'); await api(`/reservations/${c.id}`, 'PATCH', { status: 'cancelled' });
  // Airbnb earnings shown for reference only (Airbnb Reservations export).
  await api('/reservations/' + a1.id, 'PATCH', { externalId: 'airbnb:HMVERIFY01' });
  await api('/airbnb-data/import', 'POST', { csv: ['"Confirmation code","Status","Guest name","Contact","# of adults","# of children","# of infants","Start date","End date","# of nights","Booked","Listing","Earnings"',
    '"HMVERIFY01","Past guest","Guest","","1","0","0","9/2/2026","9/5/2026","3","2026-08-01","Alpha 1BR","AED 900.00"'].join('\n') });

  let list = await api('/reservations/unverified?month=2026-09');
  assert.deepEqual(list.map(r => r.id).sort((x, y) => x - y), [a1.id, a2.id, b1.id], 'only unverified, not cancelled, checked out in the month');
  assert.deepEqual((await api(`/reservations/unverified?month=2026-09&propertyId=${pB.id}`)).map(r => r.id), [b1.id]);
  assert.deepEqual((await api(`/reservations/unverified?month=2026-09&ownerId=${o1.id}`)).map(r => r.id).sort((x, y) => x - y), [a1.id, a2.id]);
  const ra1 = list.find(r => r.id === a1.id);
  assert.equal(ra1.ownerName, 'Owner One'); assert.equal(ra1.defaults.cleaningFee, 150); assert.equal(ra1.defaults.channelPercent, 3);
  assert.deepEqual(ra1.channelEarnings.map(e => [e.currency, e.amount]), [['AED', 900]], 'Airbnb earnings shown alongside');
  assert.equal(list.find(r => r.id === b1.id).currency, 'ZAR');
  await api('/reservations/unverified?month=2026-13', 'GET', undefined, 400);

  // Preview = the save: same numbers, nothing written.
  const body = { grossAmount: '1200', cleaningFee: '150', channelCommissionPercent: '15.5', financeMode: 'inclusive-v1' };
  const pv = await api(`/reservations/${a1.id}/finance-preview`, 'POST', body);
  assert.equal(pv.ok, true); assert.equal(pv.channelPercent, 15.5);
  assert.equal((await api(`/reservations/${a1.id}`)).financeMode !== 'inclusive-v1', true, 'preview saves nothing');
  const saved = await api(`/reservations/${a1.id}`, 'PATCH', body);
  for (const k of ['grossAmount', 'revenue', 'vatAmount', 'tourismFee', 'channelPercent', 'channelAmount', 'managementAmount', 'ownerAmount', 'cleaningFee']) assert.equal(Number(saved[k]), pv[k], `preview matches save: ${k}`);
  assert.equal(pv.cleaningDeducted, true);
  const parts = Math.round((pv.vatAmount + pv.tourismFee + pv.channelAmount + pv.managementAmount + (pv.cleaningDeducted ? pv.cleaningFee : 0) + pv.ownerAmount) * 100);
  assert.equal(parts, 120000, 'breakdown adds back to the guest total');
  // The commission is kept on later edits of the verified booking.
  const edited = await api(`/reservations/${a1.id}`, 'PATCH', { grossAmount: '1300', financeMode: 'inclusive-v1' });
  assert.equal(edited.channelPercent, 15.5);
  // Without a commission, the property's fee settings apply (same path).
  const pv2 = await api(`/reservations/${a2.id}/finance-preview`, 'POST', { grossAmount: '800' });
  assert.equal(pv2.channelPercent, 3); assert.equal(pv2.cleaningFee, 150);
  // Invalid rows are reported, not saved.
  assert.equal((await api(`/reservations/${a2.id}/finance-preview`, 'POST', { grossAmount: '' })).ok, false);
  assert.match((await api(`/reservations/${a2.id}/finance-preview`, 'POST', { grossAmount: '100', channelCommissionPercent: '120' })).error, /between 0 and 100/);
  assert.match((await api(`/reservations/${a2.id}/finance-preview`, 'POST', { grossAmount: '100', channelCommissionPercent: 'abc' })).error, /percentage/);
  await api(`/reservations/${a2.id}`, 'PATCH', { grossAmount: '100', channelCommissionPercent: 'abc', financeMode: 'inclusive-v1' }, 400);
  list = await api('/reservations/unverified?month=2026-09');
  assert.deepEqual(list.map(r => r.id).sort((x, y) => x - y), [a2.id, b1.id], 'a verified booking leaves the list');
  // A month with a published statement is flagged as locked.
  await api(`/reservations/${a2.id}`, 'PATCH', { grossAmount: '800', financeMode: 'inclusive-v1' });
  const gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  const stA = gen.statements.find(s => s.propertyId === pA.id); assert.ok(stA, 'statement generated once all of the property\'s bookings are verified');
  console.log('PASS: unverified list per month with property/owner filters and Airbnb earnings; preview equals save (one calculation); booking commission kept; invalid rows rejected; statement then generates');
} catch (e) { console.error(e); console.error(logs.slice(-2500)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
