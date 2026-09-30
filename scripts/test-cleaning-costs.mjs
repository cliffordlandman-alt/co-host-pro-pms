// Cleaning costs: rate card, automatic expense on completion, idempotent 30-day backfill.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-cleaning-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3007', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle') };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200, auth = token) {
  const r = await fetch('http://127.0.0.1:3007/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const dubai = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(d);
const today = dubai(new Date());
const shift = n => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Cost Admin', email: 'costs@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const card = await api('/accounting/cleaning-costs');
  assert.deepEqual(card.rates.map(r => [r.label, r.amount, r.currency]), [['Studio', 140, 'AED'], ['1BR', 180, 'AED'], ['2BR', 250, 'AED'], ['3BR', 290, 'AED'], ['4BR', 350, 'AED']]);
  assert.equal(card.vendor.name, 'Cleaning company');
  const owner = await api('/owners', 'POST', { name: 'Cost Owner' }, 201);
  const mk = (name, extra) => api('/properties', 'POST', { name, unitNumber: name, ownerId: owner.id, city: 'Dubai', currency: 'AED', ...extra }, 201);
  const studio = await mk('Studio A', { bedrooms: 0, bedroomType: 'Studio' });
  const one = await mk('One Bed', { bedrooms: 1 });
  const three = await mk('Three Bed', { bedrooms: 3 });
  const five = await mk('Five Bed', { bedrooms: 5 });
  const typed = await mk('Typed 2 Bedroom', { bedrooms: 0, bedroomType: '2 Bedroom' });
  await api(`/accounting/settings/${three.id}`, 'PUT', { cleaningCostOverride: 300 });
  const book = (p, checkIn, checkOut, extra = {}) => api('/reservations', 'POST', { propertyId: p.id, guestName: `Guest ${p.name}`, platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 2000, cleaningFee: 150, checkIn, checkOut, paymentStatus: 'unknown', ...extra }, 201);
  await book(studio, shift(-12), shift(-10));
  await book(one, shift(-6), shift(-3));
  await book(three, shift(-3), shift(0));
  await book(five, shift(-5), shift(-2));
  await book(typed, shift(-9), shift(-7));
  const cancelled = await book(one, shift(-20), shift(-18));
  await api(`/reservations/${cancelled.id}`, 'PATCH', { status: 'cancelled' });
  await book(studio, shift(-40), shift(-35));      // outside the 30-day window
  const future = await book(studio, shift(3), shift(5));

  const preview = await api('/accounting/cleaning-expenses/backfill', 'POST', { days: 30, dryRun: true });
  const byProp = Object.fromEntries(preview.items.map(i => [i.property, i]));
  assert.equal(preview.from, shift(-30)); assert.equal(preview.to, today);
  assert.deepEqual([byProp['Studio A'].amount, byProp['One Bed'].amount, byProp['Three Bed'].amount, byProp['Typed 2 Bedroom'].amount], [140, 180, 300, 250]);
  assert.equal(byProp['Studio A'].unitSize, 'Studio'); assert.equal(byProp['Typed 2 Bedroom'].unitSize, '2BR');
  assert.equal(byProp['Five Bed'].action, 'skip'); assert.match(byProp['Five Bed'].reason, /No rate card amount for 5BR/);
  assert.equal(preview.items.length, 5, 'cancelled, out-of-window and future checkouts are excluded');
  assert.deepEqual(preview.totals, [{ currency: 'AED', amount: 870 }]);
  assert.equal((await api('/accounting/transactions')).filter(t => t.category === 'Cleaning').length, 0, 'preview records nothing');

  // Only an administrator can record in bulk.
  await api('/users', 'POST', { name: 'Mgr', email: 'mgr@example.invalid', password: 'Test-only-6284!', role: 'manager' }, 201);
  const mgr = (await api('/auth/login', 'POST', { email: 'mgr@example.invalid', password: 'Test-only-6284!' })).token;
  await api('/accounting/cleaning-expenses/backfill', 'POST', { days: 30, dryRun: false }, 403, mgr);

  const run1 = await api('/accounting/cleaning-expenses/backfill', 'POST', { days: 30, dryRun: false });
  assert.equal(run1.recorded, 4);
  const run2 = await api('/accounting/cleaning-expenses/backfill', 'POST', { days: 30, dryRun: false });
  assert.deepEqual([run2.recorded, run2.alreadyRecorded, run2.toRecord], [0, 4, 0], 'backfill is idempotent');
  const tx = (await api('/accounting/transactions')).filter(t => t.category === 'Cleaning');
  assert.equal(tx.length, 4); assert.ok(tx.every(t => t.allocation === 'company' && t.reservationId && t.vendorId));

  // Completing a clean that was already backfilled does not add a second cost; a new completion adds one.
  const tasks = await api('/cleaning');
  const oneTask = tasks.find(t => t.propertyName === 'One Bed' && t.status !== 'cancelled');
  await api(`/cleaning/${oneTask.id}`, 'PATCH', { status: 'completed' });
  const futureTask = tasks.find(t => t.reservationId === future.id);
  await api(`/cleaning/${futureTask.id}`, 'PATCH', { status: 'completed' });
  await api(`/cleaning/${futureTask.id}`, 'PATCH', { status: 'approved' });
  const tx2 = (await api('/accounting/transactions')).filter(t => t.category === 'Cleaning');
  assert.equal(tx2.length, 5);
  assert.equal(tx2.find(t => t.reservationId === future.id).date, shift(5), 'dated on the clean date (checkout day)');
  // A clean that cannot be priced raises one notification.
  const fiveTask = tasks.find(t => t.propertyName === 'Five Bed');
  await api(`/cleaning/${fiveTask.id}`, 'PATCH', { status: 'completed' });
  await api(`/cleaning/${fiveTask.id}`, 'PATCH', { status: 'completed' });
  assert.equal((await api('/notifications')).filter(n => n.type === 'cleaning_cost').length, 1);

  // Rate card edits apply going forward; the company statement shows cleaning income vs cost.
  await api('/accounting/cleaning-costs', 'PUT', { rates: [{ bedrooms: 5, amount: 420 }] });
  assert.equal((await api('/accounting/cleaning-costs')).rates.find(r => r.bedrooms === 5).amount, 420);
  const company = await api(`/accounting/company-statement?start=${shift(-30)}&end=${shift(30)}`);
  const c = company.cleaning.find(x => x.currency === 'AED');
  assert.equal(c.cleans, 5); assert.equal(c.expenses, 1010); assert.equal(c.income, 150 * 6);
  console.log('PASS: rate card seeded; override; unit size from bedrooms/unit type; admin-only idempotent backfill; one cost per clean on completion; notification when unpriced; cleaning income vs cost');
} catch (e) { console.error(e); console.error(logs.slice(-3000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
