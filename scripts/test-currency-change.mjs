// Changing a property's currency never relabels recorded amounts (Garden Retreat AED → ZAR, Clifford 3 Oct 2026):
// existing bookings keep AED (stamped at change time), new bookings use ZAR, a month mixing both is held with a
// "mixed currency" item (no exchange rate), guards refuse amounts without their own currency, the suggested-owner
// card applies it audit-logged. Statement booking rows are sorted by check-in, then confirmation code.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bookingCurrency, confirmationCode, sortStatementBookings } from '../lib/booking-currency.mjs';
import { reservationFinancials } from '../lib/reservation-financials.mjs';
import { statementHtml } from '../artifacts/yallastay/src/lib/print-statement.ts';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Helpers ──
assert.equal(bookingCurrency({ currency: 'AED' }, { currency: 'ZAR' }), 'AED', 'a stamped booking keeps its currency');
assert.equal(bookingCurrency({ currency: null }, { currency: 'ZAR' }), 'ZAR');
assert.equal(bookingCurrency({}, null), 'AED');
assert.equal(reservationFinancials({ currency: 'AED', financeMode: 'inclusive-v1', grossAmount: '1727.00', revenue: '1727.00' }, [], { currency: 'ZAR' }).currency, 'AED', 'booking currency before the property\'s');
assert.equal(confirmationCode('airbnb:HMABC'), 'HMABC'); assert.equal(confirmationCode('ical:x'), null); assert.equal(confirmationCode(null), null);
const rows = [{ id: 4, checkIn: '2026-09-10', code: null }, { id: 3, checkIn: '2026-09-10', code: 'HMB' }, { id: 2, checkIn: '2026-09-10', code: 'HMA' }, { id: 9, checkIn: '2026-09-01', code: 'HMZ' }];
assert.deepEqual(sortStatementBookings(rows).map(r => r.id), [9, 2, 3, 4], 'check-in, then confirmation code (none last)');
const ph = statementHtml({ propertyName: 'P', ownerName: 'O', month: '2026-09', currency: 'AED', status: 'draft', bookingsCount: 3, nightsOccupied: 6, grossRevenue: 3, platformFees: 0, managementFee: 0, cleaningCosts: 0, maintenanceCosts: 0, otherExpenses: 0, tourismFee: 0, vatAmount: 0, ownerPayout: 3, paidByAirbnb: 0,
  bookingDetails: JSON.stringify([{ id: 1, guestName: 'Late', checkIn: '2026-09-20', grossAmount: '1' }, { id: 2, guestName: 'Second', checkIn: '2026-09-05', code: 'HMB', grossAmount: '1' }, { id: 3, guestName: 'First', checkIn: '2026-09-05', code: 'HMA', grossAmount: '1' }]) }, []);
assert.ok(ph.indexOf('First') < ph.indexOf('Second') && ph.indexOf('Second') < ph.indexOf('Late'), 'print uses the same order');

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-currency-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3023', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, RESEND_API_KEY: 're_test_only', FX_FIXED_RATES: JSON.stringify({ USD: 3.6725, ZAR: 0.2, EUR: 4, GBP: 4.8 }) };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3023/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Cur Admin', email: 'cur@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const GR = await api('/properties', 'POST', { name: 'Garden Retreat | Cozy Suite', unitNumber: 'GR', city: 'Gqeberha', currency: 'AED', bedrooms: 1 }, 201);
  const ZP = await api('/properties', 'POST', { name: 'Zar Place', unitNumber: 'ZP', city: 'Gqeberha', currency: 'ZAR', bedrooms: 1 }, 201);
  let n = 0;
  const mk = async (p, ci, co, total, code = `HMCUR${String(++n).padStart(5, '0')}`) => {
    const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co }, 201);
    await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` });
    return total ? api(`/reservations/${b.id}`, 'PATCH', { grossAmount: total, financeMode: 'inclusive-v1', cleaningFee: '0' }) : b;
  };
  // Recorded in AED before the change: Aug, Sep (two with the same check-in), Oct.
  const aug = await mk(GR, '2026-08-10', '2026-08-12', '900.00');
  const sepB = await mk(GR, '2026-09-05', '2026-09-08', '500.00', 'HMBBBBBBB2');
  const sepA = await mk(GR, '2026-09-01', '2026-09-03', '1727.00', 'HMAAAAAAA1');
  const oct = await mk(GR, '2026-10-01', '2026-10-04', '800.00');
  assert.equal(sepA.currency, 'AED');
  await api('/accounting/transactions', 'POST', { type: 'expense', amount: '50', date: '2026-09-15', category: 'Supplies', description: 'Soap', propertyId: GR.id, allocation: 'owner' }, 201);

  // The suggested-owner card for Bonnita: currency option pre-ticked; the card saves the currency first.
  const sug = (await api('/owners/suggestions')).find(s => s.key === 'bonnita');
  assert.deepEqual(sug.currencyOption, { currency: 'ZAR', label: 'Set Garden Retreat currency to ZAR' });
  assert.equal(sug.properties[0].expectedCurrency, 'ZAR'); assert.equal(sug.properties[0].match.id, GR.id);
  const changed = await api(`/accounting/settings/${GR.id}`, 'PUT', { currency: 'ZAR' });
  assert.deepEqual(changed.currencyChange, { changed: true, from: 'AED', to: 'ZAR', bookingsKeptInOldCurrency: 4, bookingsFollowingNewCurrency: 0, cleaningCostCurrencyKept: false });
  const bon = await api('/owners', 'POST', { name: sug.name, phone: sug.phone }, 201);
  await api(`/properties/${GR.id}`, 'PATCH', { ownerId: bon.id });
  const audit = await api('/audit-log');
  const entry = audit.find(a => a.entity === 'property_currency' && a.entityId === GR.id);
  assert.ok(entry && /"from":"AED"/.test(JSON.stringify(entry.details)) && /"to":"ZAR"/.test(JSON.stringify(entry.details)), 'currency change audit-logged');
  assert.equal((await api(`/properties/${GR.id}`)).currency, 'ZAR');
  assert.equal((await api('/accounting/settings')).find(s => s.propertyId === GR.id).currency, 'ZAR');
  assert.ok(!(await api('/owners/suggestions')).some(s => s.key === 'bonnita'), 'card resolved');

  // Existing amounts keep AED: never relabelled.
  for (const b of [aug, sepA, sepB, oct]) {
    const r = await api(`/reservations/${b.id}`);
    assert.equal(r.currency, 'AED'); assert.equal(r.financials.currency, 'AED');
  }
  assert.equal((await api(`/reservations/${sepA.id}`)).grossAmount, 1727, 'AED 1,727 stays AED 1,727');
  // Editing an AED booking keeps AED; the browser can't set a booking's currency.
  const edited = await api(`/reservations/${sepA.id}`, 'PATCH', { notes: 'edited', currency: 'USD' });
  assert.equal(edited.currency, 'AED'); assert.equal((await api(`/reservations/${sepA.id}`)).currency, 'AED');
  // New bookings use ZAR.
  const nov = await mk(GR, '2026-11-02', '2026-11-05', '2500.00');
  assert.equal(nov.currency, 'ZAR'); assert.equal((await api(`/reservations/${nov.id}`)).financials.currency, 'ZAR');

  // Statements: Aug and Sep in AED, Nov in ZAR; Sep rows sorted by check-in then code.
  for (const [m, cur] of [['2026-08', 'AED'], ['2026-09', 'AED'], ['2026-11', 'ZAR']]) {
    const gen = await api('/accounting/statements/generate', 'POST', { month: m });
    assert.ok(!gen.skipped.some(s => s.propertyId === GR.id), `${m} generated`);
    const st = (await api(`/accounting/statements?month=${m}`)).find(s => s.propertyId === GR.id);
    assert.equal(st.currency, cur, `${m} statement in ${cur}`);
    if (m === '2026-09') {
      assert.equal(st.grossRevenue, 2227); assert.equal(st.otherExpenses, 50);
      assert.deepEqual(JSON.parse(st.bookingDetails).map(b => b.code), ['HMAAAAAAA1', 'HMBBBBBBB2']);
    }
  }
  // October: an AED booking and a new ZAR booking: held, never added together.
  await mk(GR, '2026-10-20', '2026-10-24', '3000.00');
  const octGen = await api('/accounting/statements/generate', 'POST', { month: '2026-10' });
  const mixed = octGen.skipped.find(s => s.propertyId === GR.id);
  assert.ok(mixed?.mixedCurrency, 'mixed month held');
  assert.match(mixed.reason, /Mixed currency: 1 booking in AED, 1 booking in ZAR\. Adding them needs an exchange rate/);
  assert.deepEqual(mixed.mixedCurrency.map(g => [g.currency, g.bookings.length]), [['AED', 1], ['ZAR', 1]]);
  assert.ok(!(await api('/accounting/statements?month=2026-10')).some(s => s.propertyId === GR.id), 'no October statement');

  // Breakdown import compares with the booking's own currency.
  const H = 'confirmation_code,listing_name,guest_name,check_in,checkout,nights,status,guest_paid_total,accommodation_total,cleaning_fee,guest_service_fee,host_service_fee,taxes,tax_types,other_fees,cohost_payout,cohost_payout_to,host_payout,currency,payout_date,source,notes';
  const L = (code, ci, co, cur) => [code, 'x', 'G', ci, co, '2', 'past guest', '1727.00', '1727.00', '', '0.00', '51.81', '', '', '', '', '', '1675.19', cur, '', 'reservation details page', ''].join(',');
  let pv = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv: [H, L('HMAAAAAAA1', '2026-09-01', '2026-09-03', 'AED')].join('\n') });
  assert.ok(!pv.rows[0].blocking.some(m => /currency/i.test(m)), 'AED file row matches the AED booking');
  assert.equal(pv.rows[0].currencyExpected, 'AED');
  pv = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv: [H, L('HMAAAAAAA1', '2026-09-01', '2026-09-03', 'ZAR')].join('\n') });
  assert.ok(pv.rows[0].blocking.some(m => /File currency ZAR differs from the booking's AED/.test(m)));

  // Payments recorded from a booking follow the booking's currency.
  await api(`/reservations/${sepA.id}`, 'PATCH', { paymentStatus: 'paid' });
  const pays = await api(`/payments?page=1&propertyId=${GR.id}`);
  assert.ok(pays.items.length && pays.items.every(p => p.currency === 'AED'), 'payment for an AED booking is AED');
  // Owner expenses: the property's currency by default, or the booking's.
  const e1 = await api('/accounting/transactions', 'POST', { type: 'expense', amount: '20', date: '2026-11-03', category: 'Supplies', description: 'Towels', propertyId: GR.id, allocation: 'owner' }, 201);
  assert.equal(e1.currency, 'ZAR');
  const e2 = await api('/accounting/transactions', 'POST', { type: 'expense', amount: '20', date: '2026-09-04', category: 'Supplies', description: 'Linen', propertyId: GR.id, reservationId: sepA.id, allocation: 'owner' }, 201);
  assert.equal(e2.currency, 'AED');
  await api('/accounting/transactions', 'POST', { type: 'expense', amount: '20', date: '2026-09-04', category: 'Supplies', description: 'X', propertyId: GR.id, allocation: 'owner', currency: 'USD' }, 400);
  // P&L is one dirham row. Stored bookings stay AED or ZAR; 2,500 and 3,000 rand display at 0.2.
  const pnl = (await api('/reports/pnl')).filter(r => r.propertyId === GR.id);
  assert.deepEqual(pnl.map(r => r.currency), ['AED']);
  assert.equal(pnl[0].revenue, 5027);
  assert.equal(pnl[0].expenses, 74);
  // Moving an AED booking to a ZAR property would relabel it: refused.
  await api(`/reservations/${aug.id}`, 'PATCH', { propertyId: ZP.id }, 400);

  // Guards: amounts with no currency of their own are never relabelled; nothing changes when refused.
  const CF = await api('/properties', 'POST', { name: 'Cleaning Fee Place', unitNumber: 'CF', city: 'Dubai', currency: 'AED', bedrooms: 1, cleaningFee: '150' }, 201);
  const cfB = await mk(CF, '2026-09-01', '2026-09-03', '1000.00');
  const refused = await api(`/accounting/settings/${CF.id}`, 'PUT', { currency: 'ZAR' }, 409);
  assert.match(refused.error, /cleaning fee setting \(AED 150\.00\) is an amount in AED: enter it in ZAR, or clear it/);
  assert.equal((await api(`/properties/${CF.id}`)).currency, 'AED'); assert.equal((await api(`/reservations/${cfB.id}`)).currency, 'AED');
  assert.equal((await api('/audit-log')).filter(a => a.entity === 'property_currency' && a.entityId === CF.id).length, 0);
  await api(`/accounting/settings/${CF.id}`, 'PUT', { currency: 'ZAR', cleaningFee: 400 });
  assert.equal(Number((await api('/accounting/settings')).find(s => s.propertyId === CF.id).cleaningFee), 400);
  assert.equal((await api(`/reservations/${cfB.id}`)).currency, 'AED');
  const MT = await api('/properties', 'POST', { name: 'Maint Place', unitNumber: 'MT', city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  await api('/maintenance', 'POST', { propertyId: MT.id, issue: 'Tap', priority: 'low', cost: '300' }, 201);
  assert.match((await api(`/accounting/settings/${MT.id}`, 'PUT', { currency: 'ZAR' }, 409)).error, /maintenance ticket with a cost/);
  await api(`/accounting/settings/${MT.id}`, 'PUT', { currency: 'zz' }, 400);
  // The property edit takes the same path.
  const PE = await api('/properties', 'POST', { name: 'Edit Place', unitNumber: 'PE', city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const peB = await mk(PE, '2026-09-01', '2026-09-03', '700.00');
  assert.equal((await api(`/properties/${PE.id}`, 'PATCH', { currency: 'ZAR' })).currency, 'ZAR');
  assert.equal((await api(`/reservations/${peB.id}`)).currency, 'AED');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'property_currency' && a.entityId === PE.id));
  // A property that never changed keeps no stamped currency (its statements are untouched).
  assert.equal((await api(`/reservations/${(await mk(ZP, '2026-09-01', '2026-09-03', '100.00')).id}`)).currency, 'ZAR');

  await new Promise(r => setTimeout(r, 300));
  assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'nothing sent');
  console.log('PASS: currency change never relabels (bookings stamped with the old currency, new ones in the new currency, mixed month held without an exchange rate, guards for amounts without a currency, audit-logged card and Fee Settings path); statement rows sorted by check-in then confirmation code');
} catch (e) { console.error(logs.slice(-3000)); console.error(e); process.exitCode = 1; } finally { child.kill('SIGTERM'); }
