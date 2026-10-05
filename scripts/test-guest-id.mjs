// Guest ID rule: Airbnb bookings are ID-verified by the channel; Booking.com and direct stay pending until collected.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { guestIdComplete, guestIdLabel, idVerifiedByChannel, dtcmPassportNeeded } from '../lib/guest-id.mjs';

// Pure rule
for (const status of ['confirmed', 'checked_in', 'checked_out']) for (const paymentStatus of ['paid', 'unknown', 'pending']) {
  const b = { platform: 'airbnb', status, paymentStatus, idCollected: false };
  assert.equal(guestIdComplete(b), true, `airbnb ${status}/${paymentStatus} is verified by the channel`);
  assert.equal(guestIdLabel(b), 'Verified by Airbnb');
}
for (const platform of ['booking_com', 'direct', 'expedia']) {
  assert.equal(guestIdComplete({ platform, status: 'confirmed', paymentStatus: 'paid' }), false, `${platform} stays pending`);
  assert.equal(guestIdLabel({ platform }), 'ID pending');
  assert.equal(guestIdLabel({ platform, idCollected: true }), 'ID collected');
}
assert.equal(guestIdLabel({ platform: 'airbnb', idCollected: true }), 'ID collected', 'a collected ID wins over the channel label');
assert.equal(idVerifiedByChannel({ platform: 'booking_com' }), null);
const dubai = { city: 'Dubai' }, capeTown = { city: 'Cape Town' };
assert.equal(dtcmPassportNeeded({ platform: 'airbnb', status: 'confirmed' }, dubai), true, 'Dubai Airbnb stay: DTCM passport reminder');
assert.equal(dtcmPassportNeeded({ platform: 'airbnb', status: 'confirmed' }, capeTown), false, 'not outside Dubai');
assert.equal(dtcmPassportNeeded({ platform: 'airbnb', status: 'confirmed', idCollected: true }, dubai), false, 'cleared once the passport is collected');
assert.equal(dtcmPassportNeeded({ platform: 'airbnb', status: 'cancelled' }, dubai), false);
assert.equal(dtcmPassportNeeded({ platform: 'booking_com', status: 'confirmed' }, dubai), false, 'Booking.com already shows ID pending');

// Task Centre uses the same rule (isolated API instance)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-guestid-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3008', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle') };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3008/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Guest ID', email: 'guestid@example.invalid', password: 'Test-only-5173!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'ID Owner' }, 201);
  const p = await api('/properties', 'POST', { name: 'ID 1BR', unitNumber: 'G-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED' }, 201);
  const mk = (platform, d) => api('/reservations', 'POST', { propertyId: p.id, guestName: `${platform} guest`, platform, status: 'confirmed', checkIn: `2031-05-${d}`, checkOut: `2031-05-${Number(d) + 2}` }, 201);
  const air = await mk('airbnb', '10'), bdc = await mk('booking_com', '13'), dir = await mk('direct', '16');
  const tasks = await api('/task-centre');
  const list = Array.isArray(tasks) ? tasks : tasks.tasks;
  const idTask = id => list.some(t => t.id === `id-${id}`);
  assert.equal(idTask(air.id), false, 'no Guest ID task for an Airbnb booking');
  assert.equal(idTask(bdc.id), true, 'Booking.com booking still needs ID');
  assert.equal(idTask(dir.id), true, 'direct booking still needs ID');
  const stored = await api(`/reservations/${air.id}`);
  assert.equal(Boolean(stored.idCollected), false, 'no ID record is written for channel verification');
  console.log('PASS: Airbnb = Verified by Airbnb (any payment status); Booking.com/direct pending; DTCM passport note Dubai-only; Task Centre follows the rule; no ID record written');
} catch (e) { console.error(e); console.error(logs.slice(-3000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
