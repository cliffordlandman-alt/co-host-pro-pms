// Regression: Airbnb reuses the same "Not available" event UID across different listings.
// Each property's feed must import its own copy (keyed by property + UID), for blocks and for stays.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-shareduid-'));
const feeds = await mkdtemp(path.join(tmpdir(), 'yallapms-sharedfeeds-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3006', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), ICAL_FIXTURE_DIR: feeds };
delete env.DATABASE_URL;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/fixtures/mock-channel-fetch.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3006/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
const ics = (...ev) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.map(e => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${e.s}\r\nDTEND;VALUE=DATE:${e.e}\r\nUID:${e.uid}\r\nSUMMARY:${e.sum}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Shared UID Test', email: 'shared-uid@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Feed Owner' }, 201);
  const a = await api('/properties', 'POST', { name: 'Listing A', unitNumber: 'A-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED', cleaningFee: '100' }, 201);
  const b = await api('/properties', 'POST', { name: 'Listing B', unitNumber: 'B-1', ownerId: owner.id, bedrooms: 2, city: 'Dubai', currency: 'AED', cleaningFee: '100' }, 201);
  // Same UIDs in both feeds, different dates (as Airbnb does for "Not available" and UID-only stays).
  await writeFile(path.join(feeds, 'airbnb-111.ics'), ics(
    { s: '20361001', e: '20361010', uid: 'shared-na@airbnb.com', sum: 'Airbnb (Not available)' },
    { s: '20361101', e: '20361104', uid: 'shared-stay@airbnb.com', sum: 'Reserved' }));
  await writeFile(path.join(feeds, 'airbnb-222.ics'), ics(
    { s: '20361001', e: '20370301', uid: 'shared-na@airbnb.com', sum: 'Airbnb (Not available)' },
    { s: '20370310', e: '20370312', uid: 'shared-stay@airbnb.com', sum: 'Reserved' }));
  await api(`/platforms/property/${a.id}`, 'PATCH', { airbnbIcalUrl: 'https://www.airbnb.com/calendar/ical/111.ics?s=test-only' });
  await api(`/platforms/property/${b.id}`, 'PATCH', { airbnbIcalUrl: 'https://www.airbnb.com/calendar/ical/222.ics?s=test-only' });
  // Saving a feed URL already syncs in the background; an explicit sync on top must still leave one copy per property.
  await api(`/properties/${a.id}/sync-ical`, 'POST');
  await api(`/properties/${b.id}/sync-ical`, 'POST');
  const rowsA = (await api(`/reservations?propertyId=${a.id}`)).filter(r => r.status !== 'cancelled');
  const rowsB = (await api(`/reservations?propertyId=${b.id}`)).filter(r => r.status !== 'cancelled');
  assert.deepEqual(rowsA.map(r => [r.status, r.checkIn, r.checkOut]).sort(), [['blocked', '2036-10-01', '2036-10-10'], ['confirmed', '2036-11-01', '2036-11-04']]);
  assert.deepEqual(rowsB.map(r => [r.status, r.checkIn, r.checkOut]).sort(), [['blocked', '2036-10-01', '2037-03-01'], ['confirmed', '2037-03-10', '2037-03-12']], "listing B keeps its own block + stay, not dropped because A already used the UIDs");
  // Re-syncing either property is a no-op and never touches the other property's copy.
  for (const p of [a, b, a]) { const r = await api(`/properties/${p.id}/sync-ical`, 'POST'); assert.equal(r.airbnb.created, 0); assert.equal(r.airbnb.updated, 0); assert.equal(r.airbnb.released, 0); }
  // A lifted block on B is released on B only.
  await writeFile(path.join(feeds, 'airbnb-222.ics'), ics({ s: '20370310', e: '20370312', uid: 'shared-stay@airbnb.com', sum: 'Reserved' }));
  const lifted = await api(`/properties/${b.id}/sync-ical`, 'POST');
  assert.equal(lifted.airbnb.released, 1);
  assert.equal((await api(`/reservations?propertyId=${a.id}`)).find(r => r.status === 'blocked')?.checkOut, '2036-10-10', "A's block is untouched");
  assert.equal((await api(`/reservations?propertyId=${b.id}`)).filter(r => r.status === 'blocked').length, 0);
  // Airbnb reissues A's "Not available" UID with overlapping dates: the new block replaces the old one in one sync.
  await writeFile(path.join(feeds, 'airbnb-111.ics'), ics(
    { s: '20361002', e: '20361010', uid: 'reissued-na@airbnb.com', sum: 'Airbnb (Not available)' },
    { s: '20361101', e: '20361104', uid: 'shared-stay@airbnb.com', sum: 'Reserved' }));
  const reissue = await api(`/properties/${a.id}/sync-ical`, 'POST');
  assert.equal(reissue.airbnb.created, 1); assert.equal(reissue.airbnb.released, 1); assert.equal(reissue.airbnb.flagged, 0);
  assert.deepEqual((await api(`/reservations?propertyId=${a.id}`)).filter(r => r.status === 'blocked').map(r => [r.checkIn, r.checkOut]), [['2036-10-02', '2036-10-10']], 'reissued block present right after one sync');
  const again = await api(`/properties/${a.id}/sync-ical`, 'POST'); assert.equal(again.airbnb.created + again.airbnb.updated + again.airbnb.released, 0);
  console.log('PASS: shared channel UIDs across listings — each property keeps its own block and stay, re-sync idempotent, releases stay per property, reissued block UID replaced in one sync');
} catch (e) { console.error(e); console.error(logs.slice(-4000)); process.exitCode = 1; }
finally { child.kill('SIGTERM'); }
