// The Airbnb link import is switched off (4 Oct 2026): YallaPMS never reads public Airbnb listing pages.
// /airbnb/import, /airbnb/check-duplicates and /airbnb/resync answer 410 with a clear message; properties made by
// the old import stay; Airbnb iCal sync and the Airbnb CSV imports still work; no source file fetches
// airbnb.com/rooms and the web app has no button that leads to the old import.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── Source scan ──
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'public'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...await walk(path.join(root, 'artifacts/api-server/src')), ...await walk(path.join(root, 'artifacts/yallastay/src')), ...await walk(path.join(root, 'lib')).then(f => f.filter(x => !x.includes('/node_modules/')))];
for (const f of files) {
  const src = await readFile(f, 'utf8');
  // Any fetch of a listing page (airbnb.<tld>/rooms/<id>) or of a URL built from one.
  assert.ok(!/fetch\([^)]*airbnb\.[a-z.]+\/rooms/i.test(src) && !/["'`]https?:\/\/(www\.)?airbnb\.[a-z.]+\/rooms\/\$\{/i.test(src), `${path.relative(root, f)} builds or fetches an Airbnb listing page URL`);
  if (f.includes('/yallastay/src/')) {
    assert.ok(!/\/api\/airbnb\/(import|resync|check-duplicates)/.test(src), `${path.relative(root, f)} still calls a removed Airbnb route`);
    assert.ok(!/import=1|Import from Airbnb|BulkImportWizard|Import a New Listing|Paste an Airbnb URL/.test(src), `${path.relative(root, f)} still offers the Airbnb link import`);
  }
}
// The wizard file is an empty module (the Mac deploy can't delete files, so it overwrites the old one): no code left.
{ const wiz = await readFile(path.join(root, 'artifacts/yallastay/src/components/properties/BulkImportWizard.tsx'), 'utf8').catch(() => '');
  assert.equal(wiz.replace(/\/\/.*$/gm, '').trim(), wiz ? 'export {};' : '', 'the import wizard is gone (empty module at most)'); }

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-abnboff-'));
const feeds = await mkdtemp(path.join(tmpdir(), 'yallapms-abnboff-feeds-'));
const fetchLog = path.join(data, 'fetches.log'); await writeFile(fetchLog, '');
// Records every outgoing fetch the server makes (wraps the local iCal fixture server).
const recorder = path.join(data, 'record-fetch.mjs');
await writeFile(recorder, `import { appendFileSync } from 'node:fs';\nconst f = globalThis.fetch;\nglobalThis.fetch = (input, init) => { appendFileSync(${JSON.stringify(fetchLog)}, (typeof input === 'string' ? input : input.url) + '\\n'); return f(input, init); };\n`);
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3029', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog, ICAL_FIXTURE_DIR: feeds };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
let logs = '', token;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), '--import', path.join(root, 'scripts/fixtures/mock-channel-fetch.mjs'), '--import', recorder, path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3029/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Off Admin', email: 'off@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  // A property as the old link import left it (listing id, photos, description).
  const made = await api('/properties/batch', 'POST', { properties: [{ name: 'Imported Marina Loft', unitNumber: 'L1', city: 'Dubai', currency: 'AED', bedrooms: 1, airbnbListingId: '4242', description: 'From the old import', photos: JSON.stringify(['https://a0.muscache.com/im/pictures/x.jpg']) }] }, 201);
  const p = (made.created ?? made.properties ?? made)[0];
  assert.ok(p?.id, `old-style property created: ${JSON.stringify(made)}`);

  // The removed routes: 410 with a message that says what to do instead, and nothing fetched.
  for (const [route, body] of [['/airbnb/import', { url: 'https://www.airbnb.com/rooms/4242' }], ['/airbnb/import', { urls: ['https://www.airbnb.com/rooms/1', 'https://www.airbnb.ae/rooms/2'] }], ['/airbnb/check-duplicates', { urls: ['https://www.airbnb.com/rooms/4242'] }]]) {
    const r = await api(route, 'POST', body, 410);
    assert.match(r.error, /switched off/); assert.match(r.error, /iCal/); assert.match(r.error, /CSV/);
  }
  assert.match((await api(`/airbnb/resync/${p.id}`, 'POST', null, 410)).error, /Calendar sync/);
  assert.ok(Array.isArray(await api('/airbnb/import-logs')), 'the history of past imports can still be read');
  const kept = await api(`/properties/${p.id}`);
  assert.equal(p.airbnbListingId, '4242');
  assert.equal(kept.name, 'Imported Marina Loft'); assert.equal(kept.description, 'From the old import'); assert.match(String(kept.photos), /muscache/, 'existing property, photos and description kept');

  // Airbnb iCal sync still works (served from a local fixture).
  const dubaiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
  const day = (n) => { const x = new Date(`${dubaiToday}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
  await writeFile(path.join(feeds, 'airbnb-4242.ics'), `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${day(20)}\r\nDTEND;VALUE=DATE:${day(23)}\r\nUID:resv-1@airbnb.com\r\nSUMMARY:Reserved\r\nDESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMOFFTEST1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  await api(`/platforms/property/${p.id}`, 'PATCH', { airbnbIcalUrl: 'https://www.airbnb.com/calendar/ical/4242.ics?s=feedsecret' });
  const sync = await api(`/properties/${p.id}/sync-ical`, 'POST');
  assert.ok(!sync.airbnb?.error, `iCal sync ok: ${JSON.stringify(sync)}`);
  assert.equal((await api(`/calendar-sync/${p.id}/sync/airbnb`, 'POST')).ok ?? true, true);
  const resv = (await api(`/reservations?propertyId=${p.id}`)); const list = Array.isArray(resv) ? resv : resv.reservations ?? resv.data ?? [];
  assert.ok(list.some(r => r.platform === 'airbnb' && r.propertyId === p.id), 'the Airbnb booking came in through iCal');

  // The Airbnb CSV imports still work: earnings export, then the reservation breakdowns preview.
  const exp = ['"Confirmation code","Status","Guest name","Contact","# of adults","# of children","# of infants","Start date","End date","# of nights","Booked","Listing","Earnings"',
    '"HMOFFCSV01","Past guest","Csv Guest","","1","0","0","8/29/2026","8/31/2026","2","2026-08-01","Imported Marina Loft","AED 950.00"'].join('\n');
  const imp = await api('/airbnb-data/import', 'POST', { csv: exp });
  assert.ok(imp && !imp.error, `earnings CSV imported: ${JSON.stringify(imp)}`);
  assert.ok((await api('/airbnb-data')).rows.some(r => r.confirmationCode === 'HMOFFCSV01' && r.amount === 950), 'earnings row stored');
  await api('/reservations/airbnb-breakdowns/preview', 'POST', { csv: 'nope' }, 400);

  // Every fetch the server made: only the calendar feed, never a listing page.
  const urls = (await readFile(fetchLog, 'utf8')).split('\n').filter(Boolean);
  assert.ok(urls.some(u => u.includes('/calendar/ical/4242.ics')), 'the iCal feed was fetched');
  assert.ok(!urls.some(u => /airbnb\.[a-z.]+\/rooms\//i.test(u)), `no listing page fetched: ${urls.join(', ')}`);
  console.log('OK Airbnb link import off: 410s, existing property kept, iCal sync and CSV import still work, no listing pages fetched');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill('SIGTERM'); }
