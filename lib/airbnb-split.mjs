// Full Airbnb earnings for co-host-payout properties: per booking, the total Airbnb earnings, the co-host payout
// (the owner's share, which Airbnb pays the owner directly) and the company's share, side by side, with totals per
// currency. Sources, best first: the imported Airbnb earnings file (what Airbnb paid), the reservation breakdowns,
// then the verified booking (guest paid − Airbnb fees). Each figure says whether it was paid or is expected.
// Amounts in different currencies are never added together.
const cents = v => Math.round(Number(v || 0) * 100);
const codeOf = b => (typeof b.externalId === 'string' && b.externalId.startsWith('airbnb:') ? b.externalId.slice(7) : null);

/**
 * property; rules (property_settings row); bookings (all); lines (airbnb_payout_lines, numbers); transfers map
 * code -> { destination } (optional); period { start, end } (checkout dates, inclusive).
 */
export function airbnbSplit({ property, rules, bookings = [], lines = [], period, paidTo = {} }) {
  const inPeriod = d => d && d >= period.start && d <= period.end;
  const E = new Map(), B = new Map();
  for (const l of lines) if (l.kind === 'booking' && l.confirmationCode) (l.source === 'earnings' ? E : B).set(l.confirmationCode, l);
  const own = bookings.filter(b => b.propertyId === property.id && (b.platform === 'airbnb' || codeOf(b)) && !['cancelled', 'blocked'].includes(b.status));
  const codes = new Set(own.map(codeOf).filter(Boolean));
  const fileHasCohost = own.some(b => { const c = codeOf(b); return c && (E.get(c)?.cohostPayout || B.get(c)?.cohostPayout); })
    || [...E.values(), ...B.values()].some(l => l.listing === property.name && (l.cohostPayout || /\bCo-Host payout:? -?\d/i.test(l.notes || '')));
  const settingOn = !!rules?.cohostPaidToOwner;
  if (!settingOn && !fileHasCohost) return null;

  const rows = [];
  const add = (b, code, checkIn, checkOut, guestName) => {
    const e = code ? E.get(code) : null, br = code ? B.get(code) : null;
    const verified = b && b.financeMode === 'inclusive-v1' && b.grossAmount != null && b.channelFees != null;
    let company = null, companyBasis = null, cohost = null, cohostBasis = null, source, currency;
    if (e) {
      source = 'Airbnb earnings file'; currency = e.currency; company = cents(e.amount); companyBasis = e.status === 'upcoming' ? 'upcoming' : 'paid';
      if (e.cohostPayout != null) { cohost = cents(e.cohostPayout); cohostBasis = e.cohostBasis; }
      else if (br?.cohostPayout != null && br.currency === e.currency) { cohost = cents(br.cohostPayout); cohostBasis = 'expected'; }
      else if (b?.cohostPayout != null) { cohost = cents(b.cohostPayout); cohostBasis = 'expected'; }
      else cohost = null; // on a co-host-payout listing every Airbnb booking has one; not in the files = not known
    } else if (br) {
      source = 'reservation breakdown'; currency = br.currency; company = cents(br.amount); companyBasis = 'expected';
      cohost = br.cohostPayout != null ? cents(br.cohostPayout) : b?.cohostPayout != null ? cents(b.cohostPayout) : null; cohostBasis = cohost != null ? 'expected' : null;
    } else if (verified) {
      source = 'verified booking'; currency = b.currency || property.currency || 'AED';
      if (b.cohostPayout == null) { rows.push({ reservationId: b.id, code, guestName, checkIn, checkOut, currency, known: false, reason: 'co-host payout not entered on the booking' }); return; }
      cohost = cents(b.cohostPayout); cohostBasis = 'expected';
      company = cents(b.grossAmount) - cents(b.channelFees) - cohost; companyBasis = 'expected';
    } else {
      rows.push({ reservationId: b?.id ?? null, code, guestName, checkIn, checkOut, currency: b?.currency || property.currency || 'AED', known: false, reason: 'not verified and not in the Airbnb files' });
      return;
    }
    rows.push({ reservationId: b?.id ?? null, code, guestName, checkIn, checkOut, currency, known: true, source, inYallaPMS: !!b,
      total: cohost == null ? null : (company + cohost) / 100, cohostPayout: cohost == null ? null : cohost / 100, cohostBasis: cohost ? cohostBasis : null, company: company / 100, companyBasis, companyPaidTo: paidTo[code] ?? null,
      ...(cohost == null ? { reason: "co-host payout not in the files, so the total isn't known" } : {}) });
  };
  for (const b of own) if (inPeriod(b.checkOut)) add(b, codeOf(b), b.checkIn, b.checkOut, b.guestName);
  // Airbnb payouts for this listing with no YallaPMS booking still belong to its full earnings.
  for (const l of [...E.values(), ...[...B.values()].filter(x => !E.has(x.confirmationCode))]) {
    if (codes.has(l.confirmationCode) || l.listing !== property.name || !inPeriod(l.checkOut)) continue;
    codes.add(l.confirmationCode); add(null, l.confirmationCode, l.checkIn, l.checkOut, l.guestName);
  }
  rows.sort((a, b) => (a.checkOut || '').localeCompare(b.checkOut || '') || String(a.code).localeCompare(String(b.code)));
  const totals = [];
  for (const r of rows.filter(x => x.known)) {
    let t = totals.find(x => x.currency === r.currency);
    if (!t) totals.push(t = { currency: r.currency, bookings: 0, total: 0, cohostPayout: 0, cohostPaid: 0, cohostExpected: 0, company: 0, companyPaid: 0, companyNotYet: 0, cohostUnknown: 0 });
    t.bookings++; t.company += cents(r.company);
    // A booking whose co-host payout isn't known adds to the company's share only, and is counted so the page can say so.
    if (r.cohostPayout == null) t.cohostUnknown++;
    else { t.total += cents(r.total); t.cohostPayout += cents(r.cohostPayout); if (r.cohostBasis === 'paid') t.cohostPaid += cents(r.cohostPayout); else t.cohostExpected += cents(r.cohostPayout); }
    if (r.companyBasis === 'paid') t.companyPaid += cents(r.company); else t.companyNotYet += cents(r.company);
  }
  for (const t of totals) for (const k of ['total', 'cohostPayout', 'cohostPaid', 'cohostExpected', 'company', 'companyPaid', 'companyNotYet']) t[k] /= 100;
  totals.sort((a, b) => a.currency.localeCompare(b.currency));
  return { settingOn, fileHasCohost, rows, totals, withoutFigures: rows.filter(r => !r.known).length };
}

/** Totals per currency over several properties' splits. */
export function addSplitTotals(splits) {
  const out = [];
  for (const s of splits) for (const t of s?.totals ?? []) {
    let o = out.find(x => x.currency === t.currency);
    if (!o) out.push(o = { currency: t.currency, properties: 0, bookings: 0, total: 0, cohostPayout: 0, cohostPaid: 0, cohostExpected: 0, company: 0, companyPaid: 0, companyNotYet: 0, cohostUnknown: 0 });
    o.properties++;
    for (const k of ['bookings', 'cohostUnknown', 'total', 'cohostPayout', 'cohostPaid', 'cohostExpected', 'company', 'companyPaid', 'companyNotYet']) o[k] = ['bookings', 'cohostUnknown'].includes(k) ? o[k] + t[k] : (cents(o[k]) + cents(t[k])) / 100;
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}
