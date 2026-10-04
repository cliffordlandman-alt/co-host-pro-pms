// Outbound calendar (iCal export) and incoming-feed health. Pure functions: no database or network access.
//
// What a channel sees: one all-day "Not available" event per stay or block. No guest names, amounts or notes.
// Own events (platform "direct": manual blocks, owner stays, direct and manual bookings) are always included.
// Channel bookings (Airbnb, Booking.com, Vrbo, Expedia ...) are included only when the property's
// "include other channels" switch is on, and never in the feed meant for the channel they came from (no echo).
export const EXPORT_TARGETS = ['airbnb', 'booking_com', 'vrbo', 'all'];
export const TARGET_LABEL = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', all: 'Any other calendar' };
export const FAILING_ALERT_MS = 2 * 60 * 60 * 1000;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CHANNEL_LABEL = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', expedia: 'Expedia' };

export const isOwnEvent = (r) => (r?.platform || 'direct') === 'direct';

/** Rows that go into the feed for `target`, oldest first. `today` is the Dubai date (YYYY-MM-DD). */
export function exportRows(reservations, { includeChannelBookings = false, target = 'all', today }) {
  return reservations
    .filter(r => r.status !== 'cancelled' && r.checkOut > r.checkIn && r.checkOut >= today)
    .filter(r => isOwnEvent(r) || (includeChannelBookings && r.platform !== target))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id - b.id);
}

/** What kind of event a row is, for the in-app check (never put in the feed itself). */
export function eventKind(r) {
  if (!isOwnEvent(r)) return 'channel';
  return r.status === 'blocked' ? 'block' : 'direct';
}

export function summarizeRows(rows) {
  const s = { total: rows.length, blocks: 0, direct: 0, channel: 0, byChannel: {} };
  for (const r of rows) {
    const k = eventKind(r); s[k === 'block' ? 'blocks' : k]++;
    if (k === 'channel') { const l = CHANNEL_LABEL[r.platform] || r.platform; s.byChannel[l] = (s.byChannel[l] || 0) + 1; }
  }
  return s;
}

const icalDate = (d) => d.replace(/-/g, '');
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** RFC 5545 calendar text (CRLF line endings). Check-out is the exclusive end date, as channels expect. */
export function buildIcal(rows, { now = new Date(), calendarName = 'YallaPMS' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YallaStay//YallaPMS//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${String(calendarName).replace(/[\r\n,;\\]/g, ' ')}`];
  for (const r of rows) {
    lines.push('BEGIN:VEVENT', `UID:yallapms-${r.id}@yallastay`, `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${icalDate(r.checkIn)}`, `DTEND;VALUE=DATE:${icalDate(r.checkOut)}`,
      'SUMMARY:Not available', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Public path of a property's export for one channel (the token is the only secret in it). */
export const exportPath = (token, target) => `/api/ical/${token}/${target}.ics`;

/**
 * Health of one incoming feed. `row` is a channel_sync_health row (or undefined), `configured` whether the
 * property has that channel's calendar link. States: not_connected, never (link saved, no sync yet), ok,
 * failing (last attempt failed, under 2 hours), alert (failing for more than 2 hours), stale (no sync for 2 hours).
 */
export function feedState(row, configured, now = new Date()) {
  if (!configured) return 'not_connected';
  if (!row || !row.lastAttemptAt) return 'never';
  const t = (v) => (v ? new Date(v).getTime() : null);
  if (row.failingSince) return now.getTime() - t(row.failingSince) > FAILING_ALERT_MS ? 'alert' : 'failing';
  if (row.lastSuccessAt && now.getTime() - t(row.lastSuccessAt) > FAILING_ALERT_MS) return 'stale';
  return 'ok';
}

/** Should the in-app alert be raised now for this failing feed? (once per run of failures) */
export function needsFailingAlert(row, now = new Date()) {
  if (!row?.failingSince) return false;
  if (now.getTime() - new Date(row.failingSince).getTime() <= FAILING_ALERT_MS) return false;
  return !row.alertedAt || new Date(row.alertedAt) < new Date(row.failingSince);
}
