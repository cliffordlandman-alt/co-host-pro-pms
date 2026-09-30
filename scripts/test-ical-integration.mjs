// Runs the real API with channel feeds served from local fixture files.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-ical-'));
const feeds = await mkdtemp(path.join(tmpdir(), 'yallapms-feeds-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3005', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), ICAL_FIXTURE_DIR: feeds };
delete env.DATABASE_URL;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/fixtures/mock-channel-fetch.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3005/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const ics = (...ev) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.map(e => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${e.s}\r\nDTEND;VALUE=DATE:${e.e}\r\nUID:${e.uid}\r\nSUMMARY:${e.sum}\r\n${e.desc ? `DESCRIPTION:${e.desc}\r\n` : ''}END:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'iCal Test', email: 'ical@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Feed Owner' }, 201);
  const p = await api('/properties', 'POST', { name: 'Feed Test 1BR', unitNumber: 'F-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED', cleaningFee: '150' }, 201);
  await writeFile(path.join(feeds, 'airbnb.ics'), ics(
    { s: '20361010', e: '20361013', uid: 'stay1@airbnb.com', sum: 'Reserved', desc: 'https://www.airbnb.com/hosting/reservations/details/HMFEED0001' },
    { s: '20361020', e: '20361022', uid: 'block1@airbnb.com', sum: 'Airbnb (Not available)' }));
  await writeFile(path.join(feeds, 'booking_com.ics'), ics({ s: '20361011', e: '20361012', uid: 'bk-clash', sum: 'Overlapping Guest' }));
  await api(`/platforms/property/${p.id}`, 'PATCH', { airbnbIcalUrl: 'https://www.airbnb.com/calendar/ical/123.ics?s=abc' });
  await api(`/platforms/property/${p.id}`, 'PATCH', { bookingComIcalUrl: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc' });
  let first = await api(`/properties/${p.id}/sync-ical`, 'POST');
  first = await api(`/properties/${p.id}/sync-ical`, 'POST'); // second run must be a no-op
  assert.equal(first.airbnb.created, 0); assert.equal(first.booking.created, 0);
  let rows = await api(`/reservations?propertyId=${p.id}`);
  assert.equal(rows.length, 3, 'stay + block + overlapping Booking.com stay, no duplicates');
  const stay = rows.find(r => r.externalId === 'airbnb:HMFEED0001');
  const block = rows.find(r => r.status === 'blocked');
  assert.ok(stay && block); assert.equal(stay.paymentStatus, 'unknown');
  let tasks = (await api('/cleaning')).filter(t => t.propertyId === p.id);
  assert.equal(tasks.length, 2, 'cleaning for the two guest stays only, none for the block');
  let notes = await api('/notifications');
  assert.ok(notes.some(n => n.type === 'ical_overlap'), 'double booking is flagged');
  // Guest moves dates; the Booking.com stay is cancelled on the channel; the Airbnb block is lifted.
  await writeFile(path.join(feeds, 'airbnb.ics'), ics({ s: '20361014', e: '20361017', uid: 'stay1@airbnb.com', sum: 'Reserved', desc: 'details/HMFEED0001' }));
  await writeFile(path.join(feeds, 'booking_com.ics'), ics());
  await api(`/properties/${p.id}/sync-ical`, 'POST');
  await api(`/properties/${p.id}/sync-ical`, 'POST');
  rows = await api(`/reservations?propertyId=${p.id}`);
  const movedStay = rows.find(r => r.id === stay.id);
  assert.equal(movedStay.checkIn, '2036-10-14'); assert.equal(movedStay.checkOut, '2036-10-17');
  assert.equal(rows.find(r => r.id === block.id).status, 'cancelled', 'lifted channel block released');
  const bk = rows.find(r => r.platform === 'booking_com');
  assert.equal(bk.status, 'confirmed', 'guest stay is never auto-cancelled');
  tasks = (await api('/cleaning')).filter(t => t.propertyId === p.id);
  assert.equal(tasks.find(t => t.reservationId === stay.id).scheduledDate, '2036-10-17', 'cleaning follows the new checkout');
  notes = await api('/notifications');
  assert.equal(notes.filter(n => n.type === 'ical_missing' && n.entityId === String(bk.id)).length, 1, 'missing stay flagged once, not every sync');
  // An Airbnb earnings CSV for the same stay links to it instead of duplicating.
  await api('/airbnb-data/import', 'POST', { csv: 'Date,Type,Confirmation code,Guest,Listing,Start date,End date,Currency,Amount\n2036-10-18,Reservation,HMFEED0001,Real Guest,Feed Test 1BR,2036-10-14,2036-10-17,AED,900.00', status: 'paid' });
  const typed = await api('/reservations', 'POST', { propertyId: p.id, guestName: 'Typed', platform: 'airbnb', checkIn: '2036-11-01', checkOut: '2036-11-03', revenue: 0, paymentStatus: 'unknown', status: 'confirmed' }, 201);
  await api('/airbnb-data/import', 'POST', { csv: 'Date,Type,Confirmation code,Guest,Listing,Start date,End date,Currency,Amount\n2036-11-04,Reservation,HMFEED0002,Typed,Feed Test 1BR,2036-11-01,2036-11-03,AED,500.00', status: 'paid' });
  rows = await api(`/reservations?propertyId=${p.id}`);
  assert.equal(rows.filter(r => r.status !== 'cancelled' && r.platform === 'airbnb').length, 2, 'CSV import linked both stays, no duplicates');
  assert.equal(rows.find(r => r.id === typed.id).externalId, 'airbnb:HMFEED0002');
  console.log('PASS: live-API iCal sync with fixture feeds — idempotent, blocks not guests, cleaning only for stays, double-booking and missing-stay flags (deduplicated), date moves reschedule cleaning, CSV import links instead of duplicating');
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
