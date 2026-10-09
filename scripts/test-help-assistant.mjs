// Floating help assistant (local search only) and the "not verified" / payment labels (Clifford, 9 Oct 2026).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { helpIndex, helpSearch, SCREENS, QUICK_ANSWERS, clampPos, readPos, DEFAULT_POS } from '../artifacts/yallastay/src/lib/help-search.ts';
import { paymentLabel, unverifiedReason } from '../lib/booking-labels.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => readFile(path.join(root, p), 'utf8');

// ── Every sidebar screen is searchable ──
const layout = await read('artifacts/yallastay/src/components/layout/app-layout.tsx');
const navHrefs = [...layout.matchAll(/\{ href: "([^"]+)",\s+icon:/g)].map(m => m[1]);
assert.ok(navHrefs.length > 30, 'nav parsed');
for (const h of new Set(navHrefs)) assert.ok(SCREENS.some(s => s.href === h), `screen ${h} is in the help search`);
assert.match(layout, /<HelpBubble \/>/, 'the bubble is on every signed-in screen');

// ── Search: properties, bookings by guest or ref, owners, reports, quick answers ──
const data = {
  role: 'admin',
  properties: [{ id: 3, name: 'The Grey House | 2BR', reportName: '2 Bedroom Mount Pleasant', city: 'Port Elizabeth' }, { id: 9, name: 'Lofts West 603', city: 'Dubai' }],
  bookings: [{ id: 41, guestName: 'Zoë Smith', externalId: 'airbnb:HMJBBW88BD', propertyId: 3, checkIn: '2026-06-01', checkOut: '2026-06-04' }],
  owners: [{ id: 2, name: 'Dylan Matthysen', email: 'd@example.com' }],
  statements: [{ id: 7, ownerId: 2, propertyId: 3, month: '2026-09', status: 'draft' }],
};
const idx = helpIndex(data);
const first = q => helpSearch(idx, q)[0];
assert.equal(first('zoe').href, '/reservations/41', 'guest name, accent-insensitive');
assert.equal(first('HMJBBW88BD').href, '/reservations/41', 'booking reference without the channel prefix');
assert.equal(first('mount pleasant').href, '/properties?property=3', 'property by workbook name');
assert.equal(first('dylan').href, '/owners?owner=2');
assert.ok(helpSearch(idx, 'statement 2026-09').some(r => r.type === 'Report' && r.href === '/accounting'), 'owner statement report');
assert.equal(first('verify bookings').href, '/verify-bookings');
assert.equal(first('workbook').id, 'qa-workbook', 'quick answer: export the YALLA workbook');
assert.equal(first('expense').id, 'qa-expense');
assert.equal(first('bank balance').href, '/finance-inputs?tab=bank');
assert.equal(first('airbnb payouts').id, 'qa-payouts');
assert.deepEqual(helpSearch(idx, '').map(r => r.id), QUICK_ANSWERS.map(r => r.id), 'empty query shows the quick answers');
assert.deepEqual(helpSearch(idx, 'qqqzzz'), []);
// Roles: restricted screens are hidden
assert.ok(!helpIndex({ role: 'cleaner' }).some(r => r.href === '/finance-inputs' && r.type === 'Screen'));
assert.ok(helpIndex({ role: 'super_admin' }).some(r => r.href === '/system-health'));

// ── Position: remembered, clamped on screen, minimisable ──
assert.deepEqual(readPos(null), DEFAULT_POS); assert.deepEqual(readPos('garbage'), DEFAULT_POS);
assert.deepEqual(readPos(JSON.stringify({ right: 40, bottom: 200, minimised: true })), { right: 40, bottom: 200, minimised: true });
assert.deepEqual(clampPos({ right: -50, bottom: 5000, minimised: false }, 1000, 800), { right: 8, bottom: 744, minimised: false });

// ── Component: small, local only, reduced motion respected ──
const comp = await read('artifacts/yallastay/src/components/HelpBubble.tsx');
assert.doesNotMatch(comp, /https?:\/\/|openai|anthropic|\/api\/ai/i, 'no external or AI calls');
assert.match(comp, /localStorage\.setItem\(KEY/); assert.match(comp, /setPointerCapture/); assert.match(comp, /minimised: true/);
assert.match(comp, /What are you looking for\?/);
const css = await read('artifacts/yallastay/src/index.css');
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.help-bubble-bounce \{ animation: none; \} \}/);

// ── Labels: Airbnb collects the payment; reasons for "not verified" ──
assert.deepEqual(paymentLabel({ platform: 'airbnb', status: 'confirmed', paymentStatus: 'unknown' }), { key: 'channel', label: 'Collected by Airbnb' });
assert.equal(paymentLabel({ platform: 'airbnb', status: 'cancelled', paymentStatus: 'unknown' }).label, 'Not supplied by channel');
assert.equal(paymentLabel({ platform: 'direct', status: 'confirmed', paymentStatus: 'unknown' }).label, 'Not supplied by channel');
assert.equal(paymentLabel({ platform: 'airbnb', status: 'confirmed', paymentStatus: 'paid' }).label, 'Paid');
const today = '2026-10-09';
assert.equal(unverifiedReason({ platform: 'airbnb' }, { verified: true }, today), null);
assert.match(unverifiedReason({ platform: 'airbnb', checkIn: '2026-11-01' }, { verified: false, hasChannelEarnings: false }, today), /pays out after check-in/);
assert.match(unverifiedReason({ platform: 'airbnb', checkIn: '2026-06-01' }, { verified: false, hasChannelEarnings: true }, today), /no guest-paid total.*reservation breakdown/);
assert.match(unverifiedReason({ platform: 'airbnb', checkIn: '2026-06-01' }, { verified: false, hasChannelEarnings: false }, today), /No Airbnb payout/);
assert.match(unverifiedReason({ platform: 'direct', checkIn: '2026-06-01' }, { verified: false }, today), /Verify bookings/);
assert.equal(unverifiedReason({ platform: 'airbnb', status: 'cancelled' }, { verified: false }, today), null);
// Screens use the labels; no bare "Not supplied" badge left
for (const f of ['pages/reservations.tsx', 'pages/reservation-detail.tsx', 'pages/calendar.tsx']) assert.match(await read(`artifacts/yallastay/src/${f}`), /paymentLabel\(/, f);
const rm = await read('artifacts/yallastay/src/components/ReservationMoney.tsx');
assert.doesNotMatch(rm, /Amount not supplied|were not supplied|'Not supplied'/); assert.match(rm, /unverifiedReason\(/);
console.log('help assistant + labels: ok');
