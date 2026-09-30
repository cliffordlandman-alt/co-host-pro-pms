// Data-integrity regression checks against an isolated API instance.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-integrity-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3006', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle') };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3006/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const passed = [];
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Integrity', email: 'integrity@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Integrity Owner' }, 201);
  const p = await api('/properties', 'POST', { name: 'Integrity 1BR', unitNumber: 'I-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED' }, 201);
  const base = { propertyId: p.id, guestName: 'Ledger Guest', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, managementPercent: 20, cleaningFee: 0, dubaiCharges: true, channelPercent: 0 };
  const ledger = async id => (await api('/payments')).filter(x => x.reservationId === id).reduce((n, x) => n + (x.type === 'guest_refund' ? -x.amount : x.type === 'guest_payment' ? x.amount : 0), 0);

  // Payments ledger always equals what the booking says was paid.
  const b = await api('/reservations', 'POST', { ...base, checkIn: '2030-01-01', checkOut: '2030-01-03' }, 201);
  await api(`/reservations/${b.id}`, 'PATCH', { paymentStatus: 'partial', balanceDue: 600 });
  assert.equal(await ledger(b.id), 400);
  await api(`/reservations/${b.id}`, 'PATCH', { paymentStatus: 'paid' });
  assert.equal(await ledger(b.id), 1000);
  await api(`/reservations/${b.id}`, 'PATCH', { paymentStatus: 'pending' });
  assert.equal(await ledger(b.id), 0, 'reversal recorded when status is set back');
  await api('/payments', 'POST', { type: 'guest_payment', reservationId: b.id, amount: 250, status: 'paid' }, 201);
  const after = await api(`/reservations/${b.id}`);
  assert.equal(await ledger(b.id), 1000 - after.balanceDue);
  const paidAtCreate = await api('/reservations', 'POST', { ...base, checkIn: '2030-02-01', checkOut: '2030-02-03', paymentStatus: 'paid' }, 201);
  assert.equal(await ledger(paidAtCreate.id), 1000, 'booking created as paid has its payment posted');
  passed.push('payments ledger = booking paid amount');

  // Revenue by channel ignores unverified legacy amounts, blocked dates and other currencies.
  const zarProp = await api('/properties', 'POST', { name: 'Cape Town 1BR', unitNumber: 'Z-1', ownerId: owner.id, bedrooms: 1, city: 'Cape Town', currency: 'ZAR' }, 201);
  await api('/reservations', 'POST', { propertyId: p.id, guestName: 'Legacy amount', platform: 'direct', checkIn: '2030-03-01', checkOut: '2030-03-03', revenue: 5000, paymentStatus: 'unknown', status: 'confirmed' }, 201);
  await api('/reservations', 'POST', { propertyId: p.id, guestName: 'Owner block', platform: 'direct', checkIn: '2030-04-01', checkOut: '2030-04-03', revenue: 0, status: 'blocked', paymentStatus: 'unknown' }, 201);
  await api('/reservations', 'POST', { ...base, propertyId: zarProp.id, dubaiCharges: false, checkIn: '2030-01-01', checkOut: '2030-01-03' }, 201);
  const verifiedAed = (await api('/reservations')).filter(r => r.financeMode === 'inclusive-v1' && r.propertyId === p.id && r.status !== 'cancelled').reduce((n, r) => n + Math.round(r.revenue * 100), 0) / 100;
  const direct = (await api('/platforms')).platforms.find(x => x.key === 'direct');
  assert.equal(direct.revenue, verifiedAed); assert.equal(direct.unverifiedBookings, 2);
  assert.equal(direct.bookings, 4, 'blocked dates are not bookings');
  const split = (await api('/reports/platforms')).find(x => x.platform === 'direct');
  assert.equal(split.revenue, verifiedAed); assert.equal(split.count, 4);
  const pnl = await api('/reports/pnl');
  assert.equal(pnl.find(x => x.propertyId === p.id).revenue, verifiedAed); assert.equal(pnl.find(x => x.propertyId === zarProp.id).currency, 'ZAR');
  passed.push('channel/P&L revenue = verified, per currency, no blocks');

  // History is never destroyed by deletes; empty records can still be removed.
  await api(`/properties/${p.id}`, 'DELETE', undefined, 409);
  await api(`/owners/${owner.id}`, 'DELETE', undefined, 409);
  const spare = await api('/properties', 'POST', { name: 'Spare', unitNumber: 'S-1' }, 201);
  await api(`/accounting/settings/${spare.id}`, 'PUT', { managementFeePercent: 15 }, 201);
  await api(`/properties/${spare.id}`, 'DELETE', undefined, 204);
  const cleaner = await api('/staff', 'POST', { name: 'Has history', role: 'cleaner', active: true }, 201);
  const task = (await api('/cleaning')).find(t => t.reservationId === b.id);
  await api(`/cleaning/${task.id}`, 'PATCH', { assignedToId: cleaner.id });
  await api(`/staff/${cleaner.id}`, 'DELETE', undefined, 409);
  await api(`/staff/${cleaner.id}`, 'PATCH', { active: false });
  await api(`/staff/${cleaner.id}`, 'PATCH', { id: 999 }, 400);
  await api(`/owners/${owner.id}`, 'PATCH', { id: 999 }, 400);
  const lonely = await api('/owners', 'POST', { name: 'No properties' }, 201);
  await api(`/owners/${lonely.id}`, 'DELETE', undefined, 204);
  passed.push('deletes keep history; owner/staff edits validated');

  // Administrator can reset a staff password; old password stops working.
  const u = await api('/users', 'POST', { name: 'Forgetful', email: 'forgetful@example.invalid', password: 'Old-pass-6284!', role: 'operations' }, 201);
  await api(`/users/${u.id}`, 'PATCH', { password: 'short' }, 400);
  await api(`/users/${u.id}`, 'PATCH', { password: 'New-pass-6284!' });
  await api('/auth/login', 'POST', { email: u.email, password: 'Old-pass-6284!' }, 401);
  await api('/auth/login', 'POST', { email: u.email, password: 'New-pass-6284!' });
  passed.push('admin password reset');
  // A cleaner whose staff profile email was typed with capitals can still see their tasks.
  await api('/users', 'POST', { name: 'Case Cleaner', email: 'Case.Cleaner@Example.invalid', password: 'Clean-only-6284!', role: 'cleaner' }, 201);
  const cs = await api('/staff', 'POST', { name: 'Case Cleaner', email: 'Case.Cleaner@Example.invalid', role: 'cleaner', active: true }, 201);
  const b2 = await api('/reservations', 'POST', { ...base, checkIn: '2030-05-01', checkOut: '2030-05-03' }, 201);
  const t2 = (await api('/cleaning')).find(t => t.reservationId === b2.id);
  await api(`/cleaning/${t2.id}`, 'PATCH', { assignedToId: cs.id });
  const admin = token;
  token = (await api('/auth/login', 'POST', { email: 'case.cleaner@example.invalid', password: 'Clean-only-6284!' })).token;
  assert.equal((await api('/cleaning')).length, 1);
  await api(`/cleaning/${t2.id}`, 'PATCH', { status: 'in_progress' });
  token = admin;
  passed.push('cleaner email case-insensitive');

  console.log('PASS: ' + passed.join('; '));
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
