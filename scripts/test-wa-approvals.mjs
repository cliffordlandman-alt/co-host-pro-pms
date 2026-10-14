// WhatsApp approvals: flag off = 404 + no brand flag; flag on = seed, approve/edit/always/decline, rules auto-approve,
// blocked categories can never get or use a rule, everything audited, outbox "queued (delivery off)".
import { spawn } from 'node:child_process'; import { mkdtemp } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { matchRule, isBlocked, newRule } from '../lib/wa-approvals.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
assert.ok(isBlocked('price') && isBlocked('New lead') && isBlocked('new-lead') && !isBlocked('thank_you'));
assert.throws(() => newRule({ category: 'refund', scope: 'all' }, 'x'), /manual approval/);
assert.equal(matchRule([{ enabled: true, category: 'price', scope: 'all' }], { category: 'price', contact: '1' }), null, 'a stored blocked rule never applies');
async function boot(port, extra) {
  const data = await mkdtemp(path.join(tmpdir(), 'lr-wa-'));
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(port), LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', ...extra };
  delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY; delete env.BOT_RELAY; if (!extra.WA_APPROVALS) delete env.WA_APPROVALS;
  const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let token; const api = async (route, method = 'GET', body, expected = 200) => {
    const r = await fetch(`http://127.0.0.1:${port}/api` + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null; };
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'WA Test', email: 'wa@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  return { child, api };
}
const off = await boot(3031, {});
try {
  assert.equal((await off.api('/brand')).waApprovals, false);
  await off.api('/wa/drafts', 'GET', null, 404); await off.api('/wa/seed', 'POST', {}, 404); await off.api('/wa/rules', 'GET', null, 404);
  console.log('flag off: hidden and 404 ✓');
} finally { off.child.kill(); }
const { child, api } = await boot(3032, { WA_APPROVALS: 'on' });
try {
  assert.equal((await api('/brand')).waApprovals, true);
  assert.match((await api('/wa/prompt')).prompt, /Stay silent/);
  await api('/wa/prompt', 'PUT', { prompt: 'Edited prompt' }); assert.equal((await api('/wa/prompt')).prompt, 'Edited prompt');
  assert.equal((await api('/wa/seed', 'POST', {})).seeded, 4); assert.equal((await api('/wa/seed', 'POST', {})).seeded, 0, 'seed is idempotent');
  let pend = await api('/wa/drafts?status=pending'); assert.equal(pend.length, 4);
  const by = c => pend.find(d => d.category === c);
  assert.equal(by('price').blocked, true); assert.equal(by('thank_you').blocked, false);
  // Blocked: always-approve refused; plain approve works.
  await api(`/wa/drafts/${by('price').id}/always`, 'POST', { scope: 'all' }, 400);
  // Edit then send.
  const e = await api(`/wa/drafts/${by('technician_eta').id}/approve`, 'POST', { text: 'Rajesh will be there in 30 minutes.' });
  assert.equal(e.outbox, 'queued (delivery off)'); assert.equal(e.draft.finalText, 'Rajesh will be there in 30 minutes.');
  await api(`/wa/drafts/${by('technician_eta').id}/approve`, 'POST', {}, 409);
  // Always approve: contact scope.
  const a = await api(`/wa/drafts/${by('service_booking').id}/always`, 'POST', { scope: 'contact' });
  assert.equal(a.rule.scope, 'contact'); assert.equal(a.draft.status, 'sent');
  // Always approve: all contacts.
  const t = await api(`/wa/drafts/${by('thank_you').id}/always`, 'POST', { scope: 'all' }); assert.equal(t.rule.scope, 'all');
  // Next matching drafts auto-approve.
  const n1 = await api('/wa/drafts', 'POST', { contact: '+971 50 111 0001', contactName: 'Chef Ahmed', category: 'service_booking', text: 'Next visit confirmed for 20 Nov.' }, 201);
  assert.equal(n1.status, 'sent'); assert.equal(n1.ruleId, a.rule.id);
  const n2 = await api('/wa/drafts', 'POST', { contact: '+971509999999', category: 'service_booking', text: 'Visit confirmed.' }, 201);
  assert.equal(n2.status, 'pending', 'contact-scoped rule does not cover other contacts');
  const n3 = await api('/wa/drafts', 'POST', { contact: '+971508888888', category: 'thank_you', text: 'Thanks!' }, 201); assert.equal(n3.status, 'sent');
  // Blocked categories stay manual, even for a contact with rules.
  for (const c of ['money', 'price', 'discount', 'refund', 'contract', 'complaint', 'legal', 'new_lead']) {
    const d = await api('/wa/drafts', 'POST', { contact: '+971501110001', category: c, text: 'Holding reply' }, 201); assert.equal(d.status, 'pending', c);
    await api(`/wa/drafts/${d.id}/always`, 'POST', { scope: 'all' }, 400);
  }
  // Rule off -> no auto-approve; delete.
  await api(`/wa/rules/${t.rule.id}`, 'PATCH', { enabled: false });
  assert.equal((await api('/wa/drafts', 'POST', { contact: '+971507777777', category: 'thank_you', text: 'Thanks' }, 201)).status, 'pending');
  await api(`/wa/rules/${t.rule.id}`, 'DELETE'); assert.equal((await api('/wa/rules')).length, 1);
  // Decline.
  const dd = await api(`/wa/drafts/${n2.id}/decline`, 'POST', {}); assert.equal(dd.status, 'declined');
  // Audit + outbox.
  const audit = await api('/wa/audit'), acts = audit.map(x => x.action);
  for (const x of ['drafted', 'approved', 'edited & approved', 'rule created', 'auto-approved & sent', 'declined', 'rule switched off', 'rule deleted', 'prompt updated']) assert.ok(acts.includes(x), x);
  assert.ok(audit.every(x => x.by && x.at)); assert.ok(audit.find(x => x.action === 'auto-approved & sent').by.startsWith('auto-rule'));
  const ob = await api('/wa/outbox'); assert.equal(ob.length, 5); assert.ok(ob.every(o => o.status === 'queued (delivery off)'));
  console.log('flag on: full approvals flow ✓');
} finally { child.kill(); }
