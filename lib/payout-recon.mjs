// Airbnb payout check: reads the two Airbnb payout files (the earnings file, cohost_earnings.csv, and the
// reservation breakdowns, reservation_breakdowns.csv), matches every payout to a YallaPMS booking by confirmation
// code, and flags payouts with no booking, amounts that don't agree, bookings with no payout and transfers that
// can't be tied to bookings. Amounts in different currencies are never added together. The only conversion used
// is the UAE dirham's fixed peg to the US dollar (AED 3.6725 = USD 1), to check a USD transfer against AED payouts.
import { createHash } from 'node:crypto';

export const AED_PER_USD = 3.6725;
const cents = v => Math.round(Number(v) * 100);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('The file has an unfinished quoted field');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim());
  return { headers, rows: rows.filter(r => r.some(v => v.trim())).map((r, i) => { if (r.length !== headers.length) throw new Error(`Row ${i + 2} has ${r.length} columns, the header has ${headers.length}`); return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()])); }) };
}
function amount(v, what, line) {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Row ${line}: ${what} "${v}" is not an amount`);
  return Number(s);
}
const optAmount = (v, what, line) => (String(v ?? '').trim() === '' ? null : amount(v, what, line));
const tidy = s => String(s || '').replace(/[\u200b-\u200d\u2060]/g, '').replace(/\u2024/g, '.').trim();
function date(v, what, line) { if (!DATE.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new Error(`Row ${line}: ${what} "${v}" is not a YYYY-MM-DD date`); return v; }
const optDate = (v, what, line) => (v ? date(v, what, line) : null);
const CODE = /^HM[A-Z0-9]{6,12}$/;

/** Detects the file type and returns normalised lines. */
export function parsePayoutFile(text, fileName = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a CSV file');
  const { headers, rows } = parseCsv(text);
  const has = (...h) => h.every(x => headers.includes(x));
  const lines = [];
  if (has('confirmation_code', 'cohost_payout', 'cohost_payout_to', 'host_payout', 'currency', 'payout_status', 'payout_date')) {
    rows.forEach((r, i) => {
      const n = i + 2, currency = r.currency.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Row ${n}: currency "${r.currency}" is missing or not a 3-letter code`);
      const status = /^upcoming|scheduled|pending/i.test(r.payout_status) ? 'upcoming' : /^paid$/i.test(r.payout_status) ? 'paid' : null;
      if (!status) throw new Error(`Row ${n}: payout status "${r.payout_status}" must be paid or upcoming`);
      const host = amount(r.host_payout, 'host_payout', n), payoutDate = optDate(r.payout_date, 'payout_date', n), notes = tidy(r.notes);
      if (!r.confirmation_code) {
        // A payout Airbnb sent (e.g. "Transfer to PayPal ... (USD)"), not a booking.
        const reference = (notes.match(/Reference code:\s*([A-Za-z0-9]+)/) || [])[1] || null;
        const destination = (notes.match(/Transfer to\s+([^;]+?)\s*(?:;|$)/) || [])[1] || null;
        if (!payoutDate) throw new Error(`Row ${n}: a payout row needs a payout_date`);
        lines.push({ id: hash(['earnings-transfer', payoutDate, currency, cents(host), reference, destination]), source: 'earnings', kind: 'transfer', confirmationCode: null, listing: null, guestName: null, checkIn: null, checkOut: null, currency, amount: host, cohostPayout: null, cohostBasis: null, cohostTo: null, guestPaid: null, payoutDate, status, reference, destination, notes, fileName });
        return;
      }
      if (!CODE.test(r.confirmation_code)) throw new Error(`Row ${n}: "${r.confirmation_code}" is not an Airbnb confirmation code`);
      const co = optAmount(r.cohost_payout, 'cohost_payout', n);
      // A negative co-host line means Airbnb took the co-host's share out of this payout (paid to the co-host);
      // the host_payout column is then the amount before that cut. A positive one only comes from the booking
      // breakdown, so it is what the co-host should get, not a payment seen in the file.
      const received = co != null && co < 0 ? Math.round((host + co) * 100) / 100 : host;
      lines.push({ id: hash(['earnings', r.confirmation_code]), source: 'earnings', kind: 'booking', confirmationCode: r.confirmation_code, listing: r.listing_name || null, guestName: r.guest_name || null,
        checkIn: optDate(r.check_in, 'check_in', n), checkOut: optDate(r.checkout, 'checkout', n), currency, amount: received, cohostPayout: co == null ? null : Math.abs(co), cohostBasis: co == null ? null : co < 0 ? 'paid' : 'expected',
        cohostTo: tidy(r.cohost_payout_to) || null, guestPaid: null, payoutDate, status, reference: null, destination: null, notes, fileName });
    });
    if (new Set(lines.filter(l => l.kind === 'booking').map(l => l.confirmationCode)).size !== lines.filter(l => l.kind === 'booking').length) throw new Error('A confirmation code appears twice in this file; fix the file first');
    return { format: 'earnings', lines };
  }
  if (has('confirmation_code', 'guest_paid_total', 'host_service_fee', 'cohost_payout', 'host_payout', 'currency')) {
    rows.forEach((r, i) => {
      const n = i + 2, currency = r.currency.toUpperCase();
      if (!CODE.test(r.confirmation_code)) throw new Error(`Row ${n}: "${r.confirmation_code}" is not an Airbnb confirmation code`);
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Row ${n}: currency "${r.currency}" is missing or not a 3-letter code`);
      const host = optAmount(r.host_payout, 'host_payout', n);
      if (host == null) return; // no amount on the breakdown: nothing to check against
      const co = optAmount(r.cohost_payout, 'cohost_payout', n);
      lines.push({ id: hash(['breakdown', r.confirmation_code]), source: 'breakdown', kind: 'booking', confirmationCode: r.confirmation_code, listing: r.listing_name || null, guestName: r.guest_name || null,
        checkIn: optDate(r.check_in, 'check_in', n), checkOut: optDate(r.checkout, 'checkout', n), currency, amount: host, cohostPayout: co == null || co === 0 ? null : Math.abs(co), cohostBasis: co == null || co === 0 ? null : 'expected',
        cohostTo: tidy(r.cohost_payout_to) || null, guestPaid: optAmount(r.guest_paid_total, 'guest_paid_total', n), payoutDate: optDate(r.payout_date, 'payout_date', n), status: /cancel/i.test(r.status || '') ? 'cancelled' : 'breakdown', reference: null, destination: null, notes: tidy(r.notes), fileName });
    });
    if (new Set(lines.map(l => l.confirmationCode)).size !== lines.length) throw new Error('A confirmation code appears twice in this file; fix the file first');
    return { format: 'breakdown', lines };
  }
  throw new Error('This file is not an Airbnb payout file Co-Host Pro can read. Use the earnings file (columns confirmation_code, cohost_payout, cohost_payout_to, host_payout, currency, payout_status, payout_date) or the reservation breakdowns (confirmation_code, guest_paid_total, host_service_fee, cohost_payout, host_payout, currency).');
}

const r2 = n => Math.round(n * 100) / 100;
const fmt = (n, c) => `${c} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * lines: stored payout lines; bookings: reservations (id, externalId, propertyId, guestName, checkIn, checkOut,
 * platform, status, currency, financeMode, grossAmount, channelFees, cohostPayout); properties: id, name, currency.
 */
export function reconcilePayouts({ lines = [], bookings = [], properties = [], today }) {
  const prop = id => properties.find(p => p.id === id);
  const byCode = new Map();
  for (const b of bookings) if (typeof b.externalId === 'string' && b.externalId.startsWith('airbnb:')) byCode.set(b.externalId.slice(7), b);
  const E = new Map(lines.filter(l => l.source === 'earnings' && l.kind === 'booking').map(l => [l.confirmationCode, l]));
  const B = new Map(lines.filter(l => l.source === 'breakdown').map(l => [l.confirmationCode, l]));
  const transfersIn = lines.filter(l => l.kind === 'transfer').sort((a, b) => a.payoutDate.localeCompare(b.payoutDate) || a.id.localeCompare(b.id));
  const codes = [...new Set([...E.keys(), ...B.keys()])];
  const eDates = [...E.values()].map(l => l.checkIn).filter(Boolean).sort();
  const window = eDates.length ? { from: eDates[0], to: eDates.at(-1) } : null;

  // Transfers: tie each one to the payouts it carried.
  const link = new Map(); // earnings code -> transfer id
  const transfers = transfersIn.map(t => ({ id: t.id, date: t.payoutDate, currency: t.currency, amount: Number(t.amount), reference: t.reference, destination: t.destination, status: t.status, codes: [], check: null, state: 'unmatched' }));
  const pool = [...E.values()].filter(l => l.status === 'paid' && Number(l.amount) > 0 && l.payoutDate);
  const free = l => !link.has(l.confirmationCode);
  for (const t of transfers) { // 1. same currency, same amount, paid on or up to 14 days before the transfer
    const c = pool.filter(l => free(l) && l.currency === t.currency && cents(l.amount) === cents(t.amount) && l.payoutDate <= t.date && l.payoutDate >= addDays(t.date, -14)).sort((a, b) => b.payoutDate.localeCompare(a.payoutDate))[0];
    if (c) { link.set(c.confirmationCode, t.id); t.codes.push(c.confirmationCode); t.state = 'matched'; t.check = `Same amount as booking ${c.confirmationCode}`; }
  }
  const dates = [...new Set(transfers.filter(t => !t.codes.length).map(t => t.date))];
  for (const d of dates) {
    const ts = transfers.filter(t => !t.codes.length && t.date === d);
    for (const t of ts) if (t.currency === 'USD') { // 2. a USD transfer for one AED payout, at the fixed peg
      const c = pool.find(l => free(l) && l.payoutDate === d && l.currency === 'AED' && Math.abs(cents(Number(l.amount) / AED_PER_USD) - cents(t.amount)) <= 1);
      if (c) { link.set(c.confirmationCode, t.id); t.codes.push(c.confirmationCode); t.state = 'matched'; t.check = `${fmt(c.amount, 'AED')} at the fixed peg (3.6725) is ${fmt(t.amount, 'USD')}`; }
    }
    const rest = ts.filter(t => !t.codes.length), ls = pool.filter(l => free(l) && l.payoutDate === d && l.currency !== (rest[0]?.currency));
    if (!rest.length || !ls.length) continue;
    for (const l of ls) link.set(l.confirmationCode, rest[0].id);
    for (const t of rest) t.codes = ls.map(l => l.confirmationCode);
    const sums = {}; for (const l of ls) sums[l.currency] = (sums[l.currency] || 0) + cents(l.amount);
    const parts = Object.entries(sums).map(([c, v]) => fmt(v / 100, c)).join(' + ');
    if (rest.length === 1 && rest[0].currency === 'USD' && Object.keys(sums).length === 1 && sums.AED) {
      const usd = cents(sums.AED / 100 / AED_PER_USD), diff = cents(rest[0].amount) - usd;
      rest[0].state = Math.abs(diff) <= 1 ? 'matched' : 'mismatch';
      rest[0].check = Math.abs(diff) <= 1 ? `${parts} at the fixed peg is ${fmt(usd / 100, 'USD')}` : `${parts} at the fixed peg is ${fmt(usd / 100, 'USD')}, the transfer is ${fmt(rest[0].amount, 'USD')} (difference ${fmt(diff / 100, 'USD')})`;
    } else for (const t of rest) { t.state = 'date'; t.check = `Same payout date as ${parts}${rest.length > 1 ? ` (${rest.length} transfers that day)` : ''}. Not compared: there is no fixed ${Object.keys(sums).filter(c => c !== 'AED').join('/') || t.currency} rate.`; }
  }
  for (const t of transfers) if (!t.codes.length) t.check = 'No booking payout on this date in the imported files';

  const anyTransfers = transfers.length > 0;
  const rows = codes.map(code => {
    const e = E.get(code), b = B.get(code), bk = byCode.get(code);
    const p = bk ? prop(bk.propertyId) : properties.find(x => x.name === (e || b).listing);
    const currency = bk ? (bk.currency || p?.currency || 'AED') : null;
    const problems = [], notes = [];
    const line = e || b;
    if (!bk) problems.push('No booking in Co-Host Pro with this confirmation code');
    else if (['cancelled', 'blocked'].includes(bk.status) && e && Number(e.amount) > 0) problems.push('The booking is cancelled in Co-Host Pro but Airbnb paid out for it');
    if (bk && currency !== line.currency) problems.push(`The file is in ${line.currency}; the booking is in ${currency}`);
    if (e && b && e.currency === b.currency && cents(e.amount) !== cents(b.amount)) problems.push(`Airbnb ${e.status === 'upcoming' ? 'will pay' : 'paid'} ${fmt(e.amount, e.currency)}; the booking breakdown says ${fmt(b.amount, b.currency)} (difference ${fmt(r2(e.amount - b.amount), e.currency)})`);
    let yalla = null;
    if (bk && bk.financeMode === 'inclusive-v1' && bk.grossAmount != null && bk.channelFees != null) {
      yalla = r2(Number(bk.grossAmount) - Number(bk.channelFees) - Number(bk.cohostPayout || 0));
      const got = e || b;
      if (currency === got.currency && cents(yalla) !== cents(got.amount)) problems.push(`The verified booking works out to ${fmt(yalla, currency)} (guest paid − Airbnb fees${Number(bk.cohostPayout || 0) ? ' − co-host payout' : ''}); the ${e ? 'payout' : 'breakdown'} is ${fmt(got.amount, got.currency)}`);
    } else if (bk) notes.push('Booking not verified in Co-Host Pro, so only the files are compared');
    if (e?.cohostBasis === 'paid' && bk && bk.cohostPayout != null && cents(bk.cohostPayout) !== cents(e.cohostPayout)) problems.push(`Airbnb paid the co-host ${fmt(e.cohostPayout, e.currency)}; the booking has ${fmt(bk.cohostPayout, currency)}`);
    if (e && e.status === 'paid' && anyTransfers && Number(e.amount) > 0 && !link.has(code)) problems.push('No transfer in the file for this payout date');
    if (!e && b && b.status !== 'cancelled' && window && b.checkIn && b.checkIn >= window.from && b.checkIn <= window.to && b.checkIn < today) problems.push('In the breakdowns but not in the earnings file: no payout seen');
    const transfer = transfers.find(t => t.id === link.get(code)) || null;
    const state = problems.some(x => /^No booking/.test(x)) ? 'no_booking' : problems.length ? 'mismatch' : e?.status === 'upcoming' ? 'upcoming' : e ? 'matched' : 'breakdown_only';
    return { code, propertyId: p?.id ?? null, propertyName: p?.name ?? line.listing, reservationId: bk?.id ?? null, guestName: bk?.guestName ?? line.guestName, checkIn: line.checkIn, checkOut: line.checkOut,
      currency: line.currency, paid: e ? Number(e.amount) : null, payoutStatus: e?.status ?? null, payoutDate: e?.payoutDate ?? b?.payoutDate ?? null, breakdown: b ? Number(b.amount) : null, yalla,
      cohostPayout: e?.cohostPayout != null ? Number(e.cohostPayout) : b?.cohostPayout != null ? Number(b.cohostPayout) : null, cohostBasis: e?.cohostBasis ?? b?.cohostBasis ?? null,
      transfer: transfer ? { id: transfer.id, date: transfer.date, currency: transfer.currency, amount: transfer.amount, reference: transfer.reference, destination: transfer.destination } : null, state, problems, notes };
  });
  // Airbnb bookings in YallaPMS that the earnings file should cover but has no payout for.
  const seenProps = new Set(rows.filter(r => r.paid != null && r.propertyId).map(r => r.propertyId));
  const missing = window ? bookings.filter(b => b.platform === 'airbnb' && !['cancelled', 'blocked'].includes(b.status) && seenProps.has(b.propertyId) && b.checkIn >= window.from && b.checkIn <= window.to && b.checkIn < today
    && !E.has(String(b.externalId || '').replace(/^airbnb:/, ''))).map(b => ({ reservationId: b.id, code: String(b.externalId || '').startsWith('airbnb:') ? b.externalId.slice(7) : null, propertyId: b.propertyId, propertyName: prop(b.propertyId)?.name ?? null, guestName: b.guestName, checkIn: b.checkIn, checkOut: b.checkOut }))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn)) : [];

  const order = { no_booking: 0, mismatch: 1, upcoming: 3, matched: 4, breakdown_only: 5 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (b.payoutDate || b.checkIn || '').localeCompare(a.payoutDate || a.checkIn || ''));
  transfers.sort((a, b) => ({ unmatched: 0, mismatch: 1, date: 2, matched: 3 }[a.state] - { unmatched: 0, mismatch: 1, date: 2, matched: 3 }[b.state]) || b.date.localeCompare(a.date));
  const per = (list, keyOf, valOf) => { const m = new Map(); for (const x of list) { const k = keyOf(x); if (k == null) continue; m.set(k, (m.get(k) || 0) + cents(valOf(x))); } return [...m].map(([k, v]) => ({ key: k, amount: v / 100 })).sort((a, b) => a.key.localeCompare(b.key)); };
  const totals = {
    // Per currency and per account the payout went to (from the transfer it was tied to), never across currencies.
    paid: per(rows.filter(r => r.payoutStatus === 'paid'), r => `${r.currency}|${r.transfer?.destination || ''}`, r => r.paid).map(x => ({ currency: x.key.split('|')[0], destination: x.key.split('|').slice(1).join('|') || null, amount: x.amount })),
    upcoming: per(rows.filter(r => r.payoutStatus === 'upcoming'), r => r.currency, r => r.paid).map(x => ({ currency: x.key, amount: x.amount })),
    transfers: per(transfers, t => `${t.currency}|${t.destination || 'Unknown account'}`, t => t.amount).map(x => ({ currency: x.key.split('|')[0], destination: x.key.split('|').slice(1).join('|'), amount: x.amount })),
  };
  const counts = { matched: rows.filter(r => r.state === 'matched').length, mismatch: rows.filter(r => r.state === 'mismatch').length, noBooking: rows.filter(r => r.state === 'no_booking').length,
    upcoming: rows.filter(r => r.state === 'upcoming').length, breakdownOnly: rows.filter(r => r.state === 'breakdown_only').length, missing: missing.length,
    transfersMatched: transfers.filter(t => t.state === 'matched').length, transfersByDate: transfers.filter(t => t.state === 'date').length, transfersProblem: transfers.filter(t => ['unmatched', 'mismatch'].includes(t.state)).length };
  return { rows, missing, transfers, totals, counts, window };
}
