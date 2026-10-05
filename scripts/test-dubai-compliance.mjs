// Dubai compliance pack (roadmap #6): permit record per unit with renewal reminders at 60/30/7 days in the Task
// Centre; DTCM guest registration per booking (Airbnb never "pending"); the monthly Tourism Dirham and VAT report
// (amounts from the verified bookings, rates only from Fee settings, "rate not confirmed" when unset) with CSV
// export; the filing reminder for last month's return, due on the 15th, until it is recorded as filed.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { renewalStage, renewalReminders, validatePermit, registrationStatus, registrationOptions, taxSettings, taxReport, taxReportCsv, filingReminder, daysUntil } from '../lib/compliance.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} vs ${b}`);

// ── Pure ──
{
  assert.deepEqual([61, 60, 31, 30, 8, 7, 0, -1].map(renewalStage), [null, '60', '60', '30', '30', '7', '7', 'expired']);
  assert.equal(daysUntil('2026-10-04', '2026-11-03'), 30);
  const props = [{ id: 1, name: 'B Flat', status: 'active' }, { id: 2, name: 'A Flat', status: 'active' }, { id: 3, name: 'Old', status: 'archived' }];
  const rem = renewalReminders([{ propertyId: 1, permitExpiryDate: '2026-10-10', insuranceExpiryDate: '2027-06-01', ejariExpiryDate: '2026-09-30' }, { propertyId: 2, oaNocExpiryDate: '2026-12-01' }, { propertyId: 3, permitExpiryDate: '2026-10-05' }], props, '2026-10-04');
  assert.deepEqual(rem.map(r => [r.propertyName, r.field, r.days, r.stage]), [['B Flat', 'ejariExpiryDate', -4, 'expired'], ['B Flat', 'permitExpiryDate', 6, '7'], ['A Flat', 'oaNocExpiryDate', 58, '60']], 'most urgent first; archived and far-off skipped');
  assert.match(validatePermit({ dtcmClass: 'Premium' }).error, /Standard or Deluxe/);
  assert.match(validatePermit({ permitExpiryDate: '2026-13-01' }).error, /date/);
  assert.match(validatePermit({ permitIssueDate: '2026-05-01', permitExpiryDate: '2026-04-01' }).error, /before its issue date/);
  assert.deepEqual(validatePermit({ dtcmPermitNumber: '  ABC-1 ', dtcmClass: 'Deluxe', permitExpiryDate: '2027-01-31', notes: '' }).values, { dtcmPermitNumber: 'ABC-1', oaNocReference: null, insuranceReference: null, ejariNumber: null, notes: null, dtcmClass: 'deluxe', permitIssueDate: null, permitExpiryDate: '2027-01-31', oaNocExpiryDate: null, insuranceExpiryDate: null, ejariExpiryDate: null });
  const dxb = { city: 'Dubai' }, cpt = { city: 'Cape Town' };
  assert.equal(registrationStatus({ platform: 'airbnb', status: 'confirmed' }, dxb), 'airbnb_verified');
  assert.equal(registrationStatus({ platform: 'airbnb', status: 'confirmed', dtcmRegistration: 'pending' }, dxb), 'airbnb_verified', 'a stored "pending" never shows on an Airbnb booking');
  assert.equal(registrationStatus({ platform: 'booking_com', status: 'confirmed' }, dxb), 'pending');
  assert.equal(registrationStatus({ platform: 'direct', status: 'confirmed', dtcmRegistration: 'registered' }, dxb), 'registered');
  assert.equal(registrationStatus({ platform: 'booking_com', status: 'confirmed' }, cpt), 'not_needed');
  assert.equal(registrationStatus({ platform: 'direct', status: 'blocked' }, dxb), null);
  assert.ok(!registrationOptions({ platform: 'airbnb' }).includes('pending'));
  assert.deepEqual(taxSettings(null), { tourism: { confirmed: false, text: 'rate not confirmed' }, vat: { confirmed: false, text: 'rate not confirmed' } });
  assert.equal(taxSettings({ tourismEnabled: true, tourismRate: '15', vatEnabled: false, vatPercent: '5' }).tourism.text, 'rate not confirmed (Fee settings: AED 15 per room-night)', 'a rate nobody confirmed is shown as not confirmed');
  assert.equal(taxSettings({ tourismEnabled: true, tourismRate: '15', tourismConfirmed: true, vatEnabled: false, vatPercent: '5' }).tourism.text, 'AED 15 per room-night');
  assert.equal(taxSettings({ tourismEnabled: true, tourismRate: '0', tourismConfirmed: true, vatEnabled: false }).tourism.text, 'rate not confirmed', 'confirmed tick with no rate is still not confirmed');
  assert.equal(taxSettings({ tourismEnabled: true, tourismRate: '15', vatEnabled: false, vatConfirmed: true }).vat.text, 'not charged');
  assert.equal(taxSettings({ tourismEnabled: true, tourismRate: '15', vatEnabled: false }).vat.text, 'rate not confirmed (Fee settings: not charged)');
  const P = [{ id: 1, name: '=Marina', city: 'Dubai', currency: 'AED', status: 'active' }, { id: 2, name: 'Cape House', city: 'Cape Town', currency: 'ZAR', status: 'active' }, { id: 3, name: 'Downtown', city: 'Dubai', currency: 'AED', status: 'active' }];
  const bk = (id, propertyId, checkOut, extra) => ({ id, propertyId, checkIn: '2026-09-01', checkOut, nights: 3, status: 'checked_out', platform: 'booking_com', financeMode: 'inclusive-v1', grossAmount: '1000', revenue: '900', tourismFee: '30', tourismRate: '10', tourismRooms: 1, tourismNights: 3, vatAmount: '45', vatRate: '5', ...extra });
  const rep = taxReport({ properties: P, settings: [{ propertyId: 1, tourismEnabled: true, tourismRate: '10', vatEnabled: true, vatPercent: '5', tourismConfirmed: true, vatConfirmed: true }], month: '2026-09',
    bookings: [bk(1, 1, '2026-09-04'), bk(2, 1, '2026-09-20', { tourismRooms: 2 , tourismFee: '60' }), bk(3, 1, '2026-10-02'), bk(4, 1, '2026-09-10', { financeMode: null, externalId: 'airbnb:HMX1', platform: 'airbnb' }), bk(5, 2, '2026-09-05', { tourismFee: '0', vatAmount: '0' }), bk(6, 3, '2026-09-06', { status: 'cancelled' })] });
  assert.deepEqual(rep.properties.map(r => r.name), ['=Marina', 'Downtown'], 'Dubai properties only (Cape House has no Tourism Dirham or VAT)');
  const m = rep.properties[0];
  assert.deepEqual(m.figures.map(f => [f.currency, f.bookings, f.roomNights, f.tourismFee, f.vat, f.accommodation]), [['AED', 2, 9, 90, 90, 1800]]);
  assert.equal(m.unverified, 1); assert.deepEqual(m.unverifiedCodes, ['HMX1']); assert.deepEqual(m.registration, { pending: 2, airbnb_verified: 1 });
  assert.equal(rep.properties[1].settings.tourism.text, 'rate not confirmed'); assert.deepEqual(rep.unconfirmed, ['Downtown']);
  assert.deepEqual(rep.totals.map(t => [t.currency, t.tourismFee, t.vat]), [['AED', 90, 90]]);
  const csv = taxReportCsv(rep).split('\r\n');
  assert.match(csv[0], /^Month,Property,Unit,Currency,Verified bookings/);
  assert.ok(csv[1].startsWith(`2026-09,"'=Marina"`), 'a cell starting with = is neutralised (no spreadsheet formula)');
  assert.match(csv[1], /,90\.00,10,90\.00,5%,AED 10 per room-night,5% \(inside the guest total\),1$/);
  assert.match(csv[2], /^2026-09,Downtown,,AED,0,0,0,0\.00,0\.00,0\.00,,0\.00,,rate not confirmed,rate not confirmed,0$/);
  assert.match(csv[3], /^2026-09,TOTAL AED,,AED,2,6,9,2000\.00,1800\.00,90\.00,,90\.00/);
  assert.deepEqual(filingReminder({ today: '2026-10-04', filings: [], hasDubai: true }), { kind: 'tourism_dirham', period: '2026-09', due: '2026-10-15', days: 11, overdue: false });
  assert.equal(filingReminder({ today: '2026-10-16', filings: [], hasDubai: true }).overdue, true);
  assert.equal(filingReminder({ today: '2026-10-04', filings: [{ kind: 'tourism_dirham', period: '2026-09' }], hasDubai: true }), null);
  assert.equal(filingReminder({ today: '2026-01-04', filings: [], hasDubai: true }).period, '2025-12');
  assert.equal(filingReminder({ today: '2026-10-04', filings: [], hasDubai: false }), null);
}

// ── API ──
const data = await mkdtemp(path.join(tmpdir(), 'yallapms-compliance-'));
const outLog = path.join(data, 'outbound.log'); await writeFile(outLog, '');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3028', LOCAL_DATA_DIR: path.join(data, 'db'), MIGRATIONS_DIR: path.join(root, 'drizzle'), SYNC_SCHEDULER: 'off', OUTBOUND_LOG: outLog };
delete env.DATABASE_URL; delete env.OUTBOUND_DELIVERY;
const child = spawn(process.execPath, ['--import', path.join(root, 'scripts/outbound-guard.mjs'), path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
let token;
async function api(route, method = 'GET', body, expected = 200, raw = false) {
  const r = await fetch('http://127.0.0.1:3028/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${t}`); return raw ? { text: t, headers: r.headers } : t ? JSON.parse(t) : null;
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const prev = (() => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); })();
try {
  for (let i = 0; i < 80; i++) { try { await api('/healthz'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  token = (await api('/auth/register', 'POST', { name: 'Compliance Admin', email: 'dtcm@example.invalid', password: 'Test-only-6284!' }, 201)).token;
  const owner = await api('/owners', 'POST', { name: 'Owner' }, 201);
  const A = await api('/properties', 'POST', { name: 'Marina Permit', unitNumber: 'MP', city: 'Dubai', currency: 'AED', bedrooms: 2, ownerId: owner.id }, 201);
  await api(`/accounting/settings/${A.id}`, 'PUT', { managementFeePercent: 20, platformFeeBookingCom: 15, tourismRate: 15, tourismEnabled: true, vatEnabled: true, vatPercent: 5, tourismConfirmed: true, vatConfirmed: true });
  const Bp = await api('/properties', 'POST', { name: 'Unset Rates Flat', unitNumber: 'UR', city: 'Dubai', currency: 'AED', bedrooms: 1, ownerId: owner.id }, 201);
  const Z = await api('/properties', 'POST', { name: 'Gqeberha House', unitNumber: 'GH', city: 'Gqeberha', currency: 'ZAR', bedrooms: 1, ownerId: owner.id }, 201);
  const book = (p, ci, co, extra = {}) => api('/reservations', 'POST', { propertyId: p.id, guestName: `G ${p.unitNumber} ${ci}`, platform: 'booking_com', checkIn: ci, checkOut: co, status: 'confirmed', ...extra }, 201);
  const verified = (p, ci, co, gross, extra = {}) => book(p, ci, co, { financeMode: 'inclusive-v1', grossAmount: gross, cleaningFee: 0, dubaiCharges: p.city === 'Dubai', ...extra });
  const v1 = await verified(A, `${prev}-02`, `${prev}-05`, 3300);
  const v2 = await verified(A, `${prev}-10`, `${prev}-12`, 1500);
  await verified(Bp, `${prev}-03`, `${prev}-06`, 2000);
  await book(A, `${prev}-20`, `${prev}-22`, { platform: 'airbnb' }); // not verified
  await verified(Z, `${prev}-03`, `${prev}-06`, 4000);

  // Monthly report: the bookings' own amounts, per property, rates only from Fee settings.
  const rep = await api(`/compliance/tax-report?month=${prev}`);
  const rows = await api(`/reservations?propertyId=${A.id}`);
  const vb = rows.filter(r => [v1.id, v2.id].includes(r.id));
  const a = rep.properties.find(p => p.propertyId === A.id);
  near(a.figures[0].tourismFee, vb.reduce((n, r) => n + Number(r.tourismFee), 0), 'Tourism Dirham = sum of the bookings');
  near(a.figures[0].vat, vb.reduce((n, r) => n + Number(r.vatAmount), 0), 'VAT = sum of the bookings');
  assert.ok(a.figures[0].tourismFee > 0 && a.figures[0].vat > 0);
  assert.equal(a.figures[0].bookings, 2); assert.equal(a.unverified, 1); assert.equal(a.settings.tourism.text, 'AED 15 per room-night');
  const b = rep.properties.find(p => p.propertyId === Bp.id);
  assert.equal(b.settings.tourism.text, 'rate not confirmed (Fee settings: AED 10 per room-night)', 'the screen default is not a confirmed rate');
  assert.equal(b.settings.vat.confirmed, false); assert.match(b.settings.vat.text, /^rate not confirmed/);
  const fs = (await api('/accounting/settings')).find(s => s.propertyId === A.id);
  assert.equal(fs.tourismConfirmed, true); assert.equal(fs.vatConfirmed, true);
  assert.deepEqual(rep.unconfirmed, ['Unset Rates Flat']);
  assert.ok(!rep.properties.some(p => p.propertyId === Z.id), 'ZAR property outside Dubai is not in the DTCM report');
  assert.deepEqual(rep.totals.map(t => t.currency), ['AED']);
  const csv = await api(`/compliance/tax-report.csv?month=${prev}`, 'GET', null, 200, true);
  assert.match(csv.headers.get('content-type'), /^text\/csv/); assert.match(csv.headers.get('content-disposition'), new RegExp(`tourism-dirham-vat-${prev}\\.csv`));
  assert.equal(csv.text.trim().split('\r\n').length, 4, 'header + 2 properties + AED total');
  assert.ok(csv.text.includes('rate not confirmed'));
  await api('/compliance/tax-report?month=2026-13', 'GET', null, 400);

  // Filing reminder for last month, until filed.
  let tc = await api('/task-centre');
  const filingTask = tc.find(t => t.type === 'Tourism Dirham return');
  assert.ok(filingTask && filingTask.title.includes(prev) && filingTask.href === `/compliance?tab=tax&month=${prev}`, 'filing reminder in the Task Centre');
  assert.match(filingTask.detail, new RegExp(`${today.slice(0, 7)}-15`));
  await api('/compliance/filings', 'POST', { period: today.slice(0, 7) }, 400);
  await api('/compliance/filings', 'POST', { period: prev, filedOn: addDays(today, 1) }, 400);
  const filed = await api('/compliance/filings', 'POST', { period: prev, reference: 'DTCM-123' }, 201);
  await api('/compliance/filings', 'POST', { period: prev }, 409);
  assert.ok(!(await api('/task-centre')).some(t => t.type === 'Tourism Dirham return'), 'reminder gone once filed');
  assert.equal((await api(`/compliance/tax-report?month=${prev}`)).filing.reference, 'DTCM-123');
  await api(`/compliance/filings/${filed.id}`, 'DELETE');
  assert.ok((await api('/task-centre')).some(t => t.type === 'Tourism Dirham return'), 'undo brings it back');

  // Permits and renewals at 60 / 30 / 7 days.
  await api(`/compliance/permits/${A.id}`, 'PUT', { dtcmClass: 'premium' }, 400);
  await api(`/compliance/permits/${A.id}`, 'PUT', { permitExpiryDate: '31/12/2026' }, 400);
  await api(`/compliance/permits/999999`, 'PUT', {}, 404);
  await api(`/compliance/permits/${A.id}`, 'PUT', { dtcmPermitNumber: 'HH-0001', dtcmClass: 'Standard', permitIssueDate: addDays(today, -340), permitExpiryDate: addDays(today, 25), insuranceExpiryDate: addDays(today, 70), ejariExpiryDate: addDays(today, 5), oaNocReference: 'NOC-7', oaNocExpiryDate: addDays(today, -2) });
  const permits = await api('/compliance/permits');
  assert.equal(permits.uploads, false); assert.match(permits.uploadsNote, /come with hosting/);
  const pa = permits.properties.find(p => p.id === A.id);
  assert.equal(pa.permit.dtcmClass, 'standard'); assert.equal(pa.permit.dtcmPermitNumber, 'HH-0001');
  assert.deepEqual(pa.reminders.map(r => [r.field, r.stage]), [['oaNocExpiryDate', 'expired'], ['ejariExpiryDate', '7'], ['permitExpiryDate', '30']], 'insurance at 70 days not yet');
  tc = await api('/task-centre');
  const ren = tc.filter(t => t.id.startsWith(`renew-${A.id}-`));
  assert.deepEqual(ren.map(t => [t.type, t.urgency]), [['Permit expired', 'high'], ['Renewal due', 'high'], ['Renewal due', 'medium']]);
  assert.match(ren[2].detail, /DTCM holiday-home permit expires in 25 days/);
  assert.equal(tc[0].urgency, 'high', 'urgent compliance items come first');
  await api(`/compliance/permits/${A.id}`, 'PUT', { dtcmPermitNumber: 'HH-0001', dtcmClass: 'standard', permitExpiryDate: addDays(today, 60), ejariExpiryDate: addDays(today, 400) });
  const sixty = (await api('/task-centre')).filter(t => t.id.startsWith(`renew-${A.id}-`));
  assert.deepEqual(sixty.map(t => [t.detail.slice(0, 24), t.urgency]), [['DTCM holiday-home permit', 'low']], 'shown from 60 days ahead');
  assert.ok(JSON.stringify(await api('/audit-log?limit=50')).includes('property_permit'), 'permit edits are in the activity log');

  // DTCM guest registration per booking.
  const air = await book(Bp, addDays(today, 1), addDays(today, 3), { platform: 'airbnb' });
  const bdc = await book(A, today, addDays(today, 2), { guestName: 'Arriving Today' });
  const far = await book(A, addDays(today, 10), addDays(today, 12), { guestName: 'Later Guest' });
  const za = await book(Z, today, addDays(today, 2));
  assert.equal((await api(`/compliance/registrations/${air.id}`)).status, 'airbnb_verified');
  const e = await api(`/compliance/registrations/${air.id}`, 'PATCH', { status: 'pending' }, 400);
  assert.match(e.error, /never 'pending'/);
  assert.deepEqual((await api(`/compliance/registrations/${air.id}`)).options.map(o => o.value), ['airbnb_verified', 'registered', 'not_needed']);
  assert.equal((await api(`/compliance/registrations/${za.id}`)).status, 'not_needed');
  let reg = await api('/compliance/registrations');
  assert.ok(!reg.bookings.some(r => r.reservationId === za.id), 'only Dubai bookings listed');
  assert.ok(!reg.bookings.some(r => r.platform === 'airbnb' && r.status === 'pending'), 'no Airbnb booking is pending');
  assert.equal(reg.bookings.find(r => r.reservationId === bdc.id).status, 'pending');
  tc = await api('/task-centre');
  assert.ok(tc.some(t => t.id === `dtcm-${bdc.id}` && t.urgency === 'high'), 'arriving today, still pending: urgent task');
  assert.ok(!tc.some(t => t.id === `dtcm-${far.id}`), 'arrivals more than 2 days away are not tasks yet');
  assert.ok(!tc.some(t => t.id === `dtcm-${air.id}`), 'never for Airbnb');
  const saved = await api(`/compliance/registrations/${bdc.id}`, 'PATCH', { status: 'registered' });
  assert.equal(saved.status, 'registered'); assert.equal(saved.label, 'Registered'); assert.equal(saved.setByHand, true);
  assert.ok(!(await api('/task-centre')).some(t => t.id === `dtcm-${bdc.id}`), 'task gone once registered');
  const block = await book(A, addDays(today, 20), addDays(today, 22), { status: 'blocked', platform: 'direct', guestName: 'Blocked: Owner stay' });
  await api(`/compliance/registrations/${block.id}`, 'PATCH', { status: 'registered' }, 400);
  assert.ok(JSON.stringify(await api('/audit-log?limit=50')).includes('dtcmRegistration'));
  assert.equal((await import('node:fs')).readFileSync(outLog, 'utf8').trim(), '', 'nothing sent outside');
  console.log('PASS Dubai compliance: permits + 60/30/7 renewals, registration (Airbnb never pending), Tourism Dirham & VAT report + CSV, filing reminder');
} finally { child.kill('SIGTERM'); }
