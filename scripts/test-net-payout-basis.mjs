// Fee basis "management % of channel net payout" (Dylan's houses, 15%): one calculation for preview, booking
// edit, import and statements; channel line = actual fees; missing fees block (no 3% fallback); co-host payout
// already paid by Airbnb leaves "Settled (rounding)"; bookings on another basis must be recalculated; other
// properties unchanged. Breakdown import reads the verified cohost_payout column first.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bookingFinance } from '../lib/booking-finance.mjs';
import { parseBreakdowns, cohostFor, channelFeesOf, netPayoutCheck } from '../artifacts/api-server/src/lib/airbnb-breakdowns.mjs';
import { statementBalance, feeLabels } from '../artifacts/yallastay/src/lib/statement-balance.ts';
import { statementHtml } from '../artifacts/yallastay/src/lib/print-statement.ts';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── The calculation ──
const base = { managementPercent: 15, nights: 3, rooms: 2, dubai: false, vatRate: 0, tourismEnabled: false, cleaningFee: 0 };
const g1 = bookingFinance({ ...base, total: '2730.00', feeBasis: 'net-payout', channelFees: '444.31', channelPercent: 3 });
assert.equal(g1.channelAmount, 444.31, 'channel line = actual fees, not 3%'); assert.equal(g1.netPayout, 2285.69);
assert.equal(g1.managementAmount, 342.85); assert.equal(g1.ownerAmount, 1942.84); assert.equal(g1.feeBasis, 'net-payout');
assert.equal(g1.revenue, 2730); assert.equal(g1.vatAmount, 0);
assert.throws(() => bookingFinance({ ...base, total: '2730.00', feeBasis: 'net-payout', channelFees: null }), /actual fees/, 'no fallback to a percentage');
assert.throws(() => bookingFinance({ ...base, total: '2730.00', feeBasis: 'net-payout', channelFees: '' }), /actual fees/);
assert.throws(() => bookingFinance({ ...base, total: '100.00', feeBasis: 'net-payout', channelFees: '100.01' }), /exceed/);
assert.throws(() => bookingFinance({ ...base, vatRate: 5, total: '100.00', feeBasis: 'net-payout', channelFees: '10' }), /VAT or tourism/);
const std = bookingFinance({ total: 3300, managementPercent: 20, cleaningFee: 200, nights: 3, rooms: 2, dubai: true, channelPercent: 15 });
assert.equal(std.ownerAmount, 1805.71, 'standard basis unchanged'); assert.equal(std.feeBasis, null); assert.equal(std.channelFees, undefined);
// ── Balance and labels ──
assert.equal(statementBalance({ ownerPayout: 0.01, paidByAirbnb: 4328.32 }).label, 'Settled (rounding)');
assert.equal(statementBalance({ ownerPayout: -0.99, paidByAirbnb: 1 }).settled, true);
assert.equal(statementBalance({ ownerPayout: -1.00, paidByAirbnb: 1 }).label, 'Owner owes company');
assert.equal(statementBalance({ ownerPayout: 0.5 }).settled, false, 'no co-host payout: not "settled"');
assert.equal(feeLabels({ feeBasis: 'net-payout', bookingDetails: '[{"managementPercent":"15.00"}]' }).management, 'Management fee (15% of net payout)');
assert.equal(feeLabels({ feeBasis: null }).platform, 'Platform fees');
// ── Breakdown parsing ──
assert.deepEqual(cohostFor({ cohost_payout: '1942.83', cohost_payout_to: 'Dylan', notes: 'Co-host payouts shown as deductions.' }, []), { mentioned: true, amount: '1942.83', source: 'column', suggested: null, to: 'Dylan' });
assert.equal(cohostFor({ cohost_payout: '', notes: 'Co-host payout shown as deduction -10.00' }, []).source, 'notes');
assert.equal(cohostFor({ notes: 'Co-host payouts shown as deductions.', other_fees: '-877.30' }, []).suggested, '877.30');
assert.equal(channelFeesOf('173.56', '36.88'), '210.44'); assert.equal(channelFeesOf(null, '36.88'), null);
assert.equal(netPayoutCheck({ guestTotal: '1242.56', channelFees: '210.44', hostPayout: '154.82', cohostAmount: '877.30' }).check, 'match');
assert.equal(netPayoutCheck({ guestTotal: '1000.00', channelFees: '100.00', hostPayout: '100.00', cohostAmount: '700.00' }).check, 'differs');
// Printable statement on this basis
const pst = { propertyName: 'P', ownerName: 'O', month: '2026-09', currency: 'ZAR', status: 'draft', bookingsCount: 2, nightsOccupied: 6, grossRevenue: 6082, platformFees: 989.85, managementFee: 763.82,
  cleaningCosts: 0, maintenanceCosts: 0, otherExpenses: 0, tourismFee: 0, vatAmount: 0, ownerPayout: 0.01, paidByAirbnb: 4328.32, feeBasis: 'net-payout', bookingDetails: JSON.stringify([{ guestName: 'G', managementPercent: '15.00', grossAmount: '2730.00', ownerAmount: '1942.84', cohostPayout: '1942.83' }]) };
const ph = statementHtml(pst, []);
assert.match(ph, /Channel fees \(actual\)<\/td><td class="r">− ZAR 989\.85/); assert.match(ph, /Net payout \(guest total − channel fees\)<\/td><td class="r">ZAR 5,092\.15/);
assert.match(ph, /Management fee \(15% of net payout\)<\/td><td class="r">− ZAR 763\.82/); assert.match(ph, /Settled \(rounding\)<\/td><td class="r">Nothing owed/);

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-netbasis-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3021', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, RESEND_API_KEY: 're_test_only' };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3021/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const cents = v => Math.round(Number(v) * 100);
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Net Admin', email: 'net@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const GH = await api('/properties', 'POST', { name: 'Grey House', unitNumber: 'GH', city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const GL = await api('/properties', 'POST', { name: 'Green Lawn House', unitNumber: 'GL', city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 3 }, 201);
  const other = await api('/owners', 'POST', { name: 'Other Owner' }, 201);
  const ST = await api('/properties', 'POST', { name: 'Standard House', unitNumber: 'ST', ownerId: other.id, city: 'Gqeberha', currency: 'ZAR', bedrooms: 1 }, 201);
  const mk = async (p, code, ci, co) => { const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co }, 201); await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` }); return b; };
  // Green Lawn: one booking verified on the standard basis before the fee decision.
  const old = await mk(GL, 'HMGREEN001', '2026-09-10', '2026-09-12');
  await api(`/reservations/${old.id}`, 'PATCH', { grossAmount: '1000.00', financeMode: 'inclusive-v1', cleaningFee: '0' });
  // The suggested-owner card: create Dylan, assign, one settings save per property (co-host + fee basis).
  const sug = (await api('/owners/suggestions')).find(s => s.key === 'dylan-matthysen');
  assert.deepEqual(sug.feeOption, { basis: 'net-payout', percent: 15, label: 'Fee: 15% of Airbnb net payout' });
  const d = await api('/owners', 'POST', { name: sug.name, phone: sug.phone }, 201);
  for (const p of sug.properties) {
    await api(`/properties/${p.match.id}`, 'PATCH', { ownerId: d.id });
    await api(`/accounting/settings/${p.match.id}`, 'PUT', { cohostPaidToOwner: true, feeBasis: sug.feeOption.basis, managementFeePercent: sug.feeOption.percent });
  }
  const settings = await api('/accounting/settings');
  for (const id of [GH.id, GL.id]) { const s = settings.find(x => x.propertyId === id); assert.equal(s.feeBasis, 'net-payout'); assert.equal(Number(s.managementFeePercent), 15); assert.equal(s.cohostPaidToOwner, true); }
  assert.equal(settings.find(x => x.propertyId === ST.id).feeBasis, 'gross');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'property_settings' && a.entityId === GH.id && JSON.stringify(a.details).includes('net-payout')), 'fee basis change audit-logged');
  await api(`/accounting/settings/${GH.id}`, 'PUT', { feeBasis: 'bogus' }, 400);

  const b1 = await mk(GH, 'HMGREY0001', '2026-09-03', '2026-09-06');
  const b2 = await mk(GH, 'HMGREY0002', '2026-09-25', '2026-09-28');
  const b3 = await mk(GH, 'HMNOFEES01', '2026-09-14', '2026-09-16');
  const b4 = await mk(GH, 'HMNETBAD01', '2026-09-18', '2026-09-20');
  const s1 = await mk(ST, 'HMSTD00001', '2026-09-05', '2026-09-07');
  await mk(ST, 'HMSTD00002', '2026-11-10', '2026-11-12');
  const H = 'confirmation_code,listing_name,guest_name,check_in,checkout,nights,status,guest_paid_total,accommodation_total,cleaning_fee,guest_service_fee,host_service_fee,taxes,tax_types,other_fees,cohost_payout,cohost_payout_to,host_payout,currency,payout_date,source,notes';
  const L = (code, ci, co, total, gsf, hsf, cohost, payout, notes = '') => [code, 'x', 'G', ci, co, '3', 'past guest', total, total, '', gsf, hsf, '', '', cohost ? `-${cohost}` : '', cohost, cohost ? 'Dylan Matthysen' : '', payout, 'ZAR', '', 'reservation details page', notes].join(',');
  const csv = [H,
    L('HMGREY0001', '2026-09-03', '2026-09-06', '2730.00', '0.00', '444.31', '1942.83', '342.86', 'Co-host payouts and host service fee shown as deductions.'),
    L('HMGREY0002', '2026-09-25', '2026-09-28', '3352.00', '0.00', '545.54', '2385.49', '420.97'),
    L('HMNOFEES01', '2026-09-14', '2026-09-16', '900.00', '', '', '600.00', '100.00'),
    L('HMNETBAD01', '2026-09-18', '2026-09-20', '1000.00', '0.00', '100.00', '700.00', '100.00'),
    L('HMSTD00001', '2026-09-05', '2026-09-07', '1000.00', '0.00', '163.00', '', '837.00'),
    L('HMSTD00002', '2026-11-10', '2026-11-12', '1000.00', '0.00', '163.00', '', '800.00'),
  ].join('\n');
  const pv = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv });
  const row = c => pv.rows.find(r => r.code === c);
  assert.equal(row('HMGREY0001').bulkOk, true, 'verified co-host column: clean even though the notes have no amount');
  assert.equal(row('HMGREY0001').cohost.source, 'column'); assert.equal(row('HMGREY0001').channelFees, '444.31');
  assert.equal(row('HMGREY0001').preview.feeBasis, 'net-payout'); assert.equal(row('HMGREY0001').preview.channelAmount, 444.31); assert.equal(row('HMGREY0001').preview.managementAmount, 342.85);
  assert.ok(row('HMNOFEES01').blocking.some(m => /no Airbnb fees/i.test(m)), 'net basis without fees is blocked');
  assert.ok(row('HMNETBAD01').review.some(m => /doesn't equal the co-host \+ host payout/.test(m)));
  assert.ok(!row('HMSTD00002').review.some(m => /doesn't equal/.test(m)), 'the net cross-check never flags standard-basis properties (they import as before)');
  assert.equal(row('HMSTD00001').bulkOk, true); assert.equal(row('HMSTD00001').preview.feeBasis, 'gross'); assert.equal(row('HMSTD00001').preview.channelAmount, 163, 'standard property: Airbnb\'s actual fees from the breakdown, not the % estimate');
  for (const r of pv.rows.filter(r => r.bulkOk)) await api(`/reservations/${r.reservationId}`, 'PATCH', { grossAmount: r.guestTotal, financeMode: 'inclusive-v1', cohostPayout: r.cohost.amount ?? undefined, channelFees: r.channelFees ?? undefined });
  const r1 = await api(`/reservations/${b1.id}`);
  assert.equal(r1.feeBasis, 'net-payout'); assert.equal(r1.channelAmount, 444.31); assert.equal(r1.managementAmount, 342.85); assert.equal(r1.ownerAmount, 1942.84); assert.equal(r1.channelFees, 444.31);
  const rs = await api(`/reservations/${s1.id}`);
  assert.equal(rs.feeBasis, null); assert.equal(rs.channelAmount, 163); assert.equal(rs.managementAmount, 200); assert.equal(rs.ownerAmount, 637); assert.equal(rs.channelFees, 163, 'standard basis: actual fees are the channel line, management stays % of revenue');
  // One path: the preview of an edit equals the saved result; no fees = clear error, never 3%.
  const fp = await api(`/reservations/${b1.id}/finance-preview`, 'POST', { grossAmount: '2730.00', channelFees: '444.31' });
  assert.equal(fp.ok, true); assert.equal(fp.feeBasis, 'net-payout'); assert.equal(fp.ownerAmount, 1942.84); assert.equal(fp.managementAmount, 342.85);
  const e1 = await api(`/reservations/${b3.id}`, 'PATCH', { grossAmount: '900.00', financeMode: 'inclusive-v1', cohostPayout: '600.00' }, 400);
  assert.match(e1.error, /actual fees/);
  // Direct booking: no channel, no channel fees.
  const dir = await api('/reservations', 'POST', { propertyId: GH.id, guestName: 'Direct', platform: 'direct', status: 'confirmed', checkIn: '2026-10-20', checkOut: '2026-10-22', financeMode: 'inclusive-v1', grossAmount: 500 }, 201);
  assert.equal(dir.channelAmount, 0); assert.equal(dir.feeBasis, 'net-payout'); assert.equal(dir.managementAmount, 75);

  // Statements: Grey House has 2 bookings still unverified (no fees / net mismatch) -> blocked; verify them by hand.
  let gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  assert.ok(gen.skipped.some(s => s.propertyId === GH.id && s.unverified?.length === 2));
  await api(`/reservations/${b3.id}`, 'PATCH', { cancelled: undefined, status: 'cancelled' });
  await api(`/reservations/${b4.id}`, 'PATCH', { status: 'cancelled' });
  // Green Lawn: verified on the standard basis before the switch -> blocked, listed on Verify as needing the fees.
  const skipGL = gen.skipped.find(s => s.propertyId === GL.id);
  assert.equal(skipGL.feeBasisMismatch.length, 1); assert.equal(skipGL.feeBasisMismatch[0].feesMissing, true); assert.match(skipGL.reason, /actual fees on Verify/);
  const unv = await api('/reservations/unverified?month=2026-09');
  const ur = unv.find(r => r.id === old.id);
  assert.ok(ur && ur.needsRecalc && ur.verified && ur.feeBasis === 'net-payout' && ur.channelFees === null && ur.cohostRequired);
  await api(`/reservations/${old.id}`, 'PATCH', { channelFees: '163.00', cohostPayout: '711.45' });
  const oldR = await api(`/reservations/${old.id}`);
  assert.equal(oldR.feeBasis, 'net-payout'); assert.equal(oldR.managementAmount, 125.55); assert.equal(oldR.ownerAmount, 711.45);
  assert.ok(!(await api('/reservations/unverified?month=2026-09')).some(r => r.id === old.id));

  gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  const sts = await api('/accounting/statements?month=2026-09');
  const gh = sts.find(s => s.propertyId === GH.id), gl = sts.find(s => s.propertyId === GL.id), st = sts.find(s => s.propertyId === ST.id);
  assert.equal(gh.feeBasis, 'net-payout'); assert.equal(cents(gh.grossRevenue), 608200); assert.equal(cents(gh.platformFees), 98985, 'actual Airbnb fees');
  assert.equal(cents(gh.managementFee), 76382, '15% of net payout'); assert.equal(cents(gh.paidByAirbnb), 432832); assert.equal(cents(gh.ownerPayout), 1, 'balance about 0');
  assert.equal(JSON.parse(gh.bookingDetails)[0].feeBasis, 'net-payout');
  assert.equal(cents(gl.ownerPayout), 0, 'Green Lawn settled exactly');
  assert.equal(st.feeBasis, null); assert.equal(cents(st.platformFees), 16300, 'standard basis: actual Airbnb fees'); assert.equal(cents(st.ownerPayout), 63700);
  assert.ok(!('channelFees' in JSON.parse(st.bookingDetails)[0]), 'standard statements keep their booking details shape');
  assert.doesNotMatch(st.notes, /net payout/);
  // Settled (rounding): can be marked paid; no owner payout recorded.
  await api(`/accounting/statements/${gh.id}`, 'PATCH', { status: 'sent' });
  await api(`/accounting/statements/${gh.id}`, 'PATCH', { status: 'paid' });
  const pays = await api('/payments');
  const list = Array.isArray(pays) ? pays : pays.items ?? [];
  assert.ok(!list.some(p => p.type === 'owner_payout' && String(p.description || '').includes(`#${gh.id}`)), 'settled: no payout row');
  // Switching a property back to standard: its net-payout bookings must be recalculated before a statement.
  await api(`/accounting/settings/${GL.id}`, 'PUT', { feeBasis: 'gross' });
  gen = await api('/accounting/statements/generate', 'POST', { month: '2026-09' });
  assert.match(gen.skipped.find(s => s.propertyId === GL.id).reason, /now uses the standard basis/);

  await new Promise(r => setTimeout(r, 300));
  assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'nothing sent');
  console.log('PASS: net-payout fee basis (actual channel fees, 15% of net payout, one calculation path, missing fees block, recalculation after a basis change, settled rounding, standard properties unchanged); verified cohost_payout column read first');
} catch (e) { console.error(logs.slice(-3000)); console.error(e); process.exitCode = 1; } finally { child.kill('SIGTERM'); }
