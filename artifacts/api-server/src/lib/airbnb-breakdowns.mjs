// Airbnb reservation breakdowns (one row per reservation, read from Airbnb's reservation details page).
// Pure parsing: blanks stay null (never 0); amounts must be plain decimals with up to two places.
import { parseCsv } from './airbnb-import.mjs';

const withSuggestion = (c, otherFees) => ({ ...c, suggested: cohostSuggestion(c, otherFees) });

export const BREAKDOWN_COLUMNS = ['confirmation_code', 'check_in', 'checkout', 'guest_paid_total', 'cleaning_fee', 'host_payout', 'currency', 'notes'];

/** "1,234.50" / "-12.30" / "" → "1234.50" / "-12.30" / null; anything else is an error. */
export function money(value, label, errors) {
  const v = String(value ?? '').trim().replace(/,/g, '');
  if (v === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) { errors.push(`${label} is not an amount ("${String(value).trim()}")`); return null; }
  return (Math.round(Number(v) * 100) / 100).toFixed(2);
}

/**
 * Co-host payout from the free-text notes. Returns { mentioned, amount } where amount is the positive
 * amount as text, or null when a co-host payout is mentioned without exactly one amount next to it.
 */
export function cohostFromNotes(notes) {
  const parts = String(notes ?? '').split(/;|\.(?!\d)/).filter(p => /co-?host/i.test(p));
  if (!parts.length) return { mentioned: false, amount: null };
  const amounts = parts.flatMap(p => p.match(/-?\d[\d,]*(?:\.\d{1,2})?/g) ?? []);
  if (amounts.length !== 1) return { mentioned: true, amount: null };
  return { mentioned: true, amount: Math.abs(Number(amounts[0].replace(/,/g, ''))).toFixed(2) };
}

/**
 * When the notes mention a co-host payout without an amount but other_fees holds exactly one amount, that
 * amount is offered as a suggestion (to be checked by a person; never applied in bulk).
 */
export function cohostSuggestion(cohost, otherFees) {
  if (!cohost.mentioned || cohost.amount != null) return null;
  const amounts = String(otherFees ?? '').match(/-?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  if (amounts.length !== 1) return null;
  const n = Math.abs(Number(amounts[0].replace(/,/g, '')));
  return n > 0 ? n.toFixed(2) : null;
}

/**
 * Co-host payout for a row: the verified cohost_payout column first (source "column"), else the notes
 * (source "notes"), else a suggestion from other_fees (to be checked; never applied in bulk).
 */
export function cohostFor(r, errors) {
  const to = String(r.cohost_payout_to ?? '').trim() || null;
  const col = money(r.cohost_payout, 'Co-host payout', errors);
  if (col != null) {
    if (Number(col) < 0) { errors.push('Co-host payout cannot be negative'); return { mentioned: true, amount: null, source: null, suggested: null, to }; }
    return { mentioned: true, amount: col, source: 'column', suggested: null, to };
  }
  const n = cohostFromNotes(r.notes);
  return { ...withSuggestion(n, r.other_fees), source: n.amount != null ? 'notes' : null, to };
}

/** The channel's actual fees (guest service fee + host service fee); null unless both are given. */
export function channelFeesOf(guestServiceFee, hostServiceFee) {
  if (guestServiceFee == null || hostServiceFee == null) return null;
  return ((Math.round(Number(guestServiceFee) * 100) + Math.round(Number(hostServiceFee) * 100)) / 100).toFixed(2);
}

/**
 * Net payout check: guest total minus the channel's fees should equal what Airbnb paid out (co-host payout +
 * host payout). 'match', 'rounding' (0.05 or less), 'differs', or 'none' when a figure is missing.
 */
export function netPayoutCheck({ guestTotal, channelFees, hostPayout, cohostAmount }) {
  if (guestTotal == null || channelFees == null || hostPayout == null) return { check: 'none', netPayout: null, paidOut: null };
  const net = Math.round(Number(guestTotal) * 100) - Math.round(Number(channelFees) * 100);
  const paid = Math.round(Number(hostPayout) * 100) + (cohostAmount != null ? Math.round(Number(cohostAmount) * 100) : 0);
  const diff = Math.abs(net - paid);
  return { check: diff === 0 ? 'match' : diff <= PAYOUT_ROUNDING * 100 ? 'rounding' : 'differs', netPayout: (net / 100).toFixed(2), paidOut: (paid / 100).toFixed(2) };
}

/** Payout differences of 0.05 or less (same currency) are rounding, e.g. 325.74 vs 325.75. */
export const PAYOUT_ROUNDING = 0.05;
export function payoutComparison(filePayout, storedPayout) {
  if (filePayout == null || storedPayout == null) return 'none';
  const diff = Math.abs(Math.round(Number(filePayout) * 100) - Math.round(Number(storedPayout) * 100));
  return diff === 0 ? 'match' : diff <= PAYOUT_ROUNDING * 100 ? 'rounding' : 'differs';
}

export function parseBreakdowns(text) {
  const rows = parseCsv(String(text ?? ''));
  if (!rows.length) throw new Error('The file has no rows');
  const missing = BREAKDOWN_COLUMNS.filter(c => !(c in rows[0]));
  if (missing.length) throw new Error(`Not an Airbnb breakdowns file: missing ${missing.join(', ')}`);
  if (rows.length > 2000) throw new Error('Please split files larger than 2,000 rows');
  return rows.map((r, i) => {
    const errors = [];
    const code = String(r.confirmation_code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(code)) errors.push('Missing or invalid confirmation code');
    const date = k => { const v = String(r[k] ?? '').trim(); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${k} is not a date`); return v || null; };
    const currency = String(r.currency ?? '').trim().toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push('Invalid currency');
    const guestTotal = money(r.guest_paid_total, 'Guest paid total', errors);
    const cleaningFee = money(r.cleaning_fee, 'Cleaning fee', errors);
    const hostPayout = money(r.host_payout, 'Host payout', errors);
    if (guestTotal != null && Number(guestTotal) <= 0) errors.push('Guest paid total must be above 0');
    if (cleaningFee != null && Number(cleaningFee) < 0) errors.push('Cleaning fee cannot be negative');
    const guestServiceFee = money(r.guest_service_fee, 'Guest service fee', errors), hostServiceFee = money(r.host_service_fee, 'Host service fee', errors);
    const channelFees = channelFeesOf(guestServiceFee, hostServiceFee);
    if (channelFees != null && Number(channelFees) < 0) errors.push('Channel fees cannot be negative');
    const cohost = cohostFor(r, errors);
    return { line: i + 2, code, listing: r.listing_name ?? null, guestName: r.guest_name ?? null, checkIn: date('check_in'), checkOut: date('checkout'), currency,
      guestTotal, cleaningFee, hostPayout, guestServiceFee, hostServiceFee, channelFees,
      otherFees: String(r.other_fees ?? '').trim() || null, notes: String(r.notes ?? '').trim() || null, cohost,
      net: netPayoutCheck({ guestTotal, channelFees, hostPayout, cohostAmount: cohost.amount }), errors };
  });
}
