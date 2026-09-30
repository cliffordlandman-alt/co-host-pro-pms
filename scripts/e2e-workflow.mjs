// End-to-end booking -> owner statement workflow check for YallaPMS.
// Usage: node scripts/e2e-workflow.mjs            (spawns an isolated API on :3004 with a temp DB)
//        BASE=http://127.0.0.1:3001 EMAIL=.. PASSWORD=.. node e2e-workflow.mjs   (runs against a live server, adds demo data)
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let base = process.env.BASE, child, logs = '';
if (!base) {
  const data = await mkdtemp(path.join(tmpdir(), 'yallapms-e2e-'));
  const env = { ...process.env, NODE_ENV: 'development', PORT: '3004', LOCAL_DATA_DIR: data, MIGRATIONS_DIR: path.join(SRC, 'drizzle') };
  delete env.DATABASE_URL;
  child = spawn(process.execPath, [path.join(SRC, 'artifacts/api-server/dist/index.mjs')], { env, cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  base = 'http://127.0.0.1:3004';
}
let token;
const results = [];
const rec = (link, status, detail = '') => { results.push({ link, status, detail }); console.log(`${status.padEnd(7)} ${link}${detail ? ' — ' + detail : ''}`); };
async function api(route, method = 'GET', body, tok = token) {
  const r = await fetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, body: j };
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const tag = process.env.TAG || 'T' + String(Date.now()).slice(-5); // mixed case on purpose: emails must match case-insensitively
try {
  for (let i = 0; i < 80; i++) { try { if ((await api('/healthz')).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  if (process.env.EMAIL) token = (await api('/auth/login', 'POST', { email: process.env.EMAIL, password: process.env.PASSWORD })).body.token;
  else token = (await api('/auth/register', 'POST', { name: 'E2E Admin', email: 'e2e@example.invalid', password: 'E2E-only-6284!' })).body.token;
  if (!token) throw new Error('login failed');

  // 1. Owner + property + fee settings
  const owner = (await api('/owners', 'POST', { name: `Demo Owner ${tag}`, email: `owner${tag}@example.invalid`, phone: '+971500000001' })).body;
  const prop = await api('/properties', 'POST', { name: `Demo Marina 2BR ${tag}`, unitNumber: `D-${tag}`, building: 'Marina Heights', area: 'Dubai Marina', city: 'Dubai', country: 'UAE', currency: 'AED', bedrooms: 2, bedroomType: '2 Bedroom', ownerId: owner.id, managementFee: '20', cleaningFee: '200' });
  const property = prop.body;
  rec('1a Create owner + property with mgmt fee', prop.status === 201 && owner.id ? 'OK' : 'FAIL', `owner #${owner.id}, property #${property?.id} status ${prop.status}`);
  const settings = await api(`/accounting/settings/${property.id}`, 'PUT', { managementFeePercent: 20, platformFeeBookingCom: 15, tourismRate: 10, tourismEnabled: true, vatEnabled: true, vatPercent: 5 });
  rec('1b Property fee settings (mgmt %, channel %, tourism)', [200, 201].includes(settings.status) ? 'OK' : 'FAIL', `status ${settings.status}`);

  // 2. Reservation with financials (Booking.com, 3 nights, AED 3,300 guest total incl. VAT + Tourism Dirham)
  const payload = { propertyId: property.id, guestName: `Demo Guest ${tag}`, guestEmail: `guest${tag}@example.invalid`, guestPhone: '+971500000002', platform: 'booking_com', checkIn: '2026-09-27', checkOut: '2026-09-30', status: 'confirmed', financeMode: 'inclusive-v1', grossAmount: 3300, managementPercent: 20, cleaningFee: 200, dubaiCharges: true, channelPercent: 15, paymentStatus: 'pending' };
  const resv = await api('/reservations', 'POST', payload);
  const b = resv.body;
  rec('2a Create reservation with financials', resv.status === 201 ? 'OK' : 'FAIL', resv.status === 201 ? `#${b.id} gross ${b.grossAmount}, net ${b.revenue}, VAT ${b.vatAmount}, tourism ${b.tourismFee}, channel ${b.channelAmount}, mgmt ${b.managementAmount}, cleaning ${b.cleaningFee}, owner ${b.ownerAmount}` : JSON.stringify(resv.body));
  const expect = { grossAmount: 3300, tourismFee: 60, vatAmount: 154.29, revenue: 3085.71, managementAmount: 617.14, channelAmount: 462.86, ownerAmount: 1805.71 };
  const bad = Object.entries(expect).filter(([k, v]) => !near(b[k], v));
  rec('2b Financial breakdown math', bad.length ? 'FAIL' : 'OK', bad.length ? 'mismatch ' + bad.map(([k, v]) => `${k}=${b[k]} (exp ${v})`).join(', ') : 'tourism 10x2BRx3n=60; VAT 5% extracted; mgmt 20% & channel 15% of net; owner = net - mgmt - channel - cleaning');
  rec('2c Nightly rate captured', b.nightlyRate != null ? 'OK' : 'GAP', b.nightlyRate != null ? String(b.nightlyRate) : 'no nightly-rate field; only an all-inclusive guest total is stored');
  const dup = await api('/reservations', 'POST', payload);
  rec('2d Double-booking rejected', dup.status === 400 ? 'OK' : 'FAIL', `status ${dup.status}`);
  const turnover = await api('/reservations', 'POST', { ...payload, guestName: 'Same-day turnover', checkIn: '2026-09-30', checkOut: '2026-10-02', grossAmount: 1500 });
  rec('2e Same-day turnover allowed (checkout day = next check-in)', turnover.status === 201 ? 'OK' : 'FAIL', `status ${turnover.status} ${turnover.status !== 201 ? JSON.stringify(turnover.body) : ''}`);
  const badAmt = await api('/reservations', 'POST', { ...payload, checkIn: '2026-12-01', checkOut: '2026-12-03', grossAmount: -5 });
  rec('2f Negative amount rejected', badAmt.status === 400 ? 'OK' : 'FAIL', `status ${badAmt.status}`);

  // 3. Calendar
  const cal = (await api(`/reservations?propertyId=${property.id}`)).body;
  rec('3 Calendar/availability sees booking', Array.isArray(cal) && cal.some(r => r.id === b.id) ? 'OK' : 'FAIL', `${cal.length} bookings for property (calendar pages read /reservations)`);

  // 4. Guest record
  const g = await api(`/reservations/${b.id}`, 'PATCH', { idCollected: true, notes: 'Passport checked at door' });
  const gd = (await api(`/reservations/${b.id}`)).body;
  const guestsApi = await api('/guests');
  rec('4 Guest record (contact, ID, notes)', g.status === 200 && gd.idCollected && gd.guestEmail ? (guestsApi.status === 200 ? 'OK' : 'PARTIAL') : 'FAIL', guestsApi.status === 200 ? 'guest table' : 'guest details stored only on each reservation row; no separate guest profile / repeat-guest history (GET /guests -> ' + guestsApi.status + ')');

  // 5. Revenue / accounting
  const tx = (await api('/accounting/transactions?month=2026-09')).body;
  const company = (await api('/accounting/company-statement?start=2026-09-01&end=2026-09-30')).body;
  const mgmtLine = company.lines?.find(l => l.id === `booking-${b.id}`);
  rec('5a Company revenue (management commission)', mgmtLine && near(mgmtLine.amount, 617.14) ? 'OK' : 'FAIL', mgmtLine ? `company statement line AED ${mgmtLine.amount} on checkout date` : JSON.stringify(company).slice(0, 200));
  rec('5b Ledger entries posted for booking', tx.some(t => t.reservationId === b.id) ? 'OK' : 'GAP', tx.some(t => t.reservationId === b.id) ? '' : 'no ledger rows; revenue/VAT/tourism/owner liability are derived on read from reservation columns, not posted');
  const dash1 = (await api('/dashboard/summary')).body;
  rec('5c Dashboard month revenue', dash1.monthRevenue > 0 ? 'OK' : 'FAIL', `monthRevenue AED ${dash1.monthRevenue} (net accommodation, excl. VAT/tourism)`);

  // 6. Owner statement (draft)
  const gen = (await api('/accounting/statements/generate', 'POST', { month: '2026-09' })).body;
  const st = gen.statements?.find(s => s.propertyId === property.id);
  rec('6 Owner statement draft', st ? (near(st.ownerPayout, 1805.71) ? 'OK' : 'FAIL') : 'FAIL', st ? `payout ${st.ownerPayout}, gross ${st.grossRevenue}, mgmt ${st.managementFee}, channel ${st.platformFees}, cleaning ${st.cleaningCosts}, bookings ${st.bookingsCount}` : JSON.stringify(gen.skipped));

  // 7. Guest message scheduling
  const templates = (await api('/templates')).body;
  const tpl = templates.find(t => t.name === 'Check-Out Reminder' && !t.propertyId);
  await api(`/templates/property-variables/${property.id}`, 'PUT', { check_in_time: '15:00', check_out_time: '11:00', utc_offset: '+04:00', host_name: 'YallaStay' });
  const wasEnabled = tpl?.enabled;
  if (tpl && !wasEnabled) await api(`/templates/${tpl.id}`, 'PATCH', { enabled: true });
  const queue = (await api('/templates/queue')).body;
  const job = queue.find(j => j.reservationId === b.id && j.templateId === tpl?.id);
  if (tpl && !wasEnabled) await api(`/templates/${tpl.id}`, 'PATCH', { enabled: false });
  rec('7 Guest message scheduling', job ? 'PARTIAL' : 'FAIL', job ? `queue item scheduled ${job.scheduledAt} (${job.status || ''}); preview only — no sending, no sent-history` : `${templates.length} templates, no queue item`);

  // 8. Payment
  const pay = await api('/payments', 'POST', { type: 'guest_payment', reservationId: b.id, amount: 3300, status: 'paid' });
  const afterPay = (await api(`/reservations/${b.id}`)).body;
  rec('8 Guest payment recorded', pay.status === 201 && afterPay.paymentStatus === 'paid' ? 'OK' : 'FAIL', `balance ${afterPay.balanceDue}, status ${afterPay.paymentStatus}`);

  // 9. Check-in / checkout
  const ci = await api(`/reservations/${b.id}`, 'PATCH', { status: 'checked_in' });
  const co = await api(`/reservations/${b.id}`, 'PATCH', { status: 'checked_out' });
  rec('9 Check-in / checkout status', ci.status === 200 && co.status === 200 ? 'OK' : 'FAIL', `${ci.status}/${co.status} ${co.status !== 200 ? JSON.stringify(co.body) : ''}`);

  // 10. Cleaning task
  let task = (await api('/cleaning')).body.find(t => t.reservationId === b.id);
  rec('10 Cleaning task created for checkout', task ? 'OK' : 'FAIL', task ? `task #${task.id} status '${task.status}' on ${task.scheduledDate} ${task.scheduledTime}, price ${task.price} (created at booking time, not at checkout)` : '');

  // 11. Assign cleaner, cleaner works it, manager inspects
  const cleanerEmail = `cleaner${tag}@example.invalid`;
  await api('/users', 'POST', { name: `Demo Cleaner ${tag}`, email: cleanerEmail, password: 'Clean-only-6284!', role: 'cleaner' });
  const staff = (await api('/staff', 'POST', { name: `Demo Cleaner ${tag}`, email: cleanerEmail, role: 'cleaner', active: true })).body;
  const assign = await api(`/cleaning/${task.id}`, 'PATCH', { assignedToId: staff.id, status: 'scheduled' });
  const ctok = (await api('/auth/login', 'POST', { email: cleanerEmail, password: 'Clean-only-6284!' })).body.token;
  const mine = (await api('/cleaning', 'GET', undefined, ctok)).body;
  const s1 = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'in_progress' }, ctok);
  const s2 = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'completed', photos: ['data:image/png;base64,iVBORw0KGgo='], notes: 'Done, towels replaced' }, ctok);
  const s3 = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'approved' });
  rec('11 Assign -> cleaner in progress -> completed -> inspected', assign.status === 200 && mine.length === 1 && s1.status === 200 && s2.status === 200 && s3.status === 200 ? 'OK' : 'FAIL', `assign ${assign.status}, cleaner sees ${mine.length}, in_progress ${s1.status}, completed ${s2.status}, approved ${s3.status}`);
  // Guards: a cleaner cannot change an approved clean; approval needs a completed clean;
  // a manager may reopen an approved clean (re-clean), which must be completed again before approval.
  const cBack = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'in_progress' }, ctok);
  const reopen = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'dirty' });
  const skip = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'approved' });
  const redo = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'completed' });
  const reapprove = await api(`/cleaning/${task.id}`, 'PATCH', { status: 'approved' });
  rec('11b Cleaning status guards', cBack.status === 409 && reopen.status === 200 && skip.status === 409 && redo.status === 200 && reapprove.status === 200 ? 'OK' : 'GAP',
    `cleaner edit after approval ${cBack.status}, manager reopen ${reopen.status}, approve-without-completion ${skip.status}, complete ${redo.status}, approve ${reapprove.status}`);

  // 12. Cleaning expense recorded
  const tx2 = (await api('/accounting/transactions?month=2026-09')).body;
  const company2 = (await api('/accounting/company-statement?start=2026-09-01&end=2026-09-30')).body;
  const cleanCost = tx2.find(t => /clean/i.test(`${t.category} ${t.description}`) && (t.reservationId === b.id || t.reference === `cleaning:${task.id}`)) || company2.lines?.find(l => /clean/i.test(`${l.category} ${l.description}`) && l.type === 'expense');
  rec('12 Cleaning expense recorded on completion', cleanCost ? 'OK' : 'GAP', cleanCost ? `${cleanCost.allocation || ''} ${cleanCost.amount}` : 'nothing posted; owner statement deducts the booking cleaning fee, but the cleaner cost is never recorded as a company expense');

  // 13. Property ready
  const tc = (await api('/task-centre')).body;
  const stillOpen = tc.filter(t => t.id === `clean-${task.id}`);
  rec('13 Property ready after inspection', stillOpen.length === 0 ? 'OK' : 'FAIL', 'readiness is derived in the UI (Today dashboard) from an approved cleaning task; no stored readiness state');

  // 14. Owner statement + dashboard reflect everything
  const st2 = (await api('/accounting/statements?month=2026-09')).body.find(s => s.propertyId === property.id);
  const dash2 = (await api('/dashboard/summary')).body;
  rec('14a Owner statement after cleaning', st2 && near(st2.ownerPayout, 1805.71) ? 'OK' : 'FAIL', st2 ? `payout ${st2.ownerPayout}, cleaning ${st2.cleaningCosts} (booking fee, not actual cleaner cost)` : 'missing');
  rec('14b Dashboard reflects', dash2.todayCheckOuts >= 1 ? 'OK' : 'FAIL', `today checkouts ${dash2.todayCheckOuts}, cleaningPending ${dash2.cleaningPending}, monthRevenue ${dash2.monthRevenue}`);
  const publish = await api(`/accounting/statements/${st2.id}`, 'PATCH', { status: 'sent' });
  const paid = await api(`/accounting/statements/${st2.id}`, 'PATCH', { status: 'paid' });
  const edit = await api(`/reservations/${b.id}`, 'PATCH', { grossAmount: 3400 });
  rec('14c Publish + pay statement, then booking locked', publish.status === 200 && paid.status === 200 && edit.status === 400 ? 'OK' : 'FAIL', `sent ${publish.status}, paid ${paid.status}, later edit ${edit.status}`);
  const owed = (await api('/payments')).body.filter(p => p.type === 'owner_payout' && p.propertyId === property.id);
  rec('14d Owner payout recorded once', owed.length === 1 ? 'OK' : 'FAIL', `${owed.length} payout rows, amount ${owed[0]?.amount}`);
} catch (e) { rec('SCRIPT ERROR', 'FAIL', e.stack); console.error(logs.slice(-3000)); }
finally {
  child?.kill('SIGTERM');
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log(`\nSUMMARY: ${results.filter(r => r.status === 'OK').length} OK, ${results.filter(r => r.status === 'PARTIAL').length} PARTIAL, ${results.filter(r => r.status === 'GAP').length} GAP, ${fails} FAIL`);
  process.exitCode = fails ? 1 : 0;
}
