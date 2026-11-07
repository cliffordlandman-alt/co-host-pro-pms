// Data-integrity regression checks against an isolated API instance.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-integrity-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3006', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), FX_FIXED_RATES: JSON.stringify({ USD: 3.6725, ZAR: 0.2, EUR: 4, GBP: 4.8 }) };
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

  // Revenue by channel ignores unverified legacy amounts, blocked dates and other currencies.
  const zarProp = await api('/properties', 'POST', { name: 'Cape Town 1BR', unitNumber: 'Z-1', ownerId: owner.id, bedrooms: 1, city: 'Cape Town', currency: 'ZAR' }, 201);
  await api('/reservations', 'POST', { propertyId: p.id, guestName: 'Legacy amount', platform: 'direct', checkIn: '2030-03-01', checkOut: '2030-03-03', revenue: 5000, paymentStatus: 'unknown', status: 'confirmed' }, 201);
  await api('/reservations', 'POST', { propertyId: p.id, guestName: 'Owner block', platform: 'direct', checkIn: '2030-04-01', checkOut: '2030-04-03', revenue: 0, status: 'blocked', paymentStatus: 'unknown' }, 201);
  await api('/reservations', 'POST', { ...base, propertyId: zarProp.id, dubaiCharges: false, checkIn: '2030-01-01', checkOut: '2030-01-03' }, 201);
  const allBookings = await api('/reservations');
  const verifiedAed = allBookings.filter(r => r.financeMode === 'inclusive-v1' && r.propertyId === p.id && r.status !== 'cancelled').reduce((n, r) => n + Math.round(r.revenue * 100), 0) / 100;
  const zarBooking = allBookings.find(r => r.propertyId === zarProp.id && r.financeMode === 'inclusive-v1');
  const zarShown = Math.round(Number(zarBooking.revenue) * 20) / 100;
  const direct = (await api('/platforms')).platforms.find(x => x.key === 'direct');
  assert.equal(direct.revenue, Math.round((verifiedAed + zarShown) * 100) / 100); assert.equal(direct.unverifiedBookings, 1);
  assert.equal(direct.bookings, 4, 'blocked dates are not bookings');
  const split = (await api('/reports/platforms')).find(x => x.platform === 'direct');
  assert.equal(split.revenue, direct.revenue); assert.equal(split.currency, 'AED'); assert.equal(split.count, 4);
  const pnl = await api('/reports/pnl');
  assert.equal(pnl.find(x => x.propertyId === p.id).revenue, verifiedAed);
  assert.equal(pnl.find(x => x.propertyId === zarProp.id).currency, 'AED');
  assert.equal(pnl.find(x => x.propertyId === zarProp.id).revenue, zarShown);
  assert.notEqual(Number(zarBooking.revenue), zarShown, 'the stored booking amount is not rewritten into dirhams');
  passed.push('channel/P&L revenue = verified bookings in dirhams, no blocks');

  // History is never destroyed by deletes; empty records can still be removed.
  await api(`/properties/${p.id}`, 'DELETE', undefined, 409);
  await api(`/owners/${owner.id}`, 'DELETE', undefined, 409);
  const spare = await api('/properties', 'POST', { name: 'Spare', unitNumber: 'S-1' }, 201);
  await api(`/accounting/settings/${spare.id}`, 'PUT', { managementFeePercent: 15 });
  await api(`/properties/${spare.id}`, 'DELETE', undefined, 204);
  const cleaner = await api('/staff', 'POST', { name: 'Has history', role: 'cleaner', active: true }, 201);
  const task = (await api('/cleaning')).find(t => t.reservationId === b.id);
  await api(`/cleaning/${task.id}`, 'PATCH', { assignedToId: cleaner.id });
  await api(`/staff/${cleaner.id}`, 'DELETE', undefined, 409);
  await api(`/staff/${cleaner.id}`, 'PATCH', { active: false });
  await api(`/staff/${cleaner.id}`, 'PATCH', { id: 999 }, 400);
  await api(`/owners/${owner.id}`, 'PATCH', { id: 999 }, 400);
  const lonely = await api('/owners', 'POST', { name: 'No properties' }, 201);
  await api(`/owners/${lonely.id}`, 'DELETE', undefined, 204);
  passed.push('deletes keep history; owner/staff edits validated');

  // Administrator can reset a staff password; old password stops working.
  const u = await api('/users', 'POST', { name: 'Forgetful', email: 'forgetful@example.invalid', password: 'Old-pass-6284!', role: 'operations' }, 201);
  await api(`/users/${u.id}`, 'PATCH', { password: 'short' }, 400);
  await api(`/users/${u.id}`, 'PATCH', { password: 'New-pass-6284!' });
  await api('/auth/login', 'POST', { email: u.email, password: 'Old-pass-6284!' }, 401);
  await api('/auth/login', 'POST', { email: u.email, password: 'New-pass-6284!' });
  passed.push('admin password reset');
  // A cleaner whose staff profile email was typed with capitals can still see their tasks.
  await api('/users', 'POST', { name: 'Case Cleaner', email: 'Case.Cleaner@Example.invalid', password: 'Clean-only-6284!', role: 'cleaner' }, 201);
  const cs = await api('/staff', 'POST', { name: 'Case Cleaner', email: 'Case.Cleaner@Example.invalid', role: 'cleaner', active: true }, 201);
  const b2 = await api('/reservations', 'POST', { ...base, checkIn: '2030-05-01', checkOut: '2030-05-03' }, 201);
  const t2 = (await api('/cleaning')).find(t => t.reservationId === b2.id);
  await api(`/cleaning/${t2.id}`, 'PATCH', { assignedToId: cs.id });
  const admin = token;
  token = (await api('/auth/login', 'POST', { email: 'case.cleaner@example.invalid', password: 'Clean-only-6284!' })).token;
  assert.equal((await api('/cleaning')).length, 1);
  await api(`/cleaning/${t2.id}`, 'PATCH', { status: 'in_progress' });
  token = admin;
  passed.push('cleaner email case-insensitive');

  // Rates come from the property's fee settings, never from the browser; verified bookings keep their snapshot.
  const rp = await api('/properties', 'POST', { name: 'Rates 2BR', unitNumber: 'R-2', ownerId: owner.id, bedrooms: 2, city: 'Dubai', currency: 'AED' }, 201);
  await api(`/accounting/settings/${rp.id}`, 'PUT', { managementFeePercent: 20, platformFeeBookingCom: 15, platformFeeVrbo: 8, tourismRate: 10, tourismEnabled: true, vatEnabled: true, vatPercent: 5 });
  const preview = await api(`/reservations/rates?propertyId=${rp.id}&platform=booking_com`);
  assert.deepEqual([preview.managementPercent, preview.channelPercent, preview.vatRate, preview.tourismEnabled, preview.tourismRate], [20, 15, 5, true, 10]);
  const forged = await api('/reservations', 'POST', { propertyId: rp.id, guestName: 'Forged rates', platform: 'booking_com', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 3300, cleaningFee: 200, checkIn: '2031-01-01', checkOut: '2031-01-04',
    managementPercent: 1, channelPercent: 0, vatRate: 0, tourismRate: 0, dubaiCharges: false, managementAmount: 1, ownerAmount: 3000, vatAmount: 0 }, 201);
  assert.deepEqual([forged.managementPercent, forged.channelPercent, forged.vatRate, forged.tourismFee, forged.ownerAmount], [20, 15, 5, 60, 1805.71], 'client-sent rates are ignored');
  const vr = await api('/reservations', 'POST', { propertyId: rp.id, guestName: 'Vrbo guest', platform: 'vrbo', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, cleaningFee: 0, checkIn: '2031-02-01', checkOut: '2031-02-02' }, 201);
  assert.equal(vr.channelPercent, 8, 'Vrbo uses its own channel fee');
  await api(`/accounting/settings/${rp.id}`, 'PUT', { managementFeePercent: 25 });
  const edited = await api(`/reservations/${forged.id}`, 'PATCH', { grossAmount: 3300, managementPercent: 99, notes: 'edited' });
  assert.equal(edited.managementPercent, 20, 'verified booking keeps its snapshot rate after the property rate changes');
  const refreshed = await api(`/reservations/${forged.id}`, 'PATCH', { refreshRates: true });
  assert.equal(refreshed.managementPercent, 25, 'explicit re-apply uses the current property rate');
  passed.push('server-authoritative rates + booking snapshot');

  // Management % and cleaning fee have one home (fee settings); the property screens read and write it.
  const fp = await api('/properties', 'POST', { name: 'Fees 1BR', unitNumber: 'F-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED', managementFee: '17', cleaningFee: '120' }, 201);
  assert.deepEqual([fp.managementFee, fp.cleaningFee], ['17', '120']);
  const feeRow = () => api('/accounting/settings').then(rows => rows.find(r => r.propertyId === fp.id));
  assert.deepEqual([(await feeRow()).managementFeePercent, (await feeRow()).cleaningFee], [17, 120], 'property fees are stored in fee settings');
  await api(`/properties/${fp.id}`, 'PATCH', { cleaningFee: '130', managementFee: '18' });
  assert.deepEqual([(await feeRow()).managementFeePercent, (await feeRow()).cleaningFee], [18, 130], 'property edit updates fee settings');
  await api(`/accounting/settings/${fp.id}`, 'PUT', { cleaningFee: 140 });
  const fpGet = await api(`/properties/${fp.id}`);
  assert.deepEqual([fpGet.managementFee, fpGet.cleaningFee], ['18', '140'], 'fee settings change shows on the property');
  assert.equal((await api('/properties')).find(x => x.id === fp.id).cleaningFee, '140');
  await api(`/properties/${fp.id}`, 'PATCH', { managementFee: '101' }, 400);
  const snap = await api('/reservations', 'POST', { propertyId: fp.id, guestName: 'Snapshot', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, checkIn: '2031-03-01', checkOut: '2031-03-03' }, 201);
  assert.equal(snap.cleaningFee, 140, 'booking takes the property cleaning fee when none is entered');
  await api(`/accounting/settings/${fp.id}`, 'PUT', { cleaningFee: 150 });
  const snapEdit = await api(`/reservations/${snap.id}`, 'PATCH', { notes: 'later edit' });
  assert.equal(snapEdit.cleaningFee, 140, 'existing booking keeps its cleaning fee snapshot');
  const own = await api('/reservations', 'POST', { propertyId: fp.id, guestName: 'Own fee', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, cleaningFee: 90, checkIn: '2031-04-01', checkOut: '2031-04-03' }, 201);
  assert.equal(own.cleaningFee, 90, 'an entered booking cleaning fee is kept');
  // Blank fees on a new property use Settings > Property Defaults.
  await api('/settings/property', 'PUT', { value: { managementFee: 22, cleaningFee: 175 } }, 201);
  const dp = await api('/properties', 'POST', { name: 'Defaults', unitNumber: 'D-1', ownerId: owner.id, bedrooms: 2 }, 201);
  assert.deepEqual([dp.managementFee, dp.cleaningFee], ['22', '175']);
  await api('/settings/property', 'PUT', { value: { managementFee: '', cleaningFee: '' } });
  const dp2 = await api('/properties', 'POST', { name: 'Defaults 2', unitNumber: 'D-2', ownerId: owner.id, bedrooms: 2 }, 201);
  assert.deepEqual([dp2.managementFee, dp2.cleaningFee], ['20', null], 'blank defaults mean 20% and no cleaning fee');
  const batch = await api('/properties/batch', 'POST', { properties: [{ name: 'Batch fee', unitNumber: 'B-9', managementFee: '16', cleaningFee: '80' }] }, 201);
  const bRow = (await api('/accounting/settings')).find(r => r.propertyName === 'Batch fee');
  assert.deepEqual([bRow.managementFeePercent, bRow.cleaningFee], [16, 80], 'bulk import stores fees in fee settings');
  passed.push('single source for management % and cleaning fee');

  // One owner statement per property per month, however often statements are generated or listed.
  await api('/accounting/statements/generate', 'POST', { month: '2031-03' });
  await api('/accounting/statements/generate', 'POST', { month: '2031-03' });
  await api('/accounting/statements?month=2031-03');
  const mar = (await api('/accounting/statements?month=2031-03')).filter(s => s.propertyId === fp.id);
  assert.equal(mar.length, 1, 'one statement per property/month');
  assert.deepEqual(await api('/accounting/statements/duplicates'), []);
  passed.push('one owner statement per property/month');

  // "Include cleaning costs" off: booking owner amount and owner statement both leave the cleaning fee with the owner.
  const ownerSum = async () => (await api('/reservations')).filter(r => r.propertyId === fp.id && r.checkOut.startsWith('2031-03') && r.status !== 'cancelled').reduce((n, r) => n + Math.round(Number(r.ownerAmount) * 100), 0) / 100;
  const stmtFor = async () => (await api('/accounting/statements?month=2031-03')).find(s => s.propertyId === fp.id);
  const beforeOwner = Number((await api(`/reservations/${snap.id}`)).ownerAmount);
  const off = await api(`/accounting/settings/${fp.id}`, 'PUT', { includeCleaning: false });
  assert.ok(off.bookingsRecalculated >= 1);
  assert.equal(Number((await api(`/reservations/${snap.id}`)).ownerAmount), Math.round((beforeOwner + 140) * 100) / 100, 'owner keeps the cleaning fee when not included');
  let st = await stmtFor();
  assert.equal(st.cleaningCosts, 0); assert.equal(st.ownerPayout, await ownerSum(), 'statement payout = booking owner amounts (cleaning off)');
  const offNew = await api('/reservations', 'POST', { propertyId: fp.id, guestName: 'Off', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, cleaningFee: 100, checkIn: '2031-03-10', checkOut: '2031-03-12' }, 201);
  assert.equal(Number(offNew.ownerAmount), Number(offNew.revenue) - Number(offNew.managementAmount) - Number(offNew.channelAmount), 'new booking follows the setting');
  await api(`/accounting/settings/${fp.id}`, 'PUT', { includeCleaning: true });
  assert.equal(Number((await api(`/reservations/${snap.id}`)).ownerAmount), beforeOwner);
  st = await stmtFor();
  assert.equal(st.cleaningCosts, 240); assert.equal(st.ownerPayout, await ownerSum(), 'statement payout = booking owner amounts (cleaning on)');
  passed.push('include-cleaning setting: booking owner amount and statement agree');

  console.log('PASS: ' + passed.join('; '));
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
