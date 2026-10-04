// Money you can prove: (1) owner payouts are recorded against a statement with date, method and bank reference,
// and a statement is only marked paid once its payout records add up to the balance; (2) the Airbnb payout check
// reads the earnings file and the reservation breakdowns, matches payouts to bookings by confirmation code and
// flags payouts with no booking, amounts that disagree, bookings with no payout and transfers it can't tie to
// bookings. USD transfers are never added to AED or ZAR; only the fixed AED peg (3.6725) is used, to check them.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parsePayoutFile, reconcilePayouts } from '../lib/payout-recon.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const EH = 'listing_name,confirmation_code,guest_name,check_in,checkout,cohost_payout,cohost_payout_to,host_payout,currency,payout_status,payout_date,notes';
const earnings = [EH,
  ',,,,,,,55.17,USD,paid,2026-09-21,Type: Payout; Details: Transfer to PayPal: c••••n\u200c@icloud\u200c\u2024\u200ccom (USD); Reference code: QTJ1; host_payout taken from export',
  'Garden Test,HMGARDEN01,Ann,2026-09-20,2026-09-21,,,202.61,AED,paid,2026-09-21,Export rows: Reservation 202.61',
  ',,,,,,,31.83,USD,paid,2026-09-25,Type: Payout; Details: Transfer to PayPal: c••••n@icloud.com (USD); Reference code: HTG1',
  'Lawn Test,HMLAWN0001,Bea,2026-09-24,2026-09-26,2965.57,Dylan (expected; name not shown on Airbnb),523.33,ZAR,paid,2026-09-25,"Export has only a positive \'Co-Host payout\' row"',
  'Grey Test,HMGREY0001,Cat,2026-09-25,2026-09-27,-2385.49,Dylan (expected),2806.46,ZAR,paid,2026-09-26,Export rows: Co-Host payout -2385.49 + Reservation 2806.46',
  ',,,,,,,114.54,USD,paid,2026-09-26,Type: Payout; Details: Transfer to PayPal: c••••n@icloud.com (USD); Reference code: WHH1',
  'Garden Test,HMGARDEN02,Dan,2026-09-25,2026-09-26,,,325.75,AED,paid,2026-09-26,Export rows: Reservation 325.75',
  'Lake Test,HMLAKE0001,Eve,2026-09-10,2026-09-13,,,3719.24,ZAR,paid,2026-09-11,From the owner\'s account export',
  ',,,,,,,3719.24,ZAR,paid,2026-09-18,Type: Payout; Details: Transfer to Atj Fourie\u002c 4815 (ZAR); Reference code: ; host_payout taken from export',
  ',,,,,,,40.00,USD,paid,2026-09-05,Type: Payout; Details: Transfer to PayPal: c••••n@icloud.com (USD); Reference code: ORPHAN1',
  'Ghost Test,HMGHOST001,Fay,2026-09-15,2026-09-16,,,99.00,AED,paid,2026-09-16,Not a YallaPMS booking',
  'Lawn Test,HMLAWN0002,Gus,2026-10-04,2026-10-06,6149.09,Dylan (expected),1085.14,ZAR,upcoming,2026-10-05,Upcoming',
].join('\n').replace('Atj Fourie\u002c 4815', '"Atj Fourie, 4815').replace('(ZAR); Reference code: ; host_payout taken from export', '(ZAR); Reference code: ; host_payout taken from export"');
const BH = 'confirmation_code,listing_name,guest_name,check_in,checkout,nights,status,guest_paid_total,accommodation_total,cleaning_fee,guest_service_fee,host_service_fee,taxes,tax_types,other_fees,cohost_payout,cohost_payout_to,host_payout,currency,payout_date,source,notes';
const breakdowns = [BH,
  'HMGARDEN02,Garden Test,Dan,2026-09-25,2026-09-26,1,past guest,389.06,389.06,,0.00,63.32,,VAT,,,,325.74,AED,,page,export showed 325.75',
  'HMGREY0001,Grey Test,Cat,2026-09-25,2026-09-27,2,past guest,3240.00,3240.00,,0.00,433.54,,VAT,-2385.49,2385.49,Dylan (expected),420.97,ZAR,,page,',
  'HMLAWN0001,Lawn Test,Bea,2026-09-24,2026-09-26,2,past guest,4000.00,4000.00,,0.00,511.10,,VAT,-2965.57,2965.57,Dylan (expected),523.33,ZAR,,page,',
  'HMBDONLY01,Garden Test,Hal,2026-09-22,2026-09-23,1,past guest,300.00,300.00,,0.00,48.00,,VAT,,,,252.00,AED,,page,not in the earnings file',
].join('\n');

// ── Pure ──
{
  const e = parsePayoutFile(earnings, 'cohost_earnings.csv'), b = parsePayoutFile(breakdowns, 'reservation_breakdowns.csv');
  assert.equal(e.format, 'earnings'); assert.equal(b.format, 'breakdown');
  assert.equal(e.lines.filter(l => l.kind === 'transfer').length, 5); assert.equal(e.lines.filter(l => l.kind === 'booking').length, 7);
  const t = e.lines.find(l => l.reference === 'QTJ1'); assert.equal(t.destination, 'PayPal: c••••n@icloud.com (USD)', 'invisible characters removed');
  const grey = e.lines.find(l => l.confirmationCode === 'HMGREY0001');
  assert.equal(grey.amount, 420.97, 'Grey House: export amount is before the co-host cut; the negative co-host line is taken off'); assert.equal(grey.cohostPayout, 2385.49); assert.equal(grey.cohostBasis, 'paid');
  const lawn = e.lines.find(l => l.confirmationCode === 'HMLAWN0001');
  assert.equal(lawn.amount, 523.33); assert.equal(lawn.cohostBasis, 'expected', 'a positive co-host amount only comes from the breakdown: expected, not paid');
  assert.equal(e.lines.find(l => l.confirmationCode === 'HMLAWN0002').status, 'upcoming');
  assert.throws(() => parsePayoutFile('a,b\n1,2'), /not an Airbnb payout file/);
  assert.throws(() => parsePayoutFile(earnings.replace('202.61,AED', '202.6x,AED')), /not an amount/);
  assert.throws(() => parsePayoutFile(earnings.replace('2026-09-21,Export', '21/09/2026,Export')), /not a YYYY-MM-DD/);

  const props = [{ id: 1, name: 'Garden Test', currency: 'AED' }, { id: 2, name: 'Lawn Test', currency: 'ZAR' }, { id: 3, name: 'Grey Test', currency: 'ZAR' }, { id: 4, name: 'Lake Test', currency: 'ZAR' }];
  const bk = (id, propertyId, code, checkIn, checkOut, extra = {}) => ({ id, propertyId, externalId: `airbnb:${code}`, guestName: `G${id}`, platform: 'airbnb', status: 'confirmed', checkIn, checkOut, currency: null, financeMode: null, ...extra });
  const bookings = [bk(1, 1, 'HMGARDEN01', '2026-09-20', '2026-09-21', { financeMode: 'inclusive-v1', grossAmount: '240.00', channelFees: '37.39' }), bk(2, 2, 'HMLAWN0001', '2026-09-24', '2026-09-26', { financeMode: 'inclusive-v1', grossAmount: '4000.00', channelFees: '511.10', cohostPayout: '2965.57' }),
    bk(3, 3, 'HMGREY0001', '2026-09-25', '2026-09-27', { cohostPayout: '2385.00' }), bk(4, 1, 'HMGARDEN02', '2026-09-25', '2026-09-26'), bk(5, 4, 'HMLAKE0001', '2026-09-10', '2026-09-13'), bk(6, 2, 'HMLAWN0002', '2026-10-04', '2026-10-06'),
    bk(7, 1, 'HMNOPAY001', '2026-09-17', '2026-09-19'), bk(8, 1, 'HMCANCEL01', '2026-09-18', '2026-09-19', { status: 'cancelled' })];
  const r = reconcilePayouts({ lines: [...e.lines, ...b.lines], bookings, properties: props, today: '2026-10-04' });
  const row = c => r.rows.find(x => x.code === c);
  assert.equal(row('HMGARDEN01').state, 'matched', JSON.stringify(row('HMGARDEN01').problems)); assert.equal(row('HMGARDEN01').transfer.reference, 'QTJ1');
  assert.equal(row('HMLAWN0001').state, 'matched', JSON.stringify(row('HMLAWN0001').problems)); assert.equal(row('HMLAWN0001').cohostBasis, 'expected');
  assert.equal(row('HMGREY0001').state, 'mismatch'); assert.match(row('HMGREY0001').problems.join(), /paid the co-host ZAR 2,385.49; the booking has ZAR 2,385.00/);
  assert.equal(row('HMGARDEN02').state, 'mismatch'); assert.match(row('HMGARDEN02').problems.join(), /paid AED 325.75; the booking breakdown says AED 325.74 \(difference AED 0.01\)/);
  assert.equal(row('HMGHOST001').state, 'no_booking');
  assert.equal(row('HMLAWN0002').state, 'upcoming');
  assert.equal(row('HMLAKE0001').state, 'matched'); assert.equal(row('HMLAKE0001').transfer.destination, 'Atj Fourie, 4815 (ZAR)', 'paid to the owner\'s own bank account, shown as such');
  assert.equal(row('HMBDONLY01').state, 'no_booking'); assert.match(row('HMBDONLY01').problems.join(), /not in the earnings file/);
  assert.deepEqual(r.missing.map(m => m.code), ['HMNOPAY001'], 'Airbnb booking with no payout flagged; cancelled one is not');
  const tr = ref => r.transfers.find(x => x.reference === ref);
  assert.equal(tr('QTJ1').state, 'matched'); assert.match(tr('QTJ1').check, /AED 202.61 at the fixed peg \(3.6725\) is USD 55.17/);
  assert.equal(tr('HTG1').state, 'date'); assert.match(tr('HTG1').check, /Not compared: there is no fixed ZAR rate/);
  assert.equal(tr('ORPHAN1').state, 'unmatched'); assert.equal(r.transfers[0].reference, 'ORPHAN1', 'problems first');
  assert.equal(r.transfers.find(x => x.currency === 'ZAR').state, 'matched', 'same-currency transfer matched by amount');
  // Totals stay per currency (and per account the money went to); USD is never added to AED or ZAR.
  assert.deepEqual(r.totals.transfers.map(x => x.currency).sort(), ['USD', 'ZAR']);
  assert.ok(r.totals.paid.every(x => ['AED', 'ZAR'].includes(x.currency)));
  assert.deepEqual(r.totals.paid.find(x => x.currency === 'ZAR' && x.destination === 'Atj Fourie, 4815 (ZAR)'), { currency: 'ZAR', destination: 'Atj Fourie, 4815 (ZAR)', amount: 3719.24 });
  assert.deepEqual(r.totals.upcoming, [{ currency: 'ZAR', amount: 1085.14 }]);
}

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-payouts-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3030', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3030/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Pay Admin', email: 'pay@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Pay Owner' }, 201);
  const P = await api('/properties', 'POST', { name: 'Pay Home', unitNumber: 'H1', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  await api('/reservations', 'POST', { propertyId: P.id, guestName: 'Pay Guest', platform: 'direct', status: 'confirmed', checkIn: '2026-09-18', checkOut: '2026-09-20', financeMode: 'inclusive-v1', grossAmount: 2000 }, 201);
  const gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  const st = gen.statements.find(s => s.propertyId === P.id); assert.ok(st);
  const balance = (await api('/accounting/statements?month=2026-09')).find(s => s.id === st.id).ownerPayout; assert.ok(balance > 100, `balance ${balance}`);
  const pay = (b, expected = 201) => api(`/accounting/statements/${st.id}/payouts`, 'POST', { amount: 100, paidOn: '2026-10-01', method: 'bank_transfer', reference: 'FT-001', ...b }, expected);
  assert.match((await pay({}, 409)).error, /Send the statement/, 'no payout on a draft');
  await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'sent' });
  assert.match((await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'paid' }, 400)).error, /Record the payout first/, 'no payout record, not paid');
  assert.match((await pay({ reference: '' }, 400)).error, /bank reference/);
  assert.match((await pay({ method: 'cheque', reference: '' }, 400)).error, /cheque number/);
  assert.match((await pay({ method: 'other', reference: '' }, 400)).error, /Say how/);
  assert.match((await pay({ paidOn: tomorrow }, 400)).error, /future/);
  assert.match((await pay({ paidOn: '2026-08-31' }, 400)).error, /before 2026-09/);
  assert.match((await pay({ paidOn: '2026-02-30' }, 400)).error, /real date/);
  assert.match((await pay({ amount: 0 }, 400)).error, /amount/);
  assert.match((await pay({ amount: balance + 0.01 }, 400)).error, /more than the AED/);
  assert.match((await pay({ method: 'wire' }, 400)).error, /how it was paid/i);
  const first = await pay({ amount: 100, notes: 'first part' });
  assert.equal(first.payouts.length, 1); assert.equal(first.remaining, Math.round((balance - 100) * 100) / 100);
  assert.match((await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'paid' }, 400)).error, new RegExp(`Payouts recorded: AED 100.00 of AED ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Record the remaining`));
  const cash = await pay({ amount: 5, method: 'cash', reference: '' });
  assert.equal((await api(`/accounting/statements/${st.id}/payouts/${cash.payouts.find(p => p.method === 'cash').id}`, 'DELETE')).payouts.length, 1, 'a payout can be removed while the statement is unpaid');
  await pay({ amount: Math.round((balance - 100) * 100) / 100, paidOn: '2026-10-02', reference: 'FT-002' });
  const paid = await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'paid' });
  assert.equal(paid.status, 'paid'); assert.equal(paid.paidAt, '2026-10-02', 'paid date is the last payout date, not the click date');
  const listed = (await api('/accounting/statements?month=2026-09')).find(s => s.id === st.id);
  assert.equal(listed.payouts.length, 2); assert.equal(listed.paidTotal, balance);
  assert.deepEqual(listed.payouts.map(p => [p.paidOn, p.method, p.reference]), [['2026-10-01', 'bank_transfer', 'FT-001'], ['2026-10-02', 'bank_transfer', 'FT-002']]);
  assert.match((await api(`/accounting/statements/${st.id}/payouts/${listed.payouts[0].id}`, 'DELETE', null, 409)).error, /kept/, 'paid statements keep their payout records');
  assert.match((await pay({}, 409)).error, /already marked paid/);
  const pays = (await api('/payments')).filter(p => p.type === 'owner_payout' && String(p.description).startsWith(`Owner statement #${st.id} `));
  assert.equal(pays.length, 2, 'each payout is on the Payouts list once'); assert.ok(pays.some(p => /bank transfer FT-002/.test(p.description) && p.paidAt === '2026-10-02'));
  assert.ok((await api('/audit-log')).filter(a => a.entity === 'owner_payout').length >= 4, 'payouts and their removal are in the activity log');

  // Payout check through the API.
  const G = await api('/properties', 'POST', { name: 'Garden Test', unitNumber: 'G1', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const L = await api('/properties', 'POST', { name: 'Lawn Test', unitNumber: 'L1', ownerId: owner.id, city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const mk = async (p, code, ci, co, extra = {}) => { const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co, ...extra }, 201); await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` }); return b; };
  await mk(G, 'HMGARDEN01', '2026-09-20', '2026-09-21', { financeMode: 'inclusive-v1', grossAmount: 240, channelFees: 37.39 });
  await mk(G, 'HMGARDEN02', '2026-09-25', '2026-09-26'); await mk(L, 'HMLAWN0001', '2026-09-24', '2026-09-26'); await mk(G, 'HMNOPAY001', '2026-09-22', '2026-09-23');
  await api('/accounting/payout-check/preview', 'POST', { csv: 'a,b\n1,2', fileName: 'x.csv' }, 400);
  const pv = await api('/accounting/payout-check/preview', 'POST', { csv: earnings, fileName: 'cohost_earnings.csv' });
  assert.deepEqual([pv.format, pv.bookings, pv.transfers, pv.added], ['earnings', 7, 5, 12]); assert.deepEqual(pv.currencies, ['AED', 'USD', 'ZAR']);
  assert.equal((await api('/accounting/payout-check')).rows.length, 0, 'preview stores nothing');
  await api('/accounting/payout-check/import', 'POST', { csv: earnings, fileName: 'cohost_earnings.csv' });
  await api('/accounting/payout-check/import', 'POST', { csv: breakdowns, fileName: 'reservation_breakdowns.csv' });
  const again = await api('/accounting/payout-check/preview', 'POST', { csv: earnings, fileName: 'cohost_earnings.csv' });
  assert.deepEqual([again.added, again.changed, again.unchanged], [0, 0, 12], 'importing the same file again changes nothing');
  const chk = await api('/accounting/payout-check');
  const state = c => chk.rows.find(r => r.code === c)?.state;
  assert.equal(state('HMGARDEN01'), 'matched'); assert.equal(state('HMGARDEN02'), 'mismatch'); assert.equal(state('HMGHOST001'), 'no_booking'); assert.equal(state('HMLAWN0002'), 'no_booking');
  assert.equal(state('HMLAWN0001'), 'matched');
  assert.deepEqual(chk.missing.map(m => m.code), ['HMNOPAY001']);
  assert.deepEqual(chk.imported.earnings.files, ['cohost_earnings.csv']); assert.equal(chk.imported.breakdown.lines, 4);
  assert.ok(chk.counts.transfersProblem >= 1);
  console.log('OK owner payouts (date, method, reference; paid only when recorded) and Airbnb payout check');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
