// Server-side paging: page slices, filters, and summaries computed over the FULL filtered set (not the page).
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { financialTotals } from '../lib/reservation-financials.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-paging-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3007', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle') };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3007/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const r2 = n => Math.round(n * 100) / 100;
const passed = [];
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Paging', email: 'paging@example.invalid', password: 'Test-only-7391!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Paging Owner' }, 201);
  const props = [];
  for (let i = 1; i <= 3; i++) props.push(await api('/properties', 'POST', { name: `Paging ${i}BR`, unitNumber: `P-${i}`, ownerId: owner.id, bedrooms: i, city: 'Dubai', currency: 'AED' }, 201));
  const base = { guestName: 'Guest', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', managementPercent: 20, cleaningFee: 0, dubaiCharges: true, channelPercent: 0 };
  let day = 1;
  for (let i = 0; i < 7; i++) {
    const p = props[i % 3], d = String(day).padStart(2, '0'), e = String(day + 2).padStart(2, '0'); day += 3;
    await api('/reservations', 'POST', { ...base, propertyId: p.id, guestName: `Guest ${i}`, platform: i % 2 ? 'airbnb' : 'direct', grossAmount: 1000 + i * 100, checkIn: `2030-01-${d}`, checkOut: `2030-01-${e}`, paymentStatus: i === 0 ? 'paid' : 'pending' }, 201);
  }

  // Reservations: page slice + totals over the whole filtered set.
  const all = await api('/reservations');
  assert.ok(Array.isArray(all), 'no page param keeps the plain array');
  const pg1 = await api('/reservations?page=1&pageSize=3');
  assert.equal(pg1.items.length, 3); assert.equal(pg1.total, all.length); assert.equal(pg1.pages, Math.ceil(all.length / 3));
  const pg3 = await api('/reservations?page=3&pageSize=3');
  assert.equal(pg3.items.length, all.length - 6);
  const ids = new Set([...pg1.items, ...(await api('/reservations?page=2&pageSize=3')).items, ...pg3.items].map(r => r.id));
  assert.equal(ids.size, all.length, 'pages do not overlap or skip rows');
  const full = financialTotals(all);
  assert.deepEqual(pg1.summary.finance.totals.map(t => r2(t.grossAmount)), full.totals.map(t => r2(t.grossAmount)), 'gross total covers every booking, not the page');
  assert.equal(pg1.summary.finance.totals[0].ownerAmount, full.totals[0].ownerAmount);
  assert.equal(pg1.summary.pendingPayments, all.filter(r => ['pending', 'partial'].includes(r.paymentStatus)).length);
  const air = await api('/reservations?page=1&pageSize=2&platform=airbnb');
  const airAll = all.filter(r => r.platform === 'airbnb');
  assert.equal(air.total, airAll.length); assert.equal(air.items.length, 2);
  assert.equal(r2(air.summary.finance.totals[0].grossAmount), r2(financialTotals(airAll).totals[0].grossAmount), 'filtered total = sum of all filtered rows');
  assert.equal((await api('/reservations?page=1&q=guest%206')).total, 1, 'search runs on the server');
  passed.push('reservations paging + full-set totals');

  // Payments: per-currency, per-status sums over all matching payments.
  const pays = await api('/payments');
  const pp = await api('/payments?page=1&pageSize=1');
  assert.equal(pp.items.length, 1); assert.equal(pp.total, pays.length);
  const sumPaid = r2(pays.filter(x => x.status === 'paid').reduce((n, x) => n + x.amount, 0));
  assert.equal(pp.summary.currencies.find(c => c.currency === 'AED').byStatus.paid, sumPaid);
  passed.push('payments paging + full-set sums');

  // Cleaning: filters and counts on the server.
  for (let i = 0; i < 5; i++) await api('/cleaning', 'POST', { propertyId: props[0].id, scheduledDate: i < 2 ? '2020-01-0' + (i + 1) : '2099-01-0' + i, status: 'pending' }, 201);
  const tasks = await api('/cleaning');
  const cp = await api('/cleaning?page=1&pageSize=2');
  assert.equal(cp.items.length, 2); assert.equal(cp.total, tasks.length); assert.equal(cp.summary.total, tasks.length);
  const overdue = await api('/cleaning?page=1&pageSize=50&filter=overdue');
  assert.ok(overdue.total >= 2); assert.ok(overdue.items.every(t => t.scheduledDate < '2030-01-01'));
  assert.equal(cp.summary.overdue, overdue.total);
  assert.equal(overdue.summary.total, tasks.length, 'stat counts ignore the tab filter');
  passed.push('cleaning paging + server counts');

  // Maintenance: status-or-priority filter, counts.
  await api('/maintenance', 'POST', { propertyId: props[1].id, issue: 'Leak', priority: 'emergency' }, 201);
  await api('/maintenance', 'POST', { propertyId: props[1].id, issue: 'Bulb', priority: 'low' }, 201);
  await api('/maintenance', 'POST', { propertyId: props[2].id, issue: 'AC', priority: 'high', status: 'resolved' }, 201);
  const mp = await api('/maintenance?page=1&pageSize=2');
  assert.equal(mp.items.length, 2); assert.equal(mp.total, 3); assert.equal(mp.summary.emergency, 1); assert.equal(mp.summary.resolved, 1);
  assert.equal((await api('/maintenance?page=1&filter=emergency')).total, 1);
  assert.equal((await api('/maintenance?page=1&filter=resolved')).total, 1);
  passed.push('maintenance paging + server counts');

  // Owner statements: KPI totals over every statement for the month.
  await api('/accounting/statements/generate', 'POST', { month: '2030-01' });
  const stAll = await api('/accounting/statements?month=2030-01');
  assert.ok(stAll.length >= 2, 'statements generated');
  const sp = await api('/accounting/statements?month=2030-01&page=1&pageSize=1');
  assert.equal(sp.items.length, 1); assert.equal(sp.total, stAll.length);
  const aed = sp.summary.currencies.find(c => c.currency === 'AED');
  assert.equal(r2(aed.ownerPayout), r2(stAll.reduce((n, s) => n + s.ownerPayout, 0)), 'payout total covers every statement, not the page');
  assert.equal(r2(aed.grossRevenue), r2(stAll.reduce((n, s) => n + s.grossRevenue, 0)));
  assert.equal((await api('/accounting/statements?month=2030-01&page=1&status=paid')).total, 0);
  passed.push('owner statements paging + full-set totals');

  console.log('PASS: ' + passed.join('; '));
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
