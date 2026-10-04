// Outbound calendar (roadmap #4): a secret iCal link per property with YallaPMS's own blocks and direct bookings,
// other channels' bookings only when switched on and never echoed back to their own channel; rotatable tokens that
// never reach the activity log or server log; sync health per incoming feed and one in-app alert after 2 hours of
// failures (nothing sent outside while OUTBOUND_DELIVERY is off).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exportRows, buildIcal, feedState, needsFailingAlert, summarizeRows, TOKEN_RE } from '../lib/calendar-export.mjs';
import { redactSecrets, redactText } from '../lib/redact.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Pure ──
{
  const r = (id, platform, status, checkIn, checkOut, guestName = `Guest ${id}`) => ({ id, platform, status, checkIn, checkOut, guestName });
  const rows = [r(1, 'direct', 'blocked', '2026-10-10', '2026-10-12'), r(2, 'direct', 'confirmed', '2026-10-05', '2026-10-07', 'Secret Guest'), r(3, 'airbnb', 'confirmed', '2026-10-20', '2026-10-23'),
    r(4, 'booking_com', 'confirmed', '2026-10-25', '2026-10-26'), r(5, 'direct', 'cancelled', '2026-10-15', '2026-10-16'), r(6, 'direct', 'confirmed', '2026-09-01', '2026-09-03'), r(7, 'airbnb', 'blocked', '2026-11-01', '2026-11-05')];
  const today = '2026-10-04';
  assert.deepEqual(exportRows(rows, { today, target: 'airbnb' }).map(x => x.id), [2, 1], 'default: own block + direct booking only, past and cancelled left out, sorted by date');
  assert.deepEqual(exportRows(rows, { today, target: 'airbnb', includeChannelBookings: true }).map(x => x.id), [2, 1, 4], 'Airbnb never gets its own bookings or blocks back');
  assert.deepEqual(exportRows(rows, { today, target: 'booking_com', includeChannelBookings: true }).map(x => x.id), [2, 1, 3, 7]);
  assert.deepEqual(exportRows(rows, { today, target: 'all', includeChannelBookings: true }).map(x => x.id), [2, 1, 3, 4, 7]);
  assert.deepEqual(summarizeRows(exportRows(rows, { today, target: 'vrbo', includeChannelBookings: true })), { total: 5, blocks: 1, direct: 1, channel: 3, byChannel: { Airbnb: 2, 'Booking.com': 1 } });
  const ics = buildIcal(exportRows(rows, { today, target: 'airbnb' }), { now: new Date('2026-10-04T08:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics), 'RFC 5545 CRLF lines');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261007/, 'check-out is the exclusive end date');
  assert.match(ics, /DTSTAMP:20261004T080000Z/); assert.ok(!/Secret Guest|Guest 1/.test(ics), 'no guest names in the feed');
  // Health states and the alert rule.
  const now = new Date('2026-10-04T12:00:00Z'); const h = (min) => new Date(now.getTime() - min * 60000);
  assert.equal(feedState(undefined, false, now), 'not_connected'); assert.equal(feedState(undefined, true, now), 'never');
  assert.equal(feedState({ lastAttemptAt: h(5), lastSuccessAt: h(5) }, true, now), 'ok');
  assert.equal(feedState({ lastAttemptAt: h(5), lastSuccessAt: h(200) }, true, now), 'stale');
  assert.equal(feedState({ lastAttemptAt: h(5), failingSince: h(119) }, true, now), 'failing');
  assert.equal(feedState({ lastAttemptAt: h(5), failingSince: h(121) }, true, now), 'alert');
  assert.equal(needsFailingAlert({ failingSince: h(119) }, now), false, 'not before 2 hours');
  assert.equal(needsFailingAlert({ failingSince: h(121) }, now), true);
  assert.equal(needsFailingAlert({ failingSince: h(121), alertedAt: h(1) }, now), false, 'once per run of failures');
  assert.equal(needsFailingAlert({ failingSince: h(121), alertedAt: h(500) }, now), true, 'an alert from an earlier run does not count');
  // Redaction of the export link and tokens.
  const tok = 'A'.repeat(43);
  assert.equal(redactText(`see http://127.0.0.1:5174/api/ical/${tok}/airbnb.ics now`), 'see [redacted URL] now');
  assert.equal(redactText(`/api/ical/${tok}/all.ics`), '/api/ical/[redacted]/all.ics');
  assert.deepEqual(redactSecrets({ token: tok, previousToken: tok, includeChannelBookings: false }), { token: '[redacted]', previousToken: '[redacted]', includeChannelBookings: false });
}

// ── API ──
const req = createRequire(path.join(root, 'lib/db/package.json'));
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-calexp-'));
const feeds = await mkdtemp(path.join(tmpdir(), 'yallapms-calexp-feeds-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3027', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, ICAL_FIXTURE_DIR: feeds, WHATSAPP_TOKEN: 'test-only', WHATSAPP_PHONE_ID: '1' };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY; delete env.PUBLIC_APP_URL;
let child, logs = '', token;
function start() {
  child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), '--import', path.join(root, 'scripts/fixtures/mock-channel-fetch.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
}
const stop = () => new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); });
const raw = (p, headers = {}) => fetch('http://127.0.0.1:3027' + p, { headers });
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3027/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const ready = async () => { for (let i = 0; i < 80; i++) { try { await api('/healthz'); return; } catch { await new Promise(r => setTimeout(r, 250)); } } throw new Error('server did not start'); };
const dubaiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
start();
try {
  await ready();
  token = (await api('/auth/register', 'POST', { name: 'Cal Admin', email: 'cal@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const p = await api('/properties', 'POST', { name: 'Export Flat', unitNumber: 'E1', city: 'Dubai', currency: 'AED', bedrooms: 1 }, 201);
  const d = (n) => addDays(dubaiToday, n);
  const book = (extra) => api('/reservations', 'POST', { propertyId: p.id, revenue: 0, ...extra }, 201);
  await book({ guestName: 'Blocked: Owner stay', platform: 'direct', status: 'blocked', checkIn: d(10), checkOut: d(13), balanceDue: 0, paymentStatus: 'paid' });
  await book({ guestName: 'Private Direct Guest', platform: 'direct', status: 'confirmed', checkIn: d(2), checkOut: d(4) });
  await book({ guestName: 'Airbnb Guest', platform: 'airbnb', status: 'confirmed', checkIn: d(20), checkOut: d(22) });
  await book({ guestName: 'Booking Guest', platform: 'booking_com', status: 'confirmed', checkIn: d(30), checkOut: d(31) });
  const cancelled = await book({ guestName: 'Gone Guest', platform: 'direct', status: 'confirmed', checkIn: d(40), checkOut: d(42) });
  await api(`/reservations/${cancelled.id}`, 'PATCH', { status: 'cancelled' });

  await api('/calendar-sync', 'GET', null, 200);
  const savedToken = token; token = null; await api('/calendar-sync', 'GET', null, 401); token = savedToken;
  let panel = await api('/calendar-sync');
  assert.equal(panel.publicBaseUrl, null, 'not hosted: the UI must say the links are not reachable from outside');
  assert.equal(panel.outboundDelivery, false);
  let prop = panel.properties.find(x => x.id === p.id);
  const link = (t, pr = prop) => pr.export.links.find(l => l.target === t).path;
  const tok1 = link('airbnb').split('/')[3];
  assert.ok(TOKEN_RE.test(tok1), 'a 43-character random token');
  assert.equal(link('all').split('/')[3], tok1);
  assert.deepEqual(prop.export.links.find(l => l.target === 'airbnb').events, { total: 2, blocks: 1, direct: 1, channel: 0, byChannel: {} });

  // Public feed, no login.
  let r = await raw(link('airbnb'));
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/calendar/);
  let body = await r.text();
  assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 2, 'block + direct booking');
  assert.ok(body.includes(`DTSTART;VALUE=DATE:${d(10).replace(/-/g, '')}`) && body.includes(`DTEND;VALUE=DATE:${d(13).replace(/-/g, '')}`));
  assert.ok(!/Guest|Owner stay/.test(body), 'no guest names or block reasons leave YallaPMS');
  await raw(link('vrbo'), { 'X-YallaPMS-Check': '1' });
  prop = (await api('/calendar-sync')).properties.find(x => x.id === p.id);
  assert.equal(prop.export.fetchCount, 1, 'channel reads counted, the in-app check is not'); assert.ok(prop.export.lastFetchedAt);
  assert.equal((await raw(`/api/ical/${'B'.repeat(43)}/airbnb.ics`)).status, 404, 'unknown token');
  assert.equal((await raw(`/api/ical/${tok1}/other.ics`)).status, 401, 'unknown file name is not public');
  assert.equal((await raw(`/api/ical/short/airbnb.ics`)).status, 401);

  // Other channels' bookings, never echoed back.
  await api(`/calendar-sync/${p.id}`, 'PATCH', { includeChannelBookings: 'yes' }, 400);
  await api(`/calendar-sync/${p.id}`, 'PATCH', { includeChannelBookings: true });
  const count = async (t) => ((await (await raw(`/api/ical/${tok1}/${t}.ics`)).text()).match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(await count('airbnb'), 3, 'Airbnb feed: own 2 + Booking.com, not the Airbnb booking');
  assert.equal(await count('booking_com'), 3, 'Booking.com feed: own 2 + Airbnb');
  assert.equal(await count('vrbo'), 4); assert.equal(await count('all'), 4);

  // Rotation: old link dead, new link live, tokens never in the activity log or the server log.
  const rot = await api(`/calendar-sync/${p.id}/rotate`, 'POST');
  const tok2 = rot.links[0].path.split('/')[3];
  assert.notEqual(tok2, tok1); assert.ok(TOKEN_RE.test(tok2));
  assert.equal((await raw(`/api/ical/${tok1}/airbnb.ics`)).status, 404, 'old link stops working');
  assert.equal((await raw(`/api/ical/${tok2}/airbnb.ics`)).status, 200);
  const audit = JSON.stringify(await api('/audit-log?limit=200'));
  assert.ok(audit.includes('calendar_export'), 'rotation is in the activity log');
  assert.ok(!audit.includes(tok1) && !audit.includes(tok2), 'tokens are redacted in the activity log');
  assert.ok(audit.includes('[redacted]'));
  for (let i = 0; i < 40 && !logs.includes('/api/ical/[redacted]'); i++) await new Promise(r => setTimeout(r, 100)); // request logs are written asynchronously
  assert.ok(logs.includes('/api/ical/[redacted]'), 'feed requests are logged with the token redacted');
  assert.ok(!logs.includes(tok1) && !logs.includes(tok2), 'tokens never reach the server log');

  // Sync health: a failing incoming feed (no fixture → HTTP 404 from the "channel").
  await api(`/platforms/property/${p.id}`, 'PATCH', { airbnbIcalUrl: 'https://www.airbnb.com/calendar/ical/777.ics?s=secretfeed' });
  const fail = await api(`/calendar-sync/${p.id}/sync/airbnb`, 'POST', null, 422);
  assert.match(fail.error, /HTTP 404/);
  let feed = (await api('/calendar-sync')).properties.find(x => x.id === p.id).feeds.find(f => f.platform === 'airbnb');
  assert.equal(feed.state, 'failing'); assert.match(feed.lastError, /HTTP 404/); assert.equal(feed.lastSuccessAt, null); assert.ok(!feed.lastError.includes('secretfeed'));
  assert.equal((await api('/notifications')).filter(n => n.type === 'ical_feed_failing').length, 0, 'no alert in the first 2 hours');
  // Pretend the failures started 3 hours ago (stop the server, edit its database, start again).
  await stop();
  { const { PGlite } = await import(req.resolve('@electric-sql/pglite')); const c = new PGlite(path.join(data, 'db', 'postgres'));
    await c.query(`UPDATE channel_sync_health SET failing_since = $2 WHERE property_id = $1 AND platform = 'airbnb'`, [p.id, new Date(Date.now() - 3 * 3600e3).toISOString()]); // stored as UTC, like the app
    await c.close(); }
  start(); await ready();
  await api(`/calendar-sync/${p.id}/sync/airbnb`, 'POST', null, 422);
  await api(`/calendar-sync/${p.id}/sync/airbnb`, 'POST', null, 422);
  let alerts = (await api('/notifications')).filter(n => n.type === 'ical_feed_failing');
  assert.equal(alerts.length, 1, 'one in-app alert per run of failures');
  assert.equal(alerts[0].link, '/calendar-sync'); assert.match(alerts[0].title, /Export Flat · Airbnb/); assert.ok(!alerts[0].message.includes('secretfeed'));
  panel = await api('/calendar-sync');
  assert.equal(panel.properties.find(x => x.id === p.id).feeds.find(f => f.platform === 'airbnb').state, 'alert'); assert.equal(panel.summary.alerts, 1);
  assert.equal((await readFile(outLog, 'utf8')).trim(), '', 'no WhatsApp or email left the system (OUTBOUND_DELIVERY off)');
  // Recovery closes the alert.
  await writeFile(path.join(feeds, 'airbnb-777.ics'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d(50).replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${d(52).replace(/-/g, '')}\r\nUID:blk@airbnb.com\r\nSUMMARY:Airbnb (Not available)\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  const ok = await api(`/calendar-sync/${p.id}/sync/airbnb`, 'POST');
  assert.equal(ok.created, 1);
  feed = (await api('/calendar-sync')).properties.find(x => x.id === p.id).feeds.find(f => f.platform === 'airbnb');
  assert.equal(feed.state, 'ok'); assert.ok(feed.lastSuccessAt); assert.equal(feed.failingSince, null); assert.match(feed.lastSummary, /1 new/);
  assert.equal((await api('/notifications')).find(n => n.type === 'ical_feed_failing').read, true, 'alert closed on recovery');
  // The imported Airbnb block is a channel event: never in Airbnb's own feed.
  assert.equal(await count('airbnb'), 0, 'old token is dead');
  const c2 = async (t) => ((await (await raw(`/api/ical/${tok2}/${t}.ics`)).text()).match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(await c2('airbnb'), 3); assert.equal(await c2('booking_com'), 4);
  console.log('PASS outbound calendar: export link, no echo, rotation + redaction, sync health and 2-hour alert');
} finally { child.kill('SIGTERM'); }
