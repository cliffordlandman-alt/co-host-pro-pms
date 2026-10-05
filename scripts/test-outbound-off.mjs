// Outgoing messages are off unless OUTBOUND_DELIVERY=on: with provider keys present, nothing is sent to
// owners or staff (owner login codes, Reset Access, WhatsApp task notifications, WhatsApp test).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-outbound-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
async function run(port, extraEnv, fn) {
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(port), LOCAL_DATA_DIR: path.join(data, String(port)), MIGRATIONS_DIR: path.join(root, 'drizzle'), OUTBOUND_LOG: outLog,
    RESEND_API_KEY: 're_test_only', WHATSAPP_API_TOKEN: 'test-only', WHATSAPP_PHONE_NUMBER_ID: '123456789', ...extraEnv };
  delete env.DATABASE_URL; if (!('OUTBOUND_DELIVERY' in extraEnv)) delete env.OUTBOUND_DELIVERY;
  const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  let token;
  const api = async (route, method = 'GET', body, expected = 200) => {
    const r = await fetch(`http://127.0.0.1:${port}/api` + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
  };
  try {
    for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    token = (await api('/auth/register', 'POST', { name: 'Out Admin', email: 'out@example.invalid', password: 'Test-only-6284!' }, 201)).token;
    await fn(api);
  } catch (e) { console.error(logs.slice(-2000)); throw e; } finally { child.kill('SIGTERM'); await new Promise(r => setTimeout(r, 300)); }
}
try {
  await run(3011, {}, async api => {
    const owner = await api('/owners', 'POST', { name: 'Out Owner', email: 'owner@example.invalid' }, 201);
    const sc = await api('/owner-auth/send-code', 'POST', { email: 'owner@example.invalid' }, 503);
    assert.match(sc.error, /not sent by email/);
    const reset = await api('/owner-auth/admin-reset', 'POST', { ownerId: owner.id });
    assert.equal(reset.emailSent, false); assert.match(reset.devCode, /^\d{6}$/, 'admin sees the code to share personally');
    const wt = await api('/whatsapp/test', 'POST', { phone: '+971500000000' }, 503); assert.match(wt.error, /switched off/);
    assert.equal((await api('/whatsapp/status')).deliveryEnabled, false);
    const staff = await api('/staff', 'POST', { name: 'Out Cleaner', phone: '+971500000001', role: 'cleaner' }, 201);
    await api('/staff', 'POST', { name: 'Out Manager', phone: '+971500000002', role: 'manager' }, 201);
    const prop = await api('/properties', 'POST', { name: 'Out Home', unitNumber: 'O1', ownerId: owner.id, city: 'Dubai', currency: 'AED' }, 201);
    const task = await api('/cleaning', 'POST', { propertyId: prop.id, scheduledDate: '2026-10-10', assignedToId: staff.id, status: 'pending' }, 201);
    await api(`/cleaning/${task.id}`, 'PATCH', { assignedToId: null });
    await api(`/cleaning/${task.id}`, 'PATCH', { assignedToId: staff.id });
    await new Promise(r => setTimeout(r, 800));
    assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'no outbound request while OUTBOUND_DELIVERY is off');
  });
  // Control: with the switch explicitly on, the same WhatsApp test does reach the (blocked) provider URL.
  await run(3012, { OUTBOUND_DELIVERY: 'on' }, async api => {
    await api('/whatsapp/test', 'POST', { phone: '+971500000000' });
    assert.match(await readFile(outLog, 'utf8'), /graph\.facebook\.com/, 'control: switch on reaches the provider');
  });
  console.log('PASS: outgoing messages off by default (owner codes, Reset Access, WhatsApp test, cleaning notifications); control with OUTBOUND_DELIVERY=on');
} catch (e) { console.error(e); process.exitCode = 1; }
