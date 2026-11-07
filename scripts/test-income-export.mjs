// Income per property export: xlsx + PDF carry exactly the page's figures (per-currency boxes, properties, bookings,
// AED equivalent for ZAR, warning notes); branding; filenames; read-only (no data change); API on a scratch DB.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { incomeReport } from '../lib/income-report.mjs';
import { withAedEquivalents } from '../lib/fx-convert.mjs';
import { exportModel, toXlsx, toPdf, exportFileName } from '../lib/income-export.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = await mkdtemp(path.join(tmpdir(), 'income-export-'));
const xlsxRead = file => JSON.parse(execFileSync('python3', ['-c', `import openpyxl,json,sys;wb=openpyxl.load_workbook(sys.argv[1]);print(json.dumps({ws.title:[[c for c in r] for r in ws.iter_rows(values_only=True)] for ws in wb}, default=str))`, file]).toString());
const pdfText = file => execFileSync('pdftotext', ['-layout', file, '-']).toString();

// ── Pure ──
{
  const props = [{ id: 1, name: 'Dubai 15', currency: 'AED', status: 'active', ownerId: 1 }, { id: 3, name: 'Garden Retreat', currency: 'ZAR', status: 'active' }];
  const v = (id, propertyId, extra = {}) => ({ id, propertyId, guestName: `G${id}`, status: 'checked_out', platform: 'airbnb', externalId: `HM${id}X`, checkIn: '2026-09-02', checkOut: '2026-09-05', nights: 3, financeMode: 'inclusive-v1', grossAmount: '1000.00', vatAmount: '0', tourismFee: '0', channelAmount: '150.00', channelFees: '150.00', managementAmount: '127.50', cleaningFee: '0', ownerAmount: '722.50', ...extra });
  const bookings = [v(1, 1), v(3, 3), { id: 4, propertyId: 1, guestName: 'Blank', status: 'checked_out', platform: 'airbnb', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, financeMode: null, grossAmount: null }];
  const data = { properties: props, settings: [{ propertyId: 1, managementFeePercent: '15' }, { propertyId: 3, managementFeePercent: '15' }], bookings, transactions: [], tickets: [], earnings: [], statements: [], owners: [{ id: 1, name: 'Owner A' }] };
  const report = withAedEquivalents(incomeReport(data, { month: '2026-09' }), { pairs: { 'ZAR>AED': { rate: 0.2, source: 'Test rate', asOf: '2026-10-12T00:00:00Z' } }, convertPropertyIds: [3] });
  const model = exportModel(report, { 1: [{ code: 'HM1X', guestName: 'G1', platform: 'airbnb', checkIn: '2026-09-02', checkOut: '2026-09-05', nights: 3, currency: 'AED', verified: true, grossAmount: 1000, vatAmount: 0, tourismFee: 0, channelAmount: 150, cleaningFee: 0, managementAmount: 127.5, ownerAmount: 722.5 }, { code: '', guestName: 'Blank', nights: 2, verified: false, estimate: null }] });
  assert.equal(exportFileName(report.period, 'xlsx'), 'income-per-property-2026-09.xlsx'); assert.equal(exportFileName({ kind: 'year', year: '2026' }, 'pdf'), 'income-per-property-2026.pdf');
  const fx = path.join(tmp, 'a.xlsx'), fp = path.join(tmp, 'a.pdf'); await writeFile(fx, toXlsx(model)); await writeFile(fp, toPdf(model));
  const wb = xlsxRead(fx); assert.deepEqual(Object.keys(wb), ['Summary', 'Properties', 'Bookings']);
  const flat = JSON.stringify(wb);
  assert.equal(wb.Summary[0][0], 'LaunchRiot for Holiday Homes'); assert.match(wb.Summary[1][0], /September 2026/);
  for (const t of report.totals) { const i = wb.Summary.findIndex(r => r[0] === `${t.currency} properties`); assert.ok(i > 0, t.currency);
    const val = l => wb.Summary.slice(i).find(r => r[0] === l)[2]; assert.equal(val('Gross booking income'), t.gross); assert.equal(val('Net payout'), t.netPayout); assert.equal(val('Management fee'), t.managementFee); assert.equal(val('Owner share'), t.ownerShare); assert.equal(val('Net to company'), t.companyNet); }
  assert.match(flat, /1 booking missing amounts/); assert.match(flat, /not verified yet/);
  const gr = wb.Properties.find(r => r[0] === 'Garden Retreat'); assert.equal(gr[2], 'ZAR'); assert.equal(gr[13], 200); assert.match(gr[15], /Display only: 1 ZAR = 0.2 AED as of 2026-10-12/); assert.doesNotMatch(gr[15], /Test rate|er-api|frankfurter/i);
  assert.ok(wb.Bookings.some(r => r[1] === 'HM1X' && r[9] === 1000 && r[15] === 722.5));
  const text = pdfText(fp); assert.match(text, /LaunchRiot for Holiday Homes/); assert.match(text, /September 2026/); assert.match(text, /Gross booking income\s+AED\s+1,000\.00/); assert.match(text, /Garden Retreat/); assert.match(text, /Display only: 1 ZAR = 0\.2 AED as of 2026-10-12/); assert.doesNotMatch(text, /Test rate|er-api|frankfurter/i); assert.match(text, /missing amounts/);
}

// ── API on a scratch DB ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-incexp-'));
const env = { ...process.env, NODE_ENV: 'development', PORT: '3021', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off' }; delete env.DATABASE_URL;
const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
const raw = (route) => fetch('http://127.0.0.1:3021/api' + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
async function api(route, method = 'GET', body, expected = 200) {
  const r = await fetch('http://127.0.0.1:3021/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return t ? JSON.parse(t) : null;
}
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  assert.equal((await raw('/reports/income/export?year=2026&format=xlsx')).status, 401, 'needs login');
  token = (await api('/auth/register', 'POST', { name: 'Export', email: 'export@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Export Owner' }, 201);
  const a = await api('/properties', 'POST', { name: 'Export AED 1BR', unitNumber: 'E-1', ownerId: owner.id, bedrooms: 1, city: 'Dubai', currency: 'AED' }, 201);
  const z = await api('/properties', 'POST', { name: 'Export ZAR Cottage', unitNumber: 'E-2', ownerId: owner.id, bedrooms: 1, city: 'Cape Town', currency: 'ZAR' }, 201);
  const base = { guestName: 'Export Guest', platform: 'direct', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 1000, managementPercent: 20, cleaningFee: 0, channelPercent: 0 };
  await api('/reservations', 'POST', { ...base, propertyId: a.id, dubaiCharges: true, checkIn: '2026-03-01', checkOut: '2026-03-04' }, 201);
  await api('/reservations', 'POST', { ...base, propertyId: z.id, dubaiCharges: false, checkIn: '2026-03-10', checkOut: '2026-03-12' }, 201);
  const before = JSON.stringify([await api('/reservations'), await api('/properties'), await api('/settings')]);
  for (const q of ['year=2026', 'month=2026-03']) {
    const page = await api(`/reports/income?${q}`);
    const rx = await raw(`/reports/income/export?${q}&format=xlsx`); assert.equal(rx.status, 200);
    assert.match(rx.headers.get('content-type'), /spreadsheetml/); assert.equal(rx.headers.get('content-disposition'), `attachment; filename="income-per-property-${q.split('=')[1]}.xlsx"`);
    const fx = path.join(tmp, 'api.xlsx'); await writeFile(fx, Buffer.from(await rx.arrayBuffer())); const wb = xlsxRead(fx);
    for (const t of page.totals) { const i = wb.Summary.findIndex(r => r[0] === `${t.currency} properties`); assert.ok(i > 0); assert.equal(wb.Summary.slice(i).find(r => r[0] === 'Owner share')[2], t.ownerShare); }
    assert.ok(wb.Bookings.filter(r => r[0]?.startsWith?.('Export')).length >= 2, 'bookings listed');
    const rp = await raw(`/reports/income/export?${q}&format=pdf`); assert.equal(rp.headers.get('content-type'), 'application/pdf');
    const fp = path.join(tmp, 'api.pdf'); await writeFile(fp, Buffer.from(await rp.arrayBuffer())); const t = pdfText(fp);
    assert.match(t, /LaunchRiot for Holiday Homes/); assert.match(t, /Export ZAR Cottage/); assert.doesNotMatch(t, /Co-Host Pro/);
  }
  assert.equal((await raw('/reports/income/export?year=2026&format=csv')).status, 400);
  assert.equal(JSON.stringify([await api('/reservations'), await api('/properties'), await api('/settings')]), before, 'read-only');
  console.log('PASS: income per property export (xlsx + PDF), same figures as the page, branding, filenames, read-only');
} catch (e) { console.error(logs.slice(-2000)); throw e; } finally { child.kill(); }
