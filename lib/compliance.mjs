// Dubai compliance pack: permit renewals, DTCM guest registration status, the monthly Tourism Dirham and VAT
// report and the filing reminder. Pure functions: no database access, no rates of its own. Tax figures are the
// amounts already worked out on each verified booking; rates shown come only from the property's Fee settings.
import { recognizedBookings } from "./owner-statement-calc.mjs";
import { bookingCurrency, confirmationCode } from "./booking-currency.mjs";

const cents = n => Math.round(Number(n || 0) * 100);
const money = n => Number((n / 100).toFixed(2));
export const isDubai = (property) => /dubai/i.test(String(property?.city ?? ''));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Permits and renewals ──
export const EXPIRY_FIELDS = [
  { key: 'permitExpiryDate', label: 'DTCM holiday-home permit' },
  { key: 'oaNocExpiryDate', label: 'Building (OA) NOC' },
  { key: 'insuranceExpiryDate', label: 'Insurance' },
  { key: 'ejariExpiryDate', label: 'Ejari' },
];
export const REMINDER_DAYS = [60, 30, 7];
export function daysUntil(today, date) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
/** Reminder stage for an expiry date: "expired", "7", "30" or "60" (days ahead), or null when further away. */
export function renewalStage(days) {
  if (days < 0) return 'expired';
  for (const d of [...REMINDER_DAYS].reverse()) if (days <= d) return String(d);
  return null;
}
/** Every expiry within 60 days (or past) across the permits, most urgent first. */
export function renewalReminders(permits, properties, today) {
  const out = [];
  for (const p of permits || []) {
    const property = (properties || []).find(x => x.id === p.propertyId);
    if (!property || property.status === 'archived') continue;
    for (const f of EXPIRY_FIELDS) {
      const date = p[f.key];
      if (!date || !DATE.test(date)) continue;
      const days = daysUntil(today, date);
      const stage = renewalStage(days);
      if (stage) out.push({ propertyId: p.propertyId, propertyName: property.name, field: f.key, label: f.label, expiry: date, days, stage });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.propertyName.localeCompare(b.propertyName));
}
export function reminderText(r) {
  if (r.days < 0) return `${r.label} expired ${-r.days} day${-r.days === 1 ? '' : 's'} ago (${r.expiry})`;
  if (r.days === 0) return `${r.label} expires today (${r.expiry})`;
  return `${r.label} expires in ${r.days} day${r.days === 1 ? '' : 's'} (${r.expiry})`;
}

/** Clean and check a permit form. Returns { values } or { error }. */
export function validatePermit(body) {
  const text = (k) => { const v = body?.[k]; if (v == null || String(v).trim() === '') return null; return String(v).trim().slice(0, 200); };
  const values = {};
  for (const k of ['dtcmPermitNumber', 'oaNocReference', 'insuranceReference', 'ejariNumber']) values[k] = text(k);
  values.notes = body?.notes == null || String(body.notes).trim() === '' ? null : String(body.notes).trim().slice(0, 2000);
  const cls = text('dtcmClass');
  if (cls && !['standard', 'deluxe'].includes(cls.toLowerCase())) return { error: 'Class must be Standard or Deluxe' };
  values.dtcmClass = cls ? cls.toLowerCase() : null;
  for (const k of ['permitIssueDate', 'permitExpiryDate', 'oaNocExpiryDate', 'insuranceExpiryDate', 'ejariExpiryDate']) {
    const v = text(k);
    if (v && (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) return { error: `${k} must be a date (YYYY-MM-DD)` };
    values[k] = v;
  }
  if (values.permitIssueDate && values.permitExpiryDate && values.permitExpiryDate < values.permitIssueDate) return { error: 'The permit expiry date is before its issue date' };
  return { values };
}

// ── DTCM guest registration ──
export const REGISTRATION_LABEL = { not_needed: 'Not needed', airbnb_verified: 'Airbnb-verified ID', pending: 'Pending', registered: 'Registered' };
/** Statuses a booking may be given. Airbnb bookings are never "pending": Airbnb verifies the guest's ID. */
export function registrationOptions(b) {
  return b?.platform === 'airbnb' ? ['airbnb_verified', 'registered', 'not_needed'] : ['pending', 'registered', 'not_needed'];
}
/**
 * The booking's registration status: the one set by hand, else worked out (outside Dubai: not needed; Airbnb:
 * Airbnb-verified ID; other Dubai bookings: pending). Null for blocks and cancelled bookings.
 */
export function registrationStatus(b, property) {
  if (!b || ['cancelled', 'blocked'].includes(b.status)) return null;
  const stored = b.dtcmRegistration;
  if (stored && registrationOptions(b).includes(stored)) return stored;
  if (!isDubai(property)) return 'not_needed';
  return b.platform === 'airbnb' ? 'airbnb_verified' : 'pending';
}

// ── Monthly Tourism Dirham and VAT report ──
/** What Fee settings say about Tourism Dirham and VAT for a property; "rate not confirmed" when unset. */
// Confirmed only once the property's "confirmed" tick is on in Fee settings (tourismConfirmed / vatConfirmed) and a
// rate is set; until then the report says "rate not confirmed" and shows what Fee settings currently hold.
export function taxSettings(rules) {
  if (!rules) return { tourism: { confirmed: false, text: 'rate not confirmed' }, vat: { confirmed: false, text: 'rate not confirmed' } };
  const tr = Number(rules.tourismRate), vp = Number(rules.vatPercent);
  const t = !rules.tourismEnabled ? { charged: false, setting: 'not charged' } : tr > 0 ? { charged: true, rate: tr, setting: `AED ${tr} per room-night` } : null;
  const v = !rules.vatEnabled ? { charged: false, setting: 'not charged' } : vp > 0 ? { charged: true, rate: vp, setting: `${vp}% (inside the guest total)` } : null;
  const view = (x, ok) => !x ? { confirmed: false, text: 'rate not confirmed' }
    : ok ? { confirmed: true, charged: x.charged, ...(x.rate ? { rate: x.rate } : {}), text: x.setting }
    : { confirmed: false, charged: x.charged, ...(x.rate ? { rate: x.rate } : {}), text: `rate not confirmed (Fee settings: ${x.setting})` };
  return { tourism: view(t, rules.tourismConfirmed === true), vat: view(v, rules.vatConfirmed === true) };
}

/**
 * Per property (Dubai, or any property with Tourism Dirham or VAT on its bookings) for a month, bookings
 * recognised in their checkout month (the owner-statement rule). Only verified bookings carry amounts; the rest
 * are counted as not verified. Rows per currency; totals per currency, never added across currencies.
 */
export function taxReport({ properties, settings, bookings, month }) {
  const rows = [];
  for (const property of (properties || []).filter(p => p.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))) {
    const own = recognizedBookings(bookings, property.id, month);
    const verified = own.filter(b => b.financeMode === 'inclusive-v1');
    const taxed = verified.some(b => cents(b.tourismFee) || cents(b.vatAmount));
    if (!isDubai(property) && !taxed) continue;
    const rules = (settings || []).find(s => s.propertyId === property.id) || null;
    const groups = new Map();
    for (const b of verified) {
      const c = bookingCurrency(b, property);
      const g = groups.get(c) || { currency: c, bookings: 0, nights: 0, roomNights: 0, guestTotal: 0, accommodation: 0, tourismFee: 0, vat: 0, tourismRates: new Set(), vatRates: new Set() };
      g.bookings++; g.nights += Number(b.nights || 0);
      g.roomNights += Number(b.tourismRooms || 0) * Number(b.tourismNights || 0);
      g.guestTotal += cents(b.grossAmount); g.accommodation += cents(b.revenue);
      g.tourismFee += cents(b.tourismFee); g.vat += cents(b.vatAmount);
      if (cents(b.tourismFee)) g.tourismRates.add(Number(b.tourismRate)); if (cents(b.vatAmount)) g.vatRates.add(Number(b.vatRate));
      groups.set(c, g);
    }
    const currency = property.currency || 'AED';
    const figures = [...groups.values()].map(g => ({ ...g, guestTotal: money(g.guestTotal), accommodation: money(g.accommodation), tourismFee: money(g.tourismFee), vat: money(g.vat),
      tourismRates: [...g.tourismRates].sort((a, b) => a - b), vatRates: [...g.vatRates].sort((a, b) => a - b) }));
    const registration = {};
    for (const b of own) { const s = registrationStatus(b, property); if (s) registration[s] = (registration[s] || 0) + 1; }
    rows.push({ propertyId: property.id, name: property.name, unitNumber: property.unitNumber ?? null, currency, dubai: isDubai(property), settings: taxSettings(rules), figures,
      unverified: own.length - verified.length, unverifiedCodes: own.filter(b => b.financeMode !== 'inclusive-v1').map(b => confirmationCode(b.externalId) || `#${b.id}`), registration });
  }
  const totals = new Map();
  for (const r of rows) for (const f of r.figures) {
    const t = totals.get(f.currency) || { currency: f.currency, bookings: 0, nights: 0, roomNights: 0, guestTotal: 0, accommodation: 0, tourismFee: 0, vat: 0 };
    t.bookings += f.bookings; t.nights += f.nights; t.roomNights += f.roomNights;
    for (const k of ['guestTotal', 'accommodation', 'tourismFee', 'vat']) t[k] += cents(f[k]);
    totals.set(f.currency, t);
  }
  return {
    month, basis: 'Bookings that checked out in the month (the owner-statement rule); only verified guest totals carry amounts.',
    properties: rows,
    totals: [...totals.values()].map(t => ({ ...t, guestTotal: money(t.guestTotal), accommodation: money(t.accommodation), tourismFee: money(t.tourismFee), vat: money(t.vat) })).sort((a, b) => a.currency.localeCompare(b.currency)),
    unconfirmed: rows.filter(r => !r.settings.tourism.confirmed || !r.settings.vat.confirmed).map(r => r.name),
    unverified: rows.reduce((n, r) => n + r.unverified, 0),
  };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
/** CSV of the report: one line per property and currency, then totals per currency. */
export function taxReportCsv(report) {
  const head = ['Month', 'Property', 'Unit', 'Currency', 'Verified bookings', 'Nights', 'Room-nights charged', 'Guest totals', 'Accommodation (excl. VAT and Tourism Dirham)', 'Tourism Dirham', 'Tourism Dirham rate used', 'VAT', 'VAT rate used', 'Tourism Dirham setting', 'VAT setting', 'Bookings not verified (not included)'];
  const lines = [head];
  for (const r of report.properties) {
    const figs = r.figures.length ? r.figures : [{ currency: r.currency, bookings: 0, nights: 0, roomNights: 0, guestTotal: 0, accommodation: 0, tourismFee: 0, vat: 0, tourismRates: [], vatRates: [] }];
    for (const f of figs) lines.push([report.month, r.name, r.unitNumber ?? '', f.currency, f.bookings, f.nights, f.roomNights, f.guestTotal.toFixed(2), f.accommodation.toFixed(2), f.tourismFee.toFixed(2), f.tourismRates.join(' / '), f.vat.toFixed(2), f.vatRates.map(v => `${v}%`).join(' / '), r.settings.tourism.text, r.settings.vat.text, r.unverified]);
  }
  for (const t of report.totals) lines.push([report.month, `TOTAL ${t.currency}`, '', t.currency, t.bookings, t.nights, t.roomNights, t.guestTotal.toFixed(2), t.accommodation.toFixed(2), t.tourismFee.toFixed(2), '', t.vat.toFixed(2), '', '', '', '']);
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ── Filing reminder (DTCM Tourism Dirham return for last month, due on the 15th) ──
export const prevMonth = (month) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); };
/** The return still to file today, or null: last month's return, due on the 15th of this month, until it is recorded as filed. */
export function filingReminder({ today, filings, hasDubai }) {
  if (!hasDubai) return null;
  const period = prevMonth(today.slice(0, 7));
  if ((filings || []).some(f => f.kind === 'tourism_dirham' && f.period === period)) return null;
  const due = `${today.slice(0, 7)}-15`;
  const days = daysUntil(today, due);
  return { kind: 'tourism_dirham', period, due, days, overdue: days < 0 };
}
