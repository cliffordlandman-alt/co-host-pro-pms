// Audit log never keeps private channel feed links or credentials: new entries are redacted when written,
// old entries are redacted by migration 0015, and the audit-log API redacts on read as a backstop.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { redactSecrets, redactText } from '../lib/redact.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SECRET = 'TESTONLYSECRET7731';
const feed = `https://www.airbnb.com/calendar/ical/999.ics?s=${SECRET}`;

// 1. Pure rules.
const r = redactSecrets({ name: 'Unit 1', airbnbIcalUrl: feed, bookingComIcalUrl: '', vrboIcalUrl: null, password: 'hunter2', nested: [{ apiKey: 'k' }], notes: `see ${feed} and https://example.com/photo.jpg`, bedrooms: 2 });
assert.equal(r.name, 'Unit 1'); assert.equal(r.airbnbIcalUrl, '[redacted]'); assert.equal(r.bookingComIcalUrl, '', 'cleared value stays visible');
assert.equal(r.vrboIcalUrl, null); assert.equal(r.password, '[redacted]'); assert.equal(r.nested[0].apiKey, '[redacted]'); assert.equal(r.bedrooms, 2);
assert.equal(r.notes, 'see [redacted URL] and https://example.com/photo.jpg', 'ordinary links are kept');
assert.equal(redactText('https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc'), '[redacted URL]');
assert.ok(!JSON.stringify(r).includes(SECRET));

// 2. Live API: property create and edit with feed URLs.
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-audit-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3007', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle') };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
const exited = new Promise(res => child.on('exit', res));
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const res = await fetch('http://127.0.0.1:3007/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await res.text(); assert.equal(res.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(res => setTimeout(res, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Audit Test', email: 'audit@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Audit Owner' }, 201);
  const p = await api('/properties', 'POST', { name: 'Audit 1BR', unitNumber: 'AU-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED', cleaningFee: '100', airbnbIcalUrl: feed }, 201);
  await api(`/properties/${p.id}`, 'PATCH', { name: 'Audit 1BR renamed', bookingComIcalUrl: `https://admin.booking.com/hotel/hoteladmin/ical.html?t=${SECRET}` });
  const entries = await api('/audit-log');
  const mine = entries.filter(e => e.entity === 'property' && e.entityId === p.id);
  assert.ok(mine.length >= 2, 'create and edit are audited');
  assert.ok(!JSON.stringify(entries).includes(SECRET), 'no feed secret in the audit log API');
  assert.ok(mine.some(e => e.details?.name === 'Audit 1BR renamed'), 'non-secret changes are still recorded');
  assert.ok(mine.some(e => e.details?.bookingComIcalUrl === '[redacted]'), 'the entry shows a feed was set, without the link');
} catch (e) { console.error(e); console.error(logs.slice(-3000)); process.exitCode = 1; }
child.kill('SIGTERM'); await exited;
if (process.exitCode) process.exit(1);

// 3. Stored rows: new rows are redacted at rest; legacy leaked rows are fixed by migration 0015 (idempotent).
const req = createRequire(path.join(root, 'lib/db/package.json'));
const { PGlite } = await import(req.resolve('@electric-sql/pglite'));
const db = new PGlite(path.join(data, 'postgres'));
try {
  assert.equal((await db.query(`select count(*)::int n from audit_logs where details like $1`, [`%${SECRET}%`])).rows[0].n, 0, 'new rows are redacted at rest');
  const legacy = [
    JSON.stringify({ name: 'Old', airbnbIcalUrl: feed, vrboIcalUrl: '' }),
    JSON.stringify({ airbnb_ical_url: feed, note: 'quote " inside', bedrooms: 3 }),
    JSON.stringify({ notes: `feed was ${feed} ok`, photo: 'https://example.com/a.jpg' }),
    JSON.stringify({ password: 'hunter2', name: 'Staff' }),
  ];
  for (const d of legacy) await db.query(`insert into audit_logs (action, entity, entity_id, details, performed_by) values ('update','property',1,$1,'legacy')`, [d]);
  const sql = await readFile(path.join(root, 'drizzle/0015_redact_audit_secrets.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  const rows = (await db.query(`select details from audit_logs where performed_by='legacy' order by id`)).rows.map(x => JSON.parse(x.details));
  assert.ok(!JSON.stringify(rows).includes(SECRET) && !JSON.stringify(rows).includes('hunter2'));
  assert.deepEqual(rows[0], { name: 'Old', airbnbIcalUrl: '[redacted]', vrboIcalUrl: '' });
  assert.deepEqual(rows[1], { airbnb_ical_url: '[redacted]', note: 'quote " inside', bedrooms: 3 });
  assert.deepEqual(rows[2], { notes: 'feed was [redacted URL] ok', photo: 'https://example.com/a.jpg' });
  assert.deepEqual(rows[3], { password: '[redacted]', name: 'Staff' });
  console.log('PASS: audit log redaction — feed links and credentials redacted on write, on read, and in existing rows (migration 0015, idempotent); ordinary fields and links kept');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await db.close(); }
