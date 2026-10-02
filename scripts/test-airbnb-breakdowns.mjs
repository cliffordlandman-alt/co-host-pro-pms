// Airbnb reservation breakdowns import: parsing (blanks stay null, co-host payout from notes), the read-only
// preview (matching, payout mismatch, review vs clean rows) and applying through the normal booking edit.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { cohostFromNotes, cohostSuggestion, payoutComparison, parseBreakdowns, money } from '../artifacts/api-server/src/lib/airbnb-breakdowns.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Parsing ──
assert.deepEqual(cohostFromNotes('Co-host payout shown as deduction -1302.35; host service fee shown as deduction.'), { mentioned: true, amount: '1302.35' });
assert.deepEqual(cohostFromNotes('Extra guest fee 2106.00 shown; nightly rate adjustment shown as -205.20; host service fee and co-host payouts shown as deductions.'), { mentioned: true, amount: null }, 'mentioned without an amount');
assert.deepEqual(cohostFromNotes('Co-host payouts and host service fee shown as deductions.'), { mentioned: true, amount: null });
assert.deepEqual(cohostFromNotes('Nightly rate adjustment shown as -2.70; host service fee shown as deduction.'), { mentioned: false, amount: null });
assert.deepEqual(cohostFromNotes(''), { mentioned: false, amount: null });
assert.equal(money('', 'x', []), null, 'blank is not 0'); assert.equal(money(' 1,234.5 ', 'x', []), '1234.50');
const errs = []; assert.equal(money('12abc', 'Total', errs), null); assert.equal(errs.length, 1);
assert.throws(() => parseBreakdowns('a,b\n1,2'), /missing confirmation_code/);
// Co-host amount suggested from other_fees only when it holds exactly one amount (and the notes have none).
assert.equal(cohostSuggestion({ mentioned: true, amount: null }, '-877.30'), '877.30');
assert.equal(cohostSuggestion({ mentioned: true, amount: null }, '-205.20; -6105.34'), null, 'two amounts: no guess');
assert.equal(cohostSuggestion({ mentioned: true, amount: null }, ''), null);
assert.equal(cohostSuggestion({ mentioned: true, amount: '10.00' }, '-877.30'), null, 'notes amount wins');
assert.equal(cohostSuggestion({ mentioned: false, amount: null }, '-877.30'), null);
// Payout rounding: up to 0.05 is rounding, above is a difference.
assert.equal(payoutComparison('325.74', '325.75'), 'rounding'); assert.equal(payoutComparison('100.00', '100.05'), 'rounding');
assert.equal(payoutComparison('100.00', '100.06'), 'differs'); assert.equal(payoutComparison('12019.66', '12019.64'), 'rounding');
assert.equal(payoutComparison('5.00', '5.00'), 'match'); assert.equal(payoutComparison(null, '5.00'), 'none');

const HEAD = 'confirmation_code,listing_name,guest_name,check_in,checkout,nights,status,guest_paid_total,accommodation_total,cleaning_fee,guest_service_fee,host_service_fee,taxes,tax_types,other_fees,host_payout,currency,payout_date,source,notes';
const line = o => [o.code, 'x', 'Guest', o.ci, o.co, '2', 'past guest', o.total ?? '', o.total ?? '', o.cleaning ?? '', '0.00', '10.00', '', 'VAT', o.other ?? '', o.payout ?? '', o.cur, '', 'reservation details page', o.notes ?? ''].map(v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',');

const data = await mkdtemp(path.join(tmpdir(), 'yallapms-breakdowns-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3017', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3017/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Breakdown Admin', email: 'bd@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'BD Owner' }, 201);
  const S = await api('/properties', 'POST', { name: 'Grey Test House', unitNumber: 'S1', ownerId: owner.id, city: 'Gqeberha', country: 'South Africa', currency: 'ZAR', bedrooms: 2 }, 201);
  const D = await api('/properties', 'POST', { name: 'Dubai Test 1BR', unitNumber: 'D1', ownerId: owner.id, city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const mk = async (p, code, ci, co, extra = {}) => { const b = await api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${code}`, platform: 'airbnb', status: 'confirmed', checkIn: ci, checkOut: co, ...extra }, 201); await api(`/reservations/${b.id}`, 'PATCH', { externalId: `airbnb:${code}` }); return b; };
  const clean1 = await mk(S, 'HMCLEAN001', '2026-08-29', '2026-08-31');
  const mism = await mk(S, 'HMMISMAT01', '2026-09-03', '2026-09-06');
  const noamt = await mk(S, 'HMNOAMT001', '2026-09-10', '2026-09-12');
  const blank = await mk(S, 'HMBLANK001', '2026-09-14', '2026-09-16');
  const diff = await mk(S, 'HMDIFF0001', '2026-09-22', '2026-09-24');
  const sugg = await mk(S, 'HMSUGG0001', '2026-09-25', '2026-09-27');
  const cur = await mk(S, 'HMCURR0001', '2026-09-18', '2026-09-20');
  const clean2 = await mk(D, 'HMCLEAN002', '2026-08-06', '2026-08-08');
  const canc = await mk(D, 'HMCANCEL01', '2026-08-20', '2026-08-22'); await api(`/reservations/${canc.id}`, 'PATCH', { status: 'cancelled' });
  // Stored Airbnb payouts (Airbnb Reservations export).
  const exp = ['"Confirmation code","Status","Guest name","Contact","# of adults","# of children","# of infants","Start date","End date","# of nights","Booked","Listing","Earnings"',
    '"HMCLEAN001","Past guest","G","","1","0","0","8/29/2026","8/31/2026","2","2026-08-01","Grey Test House","ZAR 229.82"',
    '"HMMISMAT01","Past guest","G","","1","0","0","9/3/2026","9/6/2026","3","2026-08-01","Grey Test House","ZAR 325.75"',
    '"HMDIFF0001","Past guest","G","","1","0","0","9/22/2026","9/24/2026","2","2026-08-01","Grey Test House","ZAR 300.00"',
    '"HMCLEAN002","Past guest","G","","1","0","0","8/6/2026","8/8/2026","2","2026-08-01","Dubai Test 1BR","AED 998.25"'].join('\n');
  await api('/airbnb-data/import', 'POST', { csv: exp });
  const csv = [HEAD,
    line({ code: 'HMCLEAN001', ci: '2026-08-29', co: '2026-08-31', total: '1830.00', payout: '229.82', cur: 'ZAR', other: '-1302.35', notes: 'Co-host payout shown as deduction -1302.35; host service fee shown as deduction.' }),
    line({ code: 'HMMISMAT01', ci: '2026-09-03', co: '2026-09-06', total: '389.06', payout: '325.74', cur: 'ZAR', notes: 'export cross-check showed 325.75.' }),
    line({ code: 'HMNOAMT001', ci: '2026-09-10', co: '2026-09-12', total: '2543.80', payout: '313.56', cur: 'ZAR', other: '-64.20; -1776.81', notes: 'Nightly rate adjustment shown as -64.20; host service fee and co-host payouts shown as deductions.' }),
    line({ code: 'HMDIFF0001', ci: '2026-09-22', co: '2026-09-24', total: '400.00', payout: '300.06', cur: 'ZAR' }),
    line({ code: 'HMSUGG0001', ci: '2026-09-25', co: '2026-09-27', total: '1242.56', payout: '154.82', cur: 'ZAR', other: '-877.30', notes: 'Co-host payouts and host service fee shown as deductions.' }),
    line({ code: 'HMBLANK001', ci: '2026-09-14', co: '2026-09-16', total: '', payout: '100.00', cur: 'ZAR' }),
    line({ code: 'HMCURR0001', ci: '2026-09-18', co: '2026-09-20', total: '500.00', payout: '400.00', cur: 'AED' }),
    line({ code: 'HMCLEAN002', ci: '2026-08-06', co: '2026-08-08', total: '1176.23', cleaning: '500.00', payout: '998.25', cur: 'AED' }),
    line({ code: 'HMCANCEL01', ci: '2026-08-20', co: '2026-08-22', total: '700.00', payout: '600.00', cur: 'AED' }),
    line({ code: 'HMNOTHERE1', ci: '2026-08-01', co: '2026-08-03', total: '300.00', payout: '250.00', cur: 'AED' }),
  ].join('\n');
  await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv: 'nope' }, 400);
  const pv = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv });
  const by = Object.fromEntries(pv.rows.map(r => [r.code, r]));
  assert.deepEqual(pv.summary, { rows: 10, matched: 9, unmatched: 1, clean: 3, review: 3, blocked: 3 });
  assert.equal(by.HMCLEAN001.bulkOk, true); assert.equal(by.HMCLEAN001.cohost.amount, '1302.35'); assert.equal(by.HMCLEAN001.storedPayout, 229.82);
  assert.equal(by.HMCLEAN002.bulkOk, true); assert.equal(by.HMCLEAN002.preview.cleaningFee, 500);
  assert.equal(by.HMMISMAT01.bulkOk, true, '0.01 apart is rounding: clean'); assert.equal(by.HMMISMAT01.payoutCheck, 'rounding');
  assert.match(by.HMMISMAT01.notes.join(), /Rounding difference: file ZAR 325.74, stored 325.75 \(the stored figure is kept\)/); assert.equal(by.HMMISMAT01.storedPayout, 325.75);
  assert.equal(by.HMDIFF0001.bulkOk, false); assert.equal(by.HMDIFF0001.payoutCheck, 'differs'); assert.match(by.HMDIFF0001.review.join(), /Payout differs: file ZAR 300.06, stored ZAR 300.00/);
  assert.equal(by.HMSUGG0001.bulkOk, false, 'suggested co-host amount still needs a manual tick'); assert.equal(by.HMSUGG0001.cohost.suggested, '877.30'); assert.equal(by.HMSUGG0001.cohost.amount, null);
  assert.match(by.HMSUGG0001.review.join(), /filled in from other fees \(877.30\): check it/);
  assert.equal(by.HMNOAMT001.cohost.suggested, null, 'two other fees: nothing pre-filled');
  assert.equal(by.HMNOAMT001.bulkOk, false); assert.match(by.HMNOAMT001.review.join(), /without an amount/);
  assert.match(by.HMBLANK001.blocking.join(), /blank is not 0/);
  assert.match(by.HMCURR0001.blocking.join(), /currency AED differs/);
  assert.match(by.HMCANCEL01.blocking.join(), /cancelled/);
  assert.equal(by.HMNOTHERE1.matched, false);
  assert.equal((await api(`/reservations/${clean1.id}`)).financeMode !== 'inclusive-v1', true, 'preview saves nothing');
  // Apply = the normal booking edit (what the screen sends for a ticked row).
  const apply = (row, extra = {}) => api(`/reservations/${row.reservationId}`, 'PATCH', { grossAmount: row.guestTotal, financeMode: 'inclusive-v1', ...(row.cleaningFee != null ? { cleaningFee: row.cleaningFee } : {}), ...(row.cohost.amount != null ? { cohostPayout: row.cohost.amount } : {}), ...extra });
  const s1 = await apply(by.HMCLEAN001);
  for (const k of ['grossAmount', 'vatAmount', 'channelAmount', 'managementAmount', 'ownerAmount', 'cleaningFee']) assert.equal(Number(s1[k]), by.HMCLEAN001.preview[k], `preview = save: ${k}`);
  assert.equal(s1.cohostPayout, 1302.35); assert.equal(s1.financeMode, 'inclusive-v1');
  const s2 = await apply(by.HMCLEAN002); assert.equal(s2.cleaningFee, 500); assert.equal(s2.cohostPayout, null, 'no co-host payout: stays blank');
  // Reviewed one by one: the co-host amount typed in from Airbnb.
  const s3 = await apply(by.HMNOAMT001, { cohostPayout: '1776.81' }); assert.equal(s3.cohostPayout, 1776.81);
  await api(`/reservations/${mism.id}`, 'PATCH', { grossAmount: '389.06', financeMode: 'inclusive-v1', cohostPayout: '-5' }, 400);
  const s4 = await apply(by.HMSUGG0001, { cohostPayout: by.HMSUGG0001.cohost.suggested }); assert.equal(s4.cohostPayout, 877.3, 'checked suggestion saved on a manual tick');
  // The stored payout stays Airbnb's latest figure after applying a rounding-difference row.
  await apply(by.HMMISMAT01);
  assert.equal((await api(`/reservations/${mism.id}`)).financials.channelEarnings[0].amount, 325.75, 'stored payout unchanged');
  assert.ok((await api('/audit-log')).some(a => a.entity === 'reservation' && a.entityId === clean1.id && a.action === 'update'), 'audit logged');
  // Co-host payout is not deducted anywhere yet: statement owner payout ignores it.
  const gen = await api('/accounting/statements/generate', 'POST', { month: '2026-08' });
  const st = gen.statements.find(s => s.propertyId === S.id); assert.ok(st, 'August statement generated for the property');
  assert.equal(Number(st.ownerPayout), Number(s1.ownerAmount), 'owner payout = booking owner amount; co-host payout not deducted');
  // Month lock: once sent, the preview refuses and the edit path refuses co-host changes too.
  await api(`/accounting/statements/${st.id}`, 'PATCH', { status: 'sent' });
  const pv2 = await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv });
  assert.match(pv2.rows.find(r => r.code === 'HMCLEAN001').blocking.join(), /already sent or paid/);
  await api(`/reservations/${clean1.id}`, 'PATCH', { cohostPayout: '1000.00' }, 400);
  // A verified booking needs review before its guest total is replaced.
  assert.match(pv2.rows.find(r => r.code === 'HMCLEAN002').review.join(), /already verified/);
  console.log('PASS: Airbnb breakdowns — blanks stay blank, co-host payout parsed from notes (or entered on review), payout mismatches and missing amounts need one-by-one review, applying is the normal booking edit (audit, month lock), co-host payout not deducted');
} catch (e) { console.error(e); console.error(logs.slice(-2500)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
