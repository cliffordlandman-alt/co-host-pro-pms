// Editing a manual income/expense entry in place: same rules as adding, Activity Log keeps before/after,
// blocked once the entry sits on a sent or paid owner statement, automatic entries are not editable here.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-entry-edit-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3016', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3016/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Edit Admin', email: 'edit@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Edit Owner' }, 201);
  const P = await api('/properties', 'POST', { name: 'Edit Home', unitNumber: 'E1', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const Q = await api('/properties', 'POST', { name: 'Other Home', unitNumber: 'E2', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const add = (b, expected = 201) => api('/accounting/transactions', 'POST', { type: 'expense', currency: 'AED', allocation: 'owner', propertyId: P.id, ...b }, expected);
  const e1 = await add({ date: '2026-09-10', category: 'Supplies', description: 'Towels', amount: 100, revenueStream: true });
  const count = async () => (await api('/accounting/transactions')).length;
  const n0 = await count();

  // Edit in place: same id, no new row, every editable field.
  const ed = await api(`/accounting/transactions/${e1.id}`, 'PATCH', { amount: '120.50', date: '2026-09-12', category: 'Maintenance', notes: 'Fixed tap', revenueStream: false, description: 'Towels and tap' });
  assert.equal(ed.id, e1.id); assert.equal(ed.amount, 120.5); assert.equal(ed.date, '2026-09-12'); assert.equal(ed.category, 'Maintenance'); assert.equal(ed.notes, 'Fixed tap'); assert.equal(ed.revenueStream, false);
  assert.equal(await count(), n0, 'edited, not re-entered');
  const moved = await api(`/accounting/transactions/${e1.id}`, 'PATCH', { propertyId: Q.id, allocation: 'company', revenueStream: null });
  assert.equal(moved.propertyId, Q.id); assert.equal(moved.allocation, 'company'); assert.equal(moved.revenueStream, null);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { propertyId: P.id, allocation: 'owner' });
  // Same rules as adding.
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { amount: '-5' }, 400);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { date: '2026-02-30' }, 400);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { currency: 'ZAR' }, 400);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { type: 'income' }, 400);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { revenueStream: 'maybe' }, 400);
  await api(`/accounting/transactions/${e1.id}`, 'PATCH', { reference: 'cleaning:5' }, 400);
  await api('/accounting/transactions/999999', 'PATCH', { amount: 1 }, 404);
  // Activity Log keeps the trail.
  let audit = (await api('/audit-log')).filter(a => a.entity === 'accounting_transaction' && a.entityId === e1.id);
  assert.ok(audit.some(a => a.action === 'create'), 'create logged');
  const first = audit.filter(a => a.action === 'update').find(a => a.details.changed.amount);
  assert.ok(first, 'update logged'); assert.equal(first.details.before.amount, 100); assert.equal(first.details.after.amount, 120.5);
  assert.deepEqual(Object.keys(first.details.changed).sort(), ['amount', 'category', 'date', 'description', 'notes', 'revenueStream']);
  // Automatic entries are changed at their source.
  const auto = await add({ date: '2026-09-11', category: 'Maintenance', description: 'Ticket charge', amount: 50, reference: 'maintenance:77', allocation: 'company' });
  assert.match((await api(`/accounting/transactions/${auto.id}`, 'PATCH', { amount: 60 }, 400)).error, /automatically/);

  // Lock: once the September statement for the property is sent, its owner entries can't change.
  const e2 = await add({ date: '2026-10-05', category: 'Supplies', description: 'October soap', amount: 30 });
  const co = await add({ date: '2026-09-15', category: 'Supplies', description: 'Company cost', amount: 40, allocation: 'company' });
  await api('/reservations', 'POST', { propertyId: P.id, guestName: 'Lock Guest', platform: 'direct', status: 'confirmed', checkIn: '2026-09-18', checkOut: '2026-09-20', financeMode: 'inclusive-v1', grossAmount: 2000 }, 201);
  const gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  const st = gen.statements.find(s => s.propertyId === P.id); assert.ok(st);
  await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'sent' });
  let err = (await api(`/accounting/transactions/${e1.id}`, 'PATCH', { amount: 130 }, 409)).error;
  assert.match(err, /2026-09 owner statement for Edit Home, which has been sent, so it can't be changed/);
  assert.match((await api(`/accounting/transactions/${e2.id}`, 'PATCH', { date: '2026-09-28' }, 409)).error, /has been sent/, 'cannot move an entry onto a sent statement');
  assert.equal((await api(`/accounting/transactions/${co.id}`, 'PATCH', { amount: 45 })).amount, 45, 'company entries are not on the owner statement');
  assert.equal((await api(`/accounting/transactions/${e2.id}`, 'PATCH', { amount: 35 })).amount, 35, 'open month still editable');
  await api(`/accounting/statements/${st.id}/payouts`, 'POST', { amount: (await api('/accounting/statements')).find(x => x.id === st.id).ownerPayout, paidOn: '2026-10-01', method: 'bank_transfer', reference: 'TEST-REF-1' }, 201);
  await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'paid' });
  assert.match((await api(`/accounting/transactions/${e1.id}`, 'PATCH', { notes: 'x' }, 409)).error, /has been paid/);
  assert.equal((await api('/accounting/transactions')).find(t => t.id === e1.id).amount, 120.5, 'locked entry unchanged');
  // Deleting is logged too.
  await api(`/accounting/transactions/${e2.id}`, 'DELETE', undefined, 204);
  audit = await api('/audit-log');
  assert.ok(audit.some(a => a.entity === 'accounting_transaction' && a.entityId === e2.id && a.action === 'delete' && a.details.before.amount === 35));
  console.log('PASS: manual entries edit in place (same rules as adding); Activity Log keeps create/update(before, after)/delete; sent or paid owner months locked with a clear message; automatic entries refused');
} catch (e) { console.error(e); console.error(logs.slice(-2500)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
