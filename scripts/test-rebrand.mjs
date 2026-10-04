// Rebrand (Clifford, 4 Oct 2026): everything a user or owner sees says "Co-Host Pro" instead of YallaStay / YallaPMS
// (window title, manifest, favicon, sidebar, login, owner portal, statement PDFs, owner emails, calendar name).
// The company on documents is the setting "Company name on documents" (company.documentName, default Co-Host Pro).
// Internal identifiers keep the old name so the Mac deploy, the database and calendar subscriptions keep working.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BRAND, DEFAULT_FROM_EMAIL, documentName } from '../lib/brand.mjs';
import { ownerCodeEmail, statementEmail } from '../lib/owner-emails.mjs';
import { buildIcal } from '../lib/calendar-export.mjs';
import { statementHtml } from '../artifacts/yallastay/src/lib/print-statement.ts';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => readFile(path.join(root, p), 'utf8');
const OLD = /yalla\s?stay|yalla\s?pms|owners come first/i;

// ── Brand module and the setting's fallback ──
assert.equal(BRAND, 'Co-Host Pro');
assert.equal(documentName(undefined), BRAND); assert.equal(documentName({ name: 'YallaStay Holiday Homes' }), BRAND, 'the old company name is not used on documents');
assert.equal(documentName({ documentName: '   ' }), BRAND); assert.equal(documentName({ documentName: '  Landman  Stays ' }), 'Landman Stays');
assert.match(DEFAULT_FROM_EMAIL, /^Co-Host Pro </, 'sender name'); assert.match(DEFAULT_FROM_EMAIL, /<noreply@yallastay\.ae>$/, 'the sending address (domain already set up) is unchanged');

// ── Shell: window title, manifest, favicon ──
const html = await read('artifacts/yallastay/index.html');
assert.match(html, /<title>Co-Host Pro<\/title>/); assert.doesNotMatch(html, OLD); assert.doesNotMatch(html, /Replit/);
assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/); assert.match(html, /rel="apple-touch-icon"/);
const manifest = JSON.parse(await read('artifacts/yallastay/public/manifest.webmanifest'));
assert.equal(manifest.name, BRAND); assert.equal(manifest.short_name, BRAND);
const fav = await read('artifacts/yallastay/public/favicon.svg');
assert.doesNotMatch(fav, /#FF3C00/i, 'the placeholder orange favicon is replaced'); assert.match(fav, /<path/);
await readFile(path.join(root, 'artifacts/yallastay/public/apple-touch-icon.png'));

// ── No visible old brand anywhere in the app or API source (comments and stable identifiers excepted) ──
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'generated', 'api-spec'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const ALLOWED = /X-YallaPMS-Check|x-yallapms-check|inYallaPMS|PRODID:-\/\/YallaStay\/\/YallaPMS\/\/EN|UID:yallapms-\$\{r\.id\}@yallastay|noreply@yallastay\.ae|yallapms-[a-z-]+'|yallastay-logo/g;
const offenders = [];
for (const f of [...await walk(path.join(root, 'artifacts/yallastay/src')), ...await walk(path.join(root, 'artifacts/api-server/src')), ...await walk(path.join(root, 'lib'))]) {
  (await readFile(f, 'utf8')).split('\n').forEach((line, i) => {
    const code = line.replace(ALLOWED, '').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/\{\/\*.*?\*\/\}/g, '');
    if (/^\s*\*/.test(line) || /^\s*\/\*/.test(line)) return;
    if (OLD.test(code) || /\bYalla\b|\bYALLA\b/.test(code)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
  });
}
assert.deepEqual(offenders, [], 'visible old brand');
for (const f of ['pages/login.tsx', 'pages/signup.tsx', 'pages/forgot-password.tsx']) assert.doesNotMatch(await read(`artifacts/yallastay/src/${f}`), /yallastay-home/, `${f}: no link to the old brand's website`);
const layout = await read('artifacts/yallastay/src/components/layout/app-layout.tsx');
assert.match(layout, /data-testid="sidebar-wordmark"[^>]*>\{BRAND\}/); assert.match(layout, /cohost-logo\.svg/);
const portal = await read('artifacts/yallastay/src/pages/owner-portal.tsx');
assert.match(portal, /data-testid="portal-company"[^>]*>\{companyName\}/); assert.match(portal, /useDocumentName\(\)/);
assert.match(await read('artifacts/yallastay/src/pages/settings.tsx'), /label="Company name on documents"/);

// ── Statement PDF ──
const stmt = { month: '2026-09', currency: 'AED', status: 'draft', propertyName: 'Marina 1BR', grossRevenue: 1000, platformFees: 150, managementFee: 170, cleaningCosts: 0, maintenanceCosts: 0, otherExpenses: 0, vatAmount: 0, tourismFee: 0, ownerPayout: 680, paidByAirbnb: 0, bookingDetails: [] };
const def = statementHtml(stmt, []);
assert.match(def, /<div class="muted">Co-Host Pro<\/div>/, 'default company on the statement'); assert.doesNotMatch(def, OLD);
assert.match(statementHtml(stmt, [], 'Landman Stays <LLC>'), /<div class="muted">Landman Stays &lt;LLC&gt;<\/div>/, 'setting used, escaped');
assert.match(await read('artifacts/yallastay/src/pages/accounting.tsx'), /printStatement\(stmt,rows,documentName\)/);
assert.match(await read('artifacts/yallastay/src/pages/owner-history.tsx'), /printHistory\(h, documentName\)/);

// ── Owner emails ──
const otp = ownerCodeEmail({ ownerName: 'Anna <b>', code: '123456', company: 'Landman Stays' });
assert.match(otp.subject, /^123456 — Your Landman Stays Owner Portal code$/); assert.match(otp.html, /Landman Stays Owner Portal/);
assert.match(otp.html, /Anna &lt;b&gt;/); assert.doesNotMatch(otp.html + otp.subject, OLD);
assert.doesNotMatch(ownerCodeEmail({ ownerName: 'A', code: '1' }).html, OLD);
const se = statementEmail({ ownerName: 'Anna', propertyName: 'Marina 1BR', statement: { ...stmt, bookingsCount: 2 }, company: BRAND });
assert.match(se.subject, /Owner statement 2026-09 · Marina 1BR · Co-Host Pro/); assert.doesNotMatch(se.html, OLD);
for (const f of ['artifacts/api-server/src/routes/owner-auth.ts', 'artifacts/api-server/src/lib/auto-statements.ts']) {
  const s = await read(f); assert.match(s, /RESEND_FROM_EMAIL \|\| DEFAULT_FROM_EMAIL/, `${f}: env override kept`); assert.match(s, /documentCompanyName\(\)/);
}

// ── Stable identifiers unchanged ──
const ics = buildIcal([{ id: 7, checkIn: '2026-10-01', checkOut: '2026-10-03' }], { now: new Date('2026-10-04T00:00:00Z') });
assert.match(ics, /X-WR-CALNAME:Co-Host Pro/, 'visible calendar name'); assert.match(ics, /UID:yallapms-7@yallastay/, 'event UIDs unchanged (no duplicate events for subscribers)');
assert.match(await read('artifacts/yallastay/src/lib/api-fetch.ts'), /'ys_auth'/, 'login storage key unchanged');
assert.match(await read('artifacts/api-server/src/routes/calendar-sync.ts'), /x-yallapms-check/);
assert.equal(JSON.parse(await read('artifacts/api-server/package.json')).name, '@workspace/api-server');
assert.ok(JSON.parse(await read('artifacts/yallastay/package.json')).name, 'web package name present');

// ── API: public /brand and the company setting ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-rebrand-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3033', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_DELIVERY: 'off' };
delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200, auth = true) {
  const r = await fetch('http://127.0.0.1:3033/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token && auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t.slice(0, 400)}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  assert.deepEqual(await api('/brand', 'GET', null, 200, false), { appName: BRAND, documentName: BRAND }, 'public, default Co-Host Pro');
  await api('/settings', 'GET', null, 401, false);
  token = (await api('/auth/register', 'POST', { name: 'Brand Admin', email: 'brand@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const s0 = await api('/settings');
  assert.equal(s0.company.documentName, BRAND); assert.doesNotMatch(JSON.stringify(s0.company), OLD, 'no old brand in the defaults');
  // A company setting saved before the rebrand (old name, no documentName): documents still say Co-Host Pro.
  await api('/settings/company', 'PUT', { value: { name: 'YallaStay Holiday Homes', email: 'hello@example.invalid', currency: 'AED' } }, 201);
  const s1 = await api('/settings');
  assert.equal(s1.company.documentName, BRAND, 'missing field filled from the default'); assert.equal(s1.company.name, 'YallaStay Holiday Homes', 'stored values untouched'); assert.equal(s1.company.email, 'hello@example.invalid');
  assert.equal((await api('/brand', 'GET', null, 200, false)).documentName, BRAND);
  await api('/settings/company', 'PUT', { value: { ...s1.company, documentName: 'Landman Holiday Homes' } });
  assert.equal((await api('/brand', 'GET', null, 200, false)).documentName, 'Landman Holiday Homes', 'the setting is used');
  await api('/settings/company', 'PUT', { value: { ...s1.company, documentName: '  ' } });
  assert.equal((await api('/brand', 'GET', null, 200, false)).documentName, BRAND, 'empty falls back to Co-Host Pro');
  assert.equal((await fetch('http://127.0.0.1:3033/api/brand', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, 'read only');
  console.log('PASS: rebrand to Co-Host Pro (title, manifest, favicon, UI, statements, owner emails, calendar name); "Company name on documents" setting defaults to Co-Host Pro; internal identifiers unchanged');
} catch (e) { console.error(logs.slice(-3000)); throw e; } finally { child.kill(); }
