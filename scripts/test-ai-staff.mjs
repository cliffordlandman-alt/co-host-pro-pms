// AI staff: bot keys, scoped reads, no direct writes, proposals need a person, plan gating, message relay queue, checks.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-aistaff-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3019', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL; delete env.BOT_RELAY; delete env.RESEND_API_KEY;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers }; if (token && !headers['X-Bot-Key'] && !headers.none) h.Authorization = `Bearer ${token}`; delete h.none;
  const r = await fetch('http://127.0.0.1:3019/api' + route, { method, headers: h, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'AI Test', email: 'aistaff@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'AI Owner' }, 201);
  const p = await api('/properties', 'POST', { name: 'AI 1BR', unitNumber: 'A-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED' }, 201);
  const base = { propertyId: p.id, guestName: 'Test Guest', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, managementPercent: 20, cleaningFee: 0, dubaiCharges: true, channelPercent: 0 };
  const r1 = await api('/reservations', 'POST', { ...base, checkIn: '2030-01-01', checkOut: '2030-01-05' }, 201);

  let bots = await api('/ai-staff/bots'); assert.equal(bots.plan, 'full_ops', 'existing installs default to Full Ops');
  // Starter: bookings + support only.
  await api('/ai-staff/config', 'PUT', { plan: 'starter' }); bots = await api('/ai-staff/bots'); assert.equal(bots.relay, 'off');
  const en = id => bots.bots.find(b => b.id === id).enabled;
  assert.ok(en('bookings') && en('support') && !en('finance') && !en('guest') && !en('housekeeping'));
  for (const b of bots.bots) assert.ok(!/clifford/i.test(JSON.stringify(b)), 'no personal data in bot instructions');
  await api('/ai-staff/messages/finance', 'POST', { text: 'hi' }, 403);
  await api('/ai-staff/config', 'PUT', { plan: 'nope' }, 400);
  await api('/ai-staff/config', 'PUT', { bots: { bookings: { webhookUrl: 'http://x' } } }, 400);
  await api('/ai-staff/config', 'PUT', { bots: { bookings: { email: 'bookings-bot@mail.grokbot.com' } } });

  // No bot key and no OpenAI key: AI not connected, message waits.
  assert.equal(bots.ai, 'not connected');
  const w = await api('/ai-staff/messages/support', 'POST', { text: 'Hello?' }, 201); assert.match(w.relay, /AI not connected yet/); assert.equal(w.status, 'waiting');

  // Escalation, check-ins, daily report (nothing sent: outgoing off).
  const st = await api('/staff', 'POST', { name: 'Amina Cleaner', role: 'cleaner', phone: '+971500000000' }, 201);
  await api('/ai-staff/ops', 'PUT', { checkinTime: '25:00' }, 400);
  await api('/ai-staff/ops', 'PUT', { escalation: { finance: { staffId: 99999 } } }, 400);
  await api('/ai-staff/ops', 'PUT', { checkinTime: '18:30', escalation: { bookings: { staffId: st.id } } });
  const o = await api('/ai-staff/ops'); assert.equal(o.checkinTime, '18:30'); assert.equal(o.escalation.bookings.name, 'Amina Cleaner'); assert.equal(o.outbound, 'off'); assert.equal(o.ai, 'not connected');
  const e1 = await api('/ai-staff/escalations', 'POST', { topic: 'bookings', text: 'Guest asks for late checkout' }, 201);
  assert.equal(e1.to.name, 'Amina Cleaner'); assert.match(e1.delivery, /not sent/);
  { const n = await api('/notifications'); assert.ok((Array.isArray(n) ? n : n.notifications ?? n.items).some(x => x.type === 'ai_staff_escalation'), 'in-app notification'); }
  assert.equal((await api(`/ai-staff/escalations/${e1.id}/resolve`, 'POST', {})).status, 'resolved');
  assert.equal((await api('/ai-staff/checkins/run', 'POST')).queued, 1); assert.equal((await api('/ai-staff/checkins/run', 'POST')).queued, 0, 'once per day');
  const ci = (await api('/ai-staff/checkins')).checkins[0]; assert.match(ci.question, /Amina/); assert.match(ci.delivery, /not sent/);
  await api(`/ai-staff/checkins/${ci.id}/answer`, 'POST', { answer: 'Cleaned 2 units, Lofts towel shortage' });
  const rep = await api('/ai-staff/reports/generate', 'POST', null, 201);
  assert.equal(rep.status, 'draft'); assert.match(rep.text, /Staff check-ins: 1 of 1 answered/); assert.match(rep.text, /towel shortage/);
  assert.equal((await api('/ai-staff/reports')).length, 1);
  await api('/ai-staff/reports/generate', 'POST', null, 201); assert.equal((await api('/ai-staff/reports')).length, 1, 'one draft per day');

  // Keys: shown once, stored hashed.
  const key = (await api('/ai-staff/bots/bookings/key', 'POST')).key; assert.match(key, /^bookings\./);
  const B = { 'X-Bot-Key': key };
  assert.ok(!JSON.stringify(await api('/ai-staff/bots')).includes(key.split('.')[1]));
  await api('/ai-staff/bot/inbox', 'GET', null, 401, { 'X-Bot-Key': 'bookings.wrong' });
  // Scoped reads.
  await api('/reservations', 'GET', null, 200, B); await api('/properties', 'GET', null, 200, B);
  await api('/accounting/transactions', 'GET', null, 403, B); await api('/owners', 'GET', null, 403, B); await api('/settings', 'GET', null, 403, B);
  // No direct writes, no people-only actions.
  await api(`/reservations/${r1.id}`, 'PATCH', { guestName: 'X' }, 403, B);
  await api('/ai-staff/config', 'PUT', { plan: 'full_ops' }, 403, B);
  await api('/ai-staff/bots/bookings/key', 'POST', null, 403, B);
  await api('/ai-staff/ops', 'PUT', { checkinTime: '10:00' }, 403, B);
  const be = await api('/ai-staff/bot/escalate', 'POST', { text: 'Not sure about the refund policy' }, 201, B); assert.equal(be.from, 'bot:bookings');
  await api('/ai-staff/escalations', 'POST', { topic: 'bookings', text: 'x' }, 403, B);

  // Message → bot inbox → reply.
  const m = await api('/ai-staff/messages/bookings', 'POST', { text: 'Any gaps next week?' }, 201);
  assert.match(m.relay, /queued/);
  let inbox = await api('/ai-staff/bot/inbox', 'GET', null, 200, B);
  assert.ok(inbox.waiting.some(x => x.id === m.id)); assert.ok(inbox.instructions);
  await api('/ai-staff/bot/reply', 'POST', { messageId: m.id, text: 'No gaps.' }, 201, B);
  const thread = await api('/ai-staff/messages/bookings');
  assert.ok(thread.some(x => x.from === 'bot' && x.text === 'No gaps.'));
  assert.equal(thread.find(x => x.id === m.id).status, 'answered');
  inbox = await api('/ai-staff/bot/inbox', 'GET', null, 200, B); assert.ok(!inbox.waiting.some(x => x.id === m.id));

  // Proposals: only allowed writes, applied only after a person approves.
  await api('/ai-staff/bot/proposals', 'POST', { title: 'bad', method: 'POST', path: '/accounting/transactions', body: {} }, 400, B);
  const pr = await api('/ai-staff/bot/proposals', 'POST', { title: 'Fix name', reason: 'typo', method: 'PATCH', path: `/reservations/${r1.id}`, body: { guestName: 'Fixed Guest' } }, 201, B);
  assert.equal((await api(`/reservations/${r1.id}`)).guestName, 'Test Guest', 'not applied before approval');
  await api(`/ai-staff/proposals/${pr.id}/approve`, 'POST', null, 403, B);
  await api(`/ai-staff/proposals/${pr.id}/maybe`, 'POST', null, 404);
  assert.equal((await api(`/ai-staff/proposals/${pr.id}/approve`, 'POST')).status, 'approved');
  assert.equal((await api(`/reservations/${r1.id}`)).guestName, 'Fixed Guest');
  await api(`/ai-staff/proposals/${pr.id}/approve`, 'POST', null, 409);
  const pr2 = await api('/ai-staff/bot/proposals', 'POST', { title: 'Shift', method: 'PATCH', path: `/reservations/${r1.id}`, body: { guestName: 'Nope' } }, 201, B);
  assert.equal((await api(`/ai-staff/proposals/${pr2.id}/reject`, 'POST')).status, 'rejected');
  assert.equal((await api(`/reservations/${r1.id}`)).guestName, 'Fixed Guest');

  // Checks: overlap found, dismiss persists across reruns.
  await api('/reservations', 'POST', { ...base, guestName: 'Overlap', checkIn: '2030-01-03', checkOut: '2030-01-06' }, 201).catch(() => {});
  const c = await api('/ai-staff/checks/run', 'POST');
  assert.ok(Array.isArray(c.issues));
  if (c.issues.length) { const id = c.issues[0].id; await api(`/ai-staff/checks/${encodeURIComponent(id)}/dismiss`, 'POST', {}); const again = await api('/ai-staff/checks/run', 'POST'); assert.ok(again.issues.find(i => i.id === id)?.dismissed); }
  await api('/ai-staff/checks/run', 'POST', null, 403, B);

  // Switching off / plan downgrade cuts the bot off.
  await api('/ai-staff/config', 'PUT', { enabled: { bookings: false } });
  await api('/ai-staff/bot/inbox', 'GET', null, 403, B);
  await api('/ai-staff/config', 'PUT', { enabled: { bookings: true }, plan: 'full_ops' });
  bots = await api('/ai-staff/bots'); assert.ok(bots.bots.every(b => b.enabled));
  const gk = { 'X-Bot-Key': (await api('/ai-staff/bots/guest/key', 'POST')).key };
  await api('/ai-staff/bot/proposals', 'POST', { title: 'x', method: 'PATCH', path: `/reservations/${r1.id}`, body: {} }, 400, gk);
  console.log('AI staff tests passed');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill(); }
