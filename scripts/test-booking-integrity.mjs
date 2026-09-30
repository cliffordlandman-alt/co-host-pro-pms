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

  console.log('PASS: ' + passed.join('; '));
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
