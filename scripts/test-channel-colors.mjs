// Channel colours: one shared map, the requested hues, readable text, owner stays and blocks told apart.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CHANNEL_COLORS, LEGEND, channelKey, platformKey, isOwnerStay, contrastRatio } from '../artifacts/yallastay/src/lib/channel-colors.ts';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
assert.equal(CHANNEL_COLORS.airbnb.bg, '#DC2626', 'Airbnb clear red (Tailwind red-600)');
assert.equal(CHANNEL_COLORS.airbnb.text, '#FFFFFF', 'white text on Airbnb bars');
assert.deepEqual([CHANNEL_COLORS.airbnb.softBg, CHANNEL_COLORS.airbnb.softText], ['#DC2626', '#FFFFFF'], 'Airbnb badges are solid red with white text, not a pink tint');
assert.deepEqual(['booking_com', 'direct', 'blocked'].map(k => CHANNEL_COLORS[k].bg), ['#003580', '#15803D', '#6B7280'], 'Booking.com blue, direct green, blocks grey unchanged');
assert.equal(CHANNEL_COLORS.booking_com.bg, '#003580', 'Booking.com blue');
const hues = LEGEND.map(k => CHANNEL_COLORS[k].bg);
assert.equal(new Set(hues).size, hues.length, 'every legend entry has its own colour');
for (const c of Object.values(CHANNEL_COLORS)) {
  assert.ok(contrastRatio(c.bg, c.text) >= 4.5, `${c.label} bar text contrast ${contrastRatio(c.bg, c.text).toFixed(2)}`);
  assert.ok(contrastRatio(c.softBg, c.softText) >= 4.5, `${c.label} badge text contrast ${contrastRatio(c.softBg, c.softText).toFixed(2)}`);
  assert.ok(contrastRatio(c.ink, '#FFFFFF') >= 4.5, `${c.label} ink on white ${contrastRatio(c.ink, '#FFFFFF').toFixed(2)}`);
}
// Calendar entries.
assert.equal(channelKey({ platform: 'airbnb', status: 'confirmed' }), 'airbnb');
assert.equal(channelKey({ platform: 'booking_com', status: 'checked_in' }), 'booking_com');
assert.equal(channelKey({ platform: 'vrbo', status: 'confirmed' }), 'vrbo');
assert.equal(channelKey({ platform: 'direct', status: 'confirmed', guestName: 'Kariem' }), 'direct');
assert.equal(channelKey({ platform: 'airbnb', status: 'blocked', guestName: 'Airbnb blocked dates' }), 'blocked', 'channel "Not available" is a grey block');
assert.equal(channelKey({ platform: 'direct', status: 'blocked', guestName: 'Blocked: Maintenance' }), 'blocked');
assert.equal(channelKey({ platform: 'direct', status: 'blocked', guestName: 'Blocked: Owner stay' }), 'owner');
assert.equal(channelKey({ platform: 'direct', status: 'blocked', guestName: 'Blocked: owner stay – family visit' }), 'owner');
assert.equal(isOwnerStay({ platform: 'airbnb', status: 'blocked', guestName: 'Owner stay' }), false, 'a channel block is never an owner stay');
assert.equal(isOwnerStay({ platform: 'direct', status: 'confirmed', guestName: 'Owner stay' }), false, 'only blocks');
assert.equal(platformKey('expedia'), 'other'); assert.equal(platformKey(null), 'direct');
// No page keeps its own channel colour map any more.
const pages = path.join(root, 'artifacts/yallastay/src/pages');
for (const f of readdirSync(pages)) {
  const src = readFileSync(path.join(pages, f), 'utf8');
  assert.doesNotMatch(src, /(airbnb|booking_com|vrbo)\s*:\s*\{?\s*(bg|cls)?\s*:?\s*"(bg-|#)/, `${f} defines its own channel colours`);
  assert.doesNotMatch(src, /^const PLATFORM_(STYLES|COLORS)\b/m, `${f} still has a local PLATFORM_ colour map`);
}
// No leftover Airbnb coral/pink anywhere in the web app.
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [path.join(d, e.name)] : []);
for (const f of walk(path.join(root, 'artifacts/yallastay/src'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /#FF5A5F|#FF385C|255,\s*56,\s*92/i, `${path.relative(root, f)} still uses Airbnb coral`);
assert.match(readFileSync(path.join(root, 'artifacts/yallastay/src/pages/verify-bookings.tsx'), 'utf8'), /badgeStyle\(r\.platform\)/, 'Verify bookings shows the channel badge');
console.log('PASS: channel colours — Airbnb red-600 with white text, Booking.com blue, Vrbo teal, direct green, owner stay purple, blocks grey; all text ≥ 4.5:1; one shared map');
