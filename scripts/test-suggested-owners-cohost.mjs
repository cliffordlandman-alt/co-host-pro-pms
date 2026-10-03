// Suggested owners (Owners page) and "Airbnb co-host payout goes directly to the owner":
// - suggestions match properties by name, disappear once created (normal POST /owners + PATCH /properties,
//   audit-logged) or dismissed, and never reassign a property owned by someone else;
// - creating an owner sends nothing (provider keys present, OUTBOUND_DELIVERY unset, outbound log stays empty);
// - with the flag on, statements deduct the bookings' co-host payouts as already paid by Airbnb, block when an
//   Airbnb booking has no co-host amount (listed, and shown on Verify), and a negative balance can't be paid;
// - with the flag off nothing is deducted (unchanged).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-suggested-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3019', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog,
  RESEND_API_KEY: 're_test_only', WHATSAPP_API_TOKEN: 'test-only', WHATSAPP_PHONE_NUMBER_ID: '123456789' };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3019/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const cents = v => Math.round(Number(v) * 100);
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Owners Admin', email: 'own@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const GL = await api('/properties', 'POST', { name: 'Green Lawn House', unitNumber: 'GL', city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 3 }, 201);
  const GH = await api('/properties', 'POST', { name: 'Grey House', unitNumber: 'GH', city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const other = await api('/owners', 'POST', { name: 'Someone Else', phone: '+971 50 000 0000' }, 201);
  const GR = await api('/properties', 'POST', { name: 'Garden Retreat', unitNumber: 'GR', ownerId: other.id, city: 'Gqeberha', currency: 'AED', bedrooms: 1 }, 201);

  // ── Suggestions ──
  let sug = await api('/owners/suggestions');
  assert.deepEqual(sug.map(s => s.key), ['dylan-matthysen', 'bonnita']);
  const dylan = sug[0], bon = sug[1];
  assert.equal(dylan.phone, '+27 83 434 9734'); assert.equal(bon.phone, '+27 83 981 2633'); assert.equal(dylan.cohostOption, true); assert.equal(bon.cohostOption, false);
  assert.deepEqual(dylan.properties.map(p => p.match?.id), [GL.id, GH.id]);
  assert.equal(bon.properties[0].match.id, GR.id); assert.equal(bon.properties[0].match.currency, 'AED'); assert.equal(bon.properties[0].expectedCurrency, 'ZAR', 'Garden Retreat to ZAR (Clifford, 3 Oct)'); assert.equal(bon.currencyOption.currency, 'ZAR');
  assert.match(bon.properties[0].problem, /Already assigned to Someone Else/, 'never reassigned from here');
  const auditBefore = (await api('/audit-log')).length;
  // The card's "Create owner": the normal paths.
  const d = await api('/owners', 'POST', { name: dylan.name, phone: dylan.phone }, 201);
  for (const p of dylan.properties) { await api(`/properties/${p.match.id}`, 'PATCH', { ownerId: d.id }); await api(`/accounting/settings/${p.match.id}`, 'PUT', { cohostPaidToOwner: true }); }
  const audit = await api('/audit-log');
  assert.ok(audit.some(a => a.entity === 'owner' && a.action === 'create' && a.entityId === d.id), 'owner create is audit-logged');
  assert.ok(audit.some(a => a.entity === 'property_settings' && a.entityId === GH.id), 'fee settings change is audit-logged');
  assert.ok(audit.length >= auditBefore + 5);
  const settings = await api('/accounting/settings');
  assert.equal(settings.find(s => s.propertyId === GH.id).cohostPaidToOwner, true); assert.equal(settings.find(s => s.propertyId === GR.id).cohostPaidToOwner, false);
  sug = await api('/owners/suggestions');
  assert.deepEqual(sug.map(s => s.key), ['bonnita'], 'created suggestion is gone');
  // Bonnita exists by phone (local format) -> "assign" state, not a second owner.
  const b = await api('/owners', 'POST', { name: 'Bonnita L', phone: '083 981 2633' }, 201);
  sug = await api('/owners/suggestions'); assert.equal(sug[0].existingOwner.id, b.id);
  await api('/owners/suggestions/nope/dismiss', 'POST', undefined, 404);
  await api('/owners/suggestions/bonnita/dismiss', 'POST');
  assert.deepEqual(await api('/owners/suggestions'), [], 'dismissed suggestion is gone');
  assert.equal((await api(`/properties/${GR.id}`)).ownerId, other.id, 'Garden Retreat not reassigned');
  await api(`/owners/${b.id}`, 'PATCH', { phone: '+27 83 981 2633' });
  assert.ok((await api('/audit-log')).some(a => a.entity === 'owner' && a.action === 'update' && a.entityId === b.id), 'owner update is audit-logged');

  // ── Co-host payout paid to the owner directly ──
  const mk = async (p, ci, co, gross, cohost) => {
    const r = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${ci}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co }, 201);
    return api(`/reservations/${r.id}`, 'PATCH', { grossAmount: gross, financeMode: 'inclusive-v1', cleaningFee: '0', ...(cohost !== undefined ? { cohostPayout: cohost } : {}) });
  };
  const g1 = await mk(GH, '2026-09-01', '2026-09-03', '2730.00', '1942.83');
  const g2 = await mk(GH, '2026-09-10', '2026-09-13', '3352.00');
  let gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  const skip = gen.skipped.find(s => s.propertyId === GH.id);
  assert.match(skip.reason, /Co-host payout missing on 1 Airbnb booking/); assert.deepEqual(skip.cohostMissing.map(x => x.id), [g2.id]);
  let unv = await api('/reservations/unverified?month=2026-09');
  const row = unv.find(r => r.id === g2.id);
  assert.ok(row, 'verified booking missing the co-host payout is listed on Verify'); assert.equal(row.verified, true); assert.equal(row.cohostRequired, true);
  assert.ok(!unv.some(r => r.id === g1.id));
  await api(`/reservations/${g2.id}`, 'PATCH', { cohostPayout: '2385.49' });
  assert.ok(!(await api('/reservations/unverified?month=2026-09')).some(r => r.id === g2.id));
  gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  let st = (await api('/accounting/statements?month=2026-09')).find(s => s.propertyId === GH.id);
  const share = cents(g1.ownerAmount) + cents(g2.ownerAmount);
  assert.equal(cents(st.paidByAirbnb), 194283 + 238549, 'one source: the bookings\' co-host payouts');
  assert.equal(cents(st.ownerPayout), share - 194283 - 238549, 'balance = owner share − already paid by Airbnb');
  assert.equal(cents(st.grossRevenue), 273000 + 335200);
  assert.equal(JSON.parse(st.bookingDetails).find(x => x.id === g1.id).cohostPayout, '1942.83');
  // A balance that goes negative is "owner owes company": it can be sent but never marked paid.
  const g3 = await mk(GH, '2026-09-20', '2026-09-22', '1000.00', '1500.00');
  await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  st = (await api('/accounting/statements?month=2026-09')).find(s => s.propertyId === GH.id);
  const share3 = share + cents(g3.ownerAmount), paid3 = 194283 + 238549 + 150000;
  assert.equal(cents(st.ownerPayout), share3 - paid3);
  assert.ok(share3 - paid3 < 0, 'test case is negative');
  await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'sent' });
  const e = await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'paid' }, 400); assert.match(e.error, /negative balance/);
  // Flag off: the co-host payout is shown but not deducted; a missing amount does not block.
  const l1 = await mk(GL, '2026-09-05', '2026-09-07', '2000.00', '1500.00');
  const l2 = await mk(GL, '2026-09-15', '2026-09-17', '1800.00');
  gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  assert.ok(gen.skipped.some(s => s.propertyId === GL.id && s.cohostMissing?.length === 1), 'flag on for Green Lawn: blocked');
  await api(`/accounting/settings/${GL.id}`, 'PUT', { cohostPaidToOwner: false });
  gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  assert.ok(!gen.skipped.some(s => s.propertyId === GL.id));
  st = (await api('/accounting/statements?month=2026-09')).find(s => s.propertyId === GL.id);
  assert.equal(cents(st.paidByAirbnb), 0); assert.equal(cents(st.ownerPayout), cents(l1.ownerAmount) + cents(l2.ownerAmount), 'flag off: nothing deducted');
  assert.equal((await api('/reservations/' + l1.id)).cohostPayout, 1500, 'still recorded on the booking');

  await new Promise(r => setTimeout(r, 500));
  assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'creating owners and statements sent nothing (no email, no WhatsApp)');
  console.log('PASS: suggested owners (create via normal paths with audit, no reassignment, dismiss, nothing sent); co-host payout paid to owner deducted once, missing amount blocks and shows on Verify, negative balance not payable, flag off unchanged');
} catch (e) { console.error(logs.slice(-3000)); console.error(e); process.exitCode = 1; } finally { child.kill('SIGTERM'); }
