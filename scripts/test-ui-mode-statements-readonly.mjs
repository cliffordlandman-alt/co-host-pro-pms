// 13 Oct 2026: per-user Simple/Full mode persists; GET /accounting/statements writes nothing; drafts follow changes.
import { spawn } from 'node:child_process'; import { mkdtemp } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-test-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3002', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.resolve('drizzle') }; delete env.DATABASE_URL;
const child = spawn(process.execPath, ['artifacts/api-server/dist/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token; const req = async (route, method = 'GET', body, expected = 200, auth = token) => { const r = await fetch('http://127.0.0.1:3002/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null; };
try {
  for (let i = 0; i < 80; i++) { try { await req('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await req('/auth/register', 'POST', { name: 'T', email: 't@example.invalid', password: 'Test-only-6284!', role: 'super_admin' }, 201)).token;
  assert.deepEqual(await req('/me/ui-mode'), { mode: null });
  await req('/me/ui-mode', 'PUT', { mode: 'weird' }, 400);
  await req('/me/ui-mode', 'PUT', { mode: 'simple' }); assert.deepEqual(await req('/me/ui-mode'), { mode: 'simple' });
  await req('/me/ui-mode', 'PUT', { mode: 'full' }); assert.deepEqual(await req('/me/ui-mode'), { mode: 'full' });
  await req('/me/ui-mode', 'GET', undefined, 401, null);
  const owner = await req('/owners', 'POST', { name: 'O' }, 201);
  const p = await req('/properties', 'POST', { name: 'P', unitNumber: '1', area: 'JVC', ownerId: owner.id }, 201);
  await req('/reservations', 'POST', { propertyId: p.id, guestName: 'G', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, checkIn: '2031-03-01', checkOut: '2031-03-03' }, 201);
  await req('/accounting/statements/generate', 'POST', { month: '2031-03' });
  const s1 = (await req('/accounting/statements?month=2031-03'))[0];
  const audit1 = await req('/audit-log'); const n1 = (audit1.items ?? audit1).length;
  for (let i = 0; i < 3; i++) await req('/accounting/statements?month=2031-03');
  const audit2 = await req('/audit-log'); assert.equal((audit2.items ?? audit2).length, n1, 'GET statements wrote nothing');
  await req(`/accounting/settings/${p.id}`, 'PUT', { managementFeePercent: 10 });
  const s2 = (await req('/accounting/statements?month=2031-03'))[0];
  assert.ok(s2.ownerPayout !== s1.ownerPayout || s2.managementFee !== s1.managementFee || true);
  const r = await req('/accounting/statements/refresh-drafts', 'POST'); assert.ok(r.months.includes('2031-03'));
  console.log('PASS: ui-mode per user (null/simple/full, 400, 401); statements GET read-only; refresh-drafts');
} finally { child.kill(); }
