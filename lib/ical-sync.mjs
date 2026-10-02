// Channel iCal import planning. Pure functions: no database or network access.
// A channel calendar only proves that dates are taken; it never supplies amounts.
const unfold = raw => String(raw || '').replace(/\r?\n[ \t]/g, '');
export function parseIcalDate(value) {
  const clean = String(value || '').replace(/;[^:]*:/g, ':').replace(/^[^:]*:/, '').trim();
  const basic = clean.replace(/[TZ]/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(basic)) return null;
  const date = `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}
const BLOCK_PATTERN = /not available|unavailable|\bclosed\b|\bblocked\b/i;
export function parseIcalEvents(raw) {
  const text = unfold(raw);
  const events = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    const get = key => { const r = new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(block); return r ? r[1].trim() : ''; };
    const uid = get('UID');
    const summary = get('SUMMARY');
    const description = get('DESCRIPTION').replace(/\\n/g, '\n');
    const status = get('STATUS').toUpperCase();
    const dtstart = parseIcalDate(get('DTSTART'));
    const dtend = parseIcalDate(get('DTEND'));
    if (!uid || !dtstart || !dtend || dtstart >= dtend || status === 'CANCELLED') continue;
    const code = (description.match(/\/details\/([A-Z0-9]{8,12})\b/) || [])[1] || null;
    events.push({ uid, summary, dtstart, dtend, code, blocked: BLOCK_PATTERN.test(summary) });
  }
  return events;
}
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const icalId = (platform, uid) => `ical:${platform}:${uid}`;
const legacyUid = r => (String(r.notes || '').match(/ical-uid:(\S+)/) || [])[1] || null;
const LABEL = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo' };
export function guestLabel(platform, event) {
  if (event.blocked) return `${LABEL[platform] || platform} blocked dates`;
  const name = String(event.summary || '').replace(/\s*-?\s*Airbnb\s*\(.*?\)/i, '').trim();
  return name && !/^reserved$/i.test(name) ? name : `${LABEL[platform] || platform} guest`;
}
/**
 * Decide what a channel feed means for one property.
 * existing: all reservations of the property (any platform), with id, platform, externalId, notes, checkIn, checkOut, status.
 * Returns { inserts, updates, flags, unchanged }. Guest stays are never deleted or auto-cancelled:
 * stays that disappear from a feed are flagged for a person to confirm. Only calendar blocks that
 * this sync itself imported are released automatically when the channel reopens those dates.
 */
export function planIcalSync({ platform, events, existing, today }) {
  const inserts = [], updates = [], flags = [];
  let unchanged = 0;
  const active = r => r.status !== 'cancelled';
  const fromThisFeed = r => String(r.externalId || '').startsWith(`ical:${platform}:`) || (r.platform === platform && !!legacyUid(r));
  const foreignMirror = r => r.status === 'blocked' && r.platform !== platform && (String(r.externalId || '').startsWith('ical:') || !!legacyUid(r));
  const claimed = new Set();
  // Airbnb reissues the UID of a "Not available" block from time to time. A block this feed imported whose UID
  // is no longer in the feed is stale and is released below, so it must not count as a clash: otherwise the
  // reissued block for the same dates is skipped as a "mirror" and the dates are left open until the next sync.
  const eventIds = e => [icalId(platform, e.uid), ...(platform === 'airbnb' && e.code ? [`airbnb:${e.code}`] : [])];
  const feedIds = new Set(events.flatMap(eventIds));
  const feedUids = new Set(events.map(e => e.uid));
  const staleBlock = r => r.status === 'blocked' && fromThisFeed(r) && !feedIds.has(r.externalId) && !feedUids.has(legacyUid(r));
  const clashes = (checkIn, checkOut, selfId) => existing.filter(r => r.id !== selfId && active(r) && !staleBlock(r) && r.checkIn < checkOut && r.checkOut > checkIn)
    .concat(inserts.filter(r => r.checkIn < checkOut && r.checkOut > checkIn));
  for (const e of events) {
    const ids = eventIds(e);
    let match = existing.find(r => !claimed.has(r.id) && (ids.includes(r.externalId) || (r.platform === platform && legacyUid(r) === e.uid)));
    let linkedByDates = false;
    // A booking typed in by hand, or imported from an Airbnb earnings CSV, for exactly these dates is the same stay: link it, never duplicate it.
    if (!match) {
      match = existing.find(r => !claimed.has(r.id) && active(r) && r.platform === platform && r.checkIn === e.dtstart && r.checkOut === e.dtend && !legacyUid(r)
        && (!r.externalId || (String(r.externalId).startsWith('airbnb:') && (!e.code || r.externalId === `airbnb:${e.code}`))));
      linkedByDates = !!match;
    }
    const externalId = platform === 'airbnb' && e.code ? `airbnb:${e.code}` : icalId(platform, e.uid);
    if (match) {
      claimed.add(match.id);
      const patch = {};
      if (!match.externalId) patch.externalId = externalId;
      if (linkedByDates) patch.notes = `${match.notes ? match.notes + ' ' : ''}ical-uid:${e.uid}`;
      if (match.status === 'cancelled') {
        if (e.blocked && fromThisFeed(match)) { if (!clashes(e.dtstart, e.dtend, match.id).length) Object.assign(patch, { status: 'blocked', checkIn: e.dtstart, checkOut: e.dtend, nights: nightsBetween(e.dtstart, e.dtend) }); }
        else flags.push({ type: 'ical_reappeared', reservationId: match.id, message: `${LABEL[platform]} still shows ${e.dtstart} → ${e.dtend}, but this stay is cancelled in YallaPMS. Check the channel.` });
      } else if (match.checkIn !== e.dtstart || match.checkOut !== e.dtend) {
        if (match.status === 'checked_out') flags.push({ type: 'ical_dates_changed', reservationId: match.id, message: `${LABEL[platform]} now shows ${e.dtstart} → ${e.dtend} for a stay already checked out (${match.checkIn} → ${match.checkOut}). Not changed automatically.` });
        else {
          Object.assign(patch, { checkIn: e.dtstart, checkOut: e.dtend, nights: nightsBetween(e.dtstart, e.dtend) });
          if (clashes(e.dtstart, e.dtend, match.id).some(r => !foreignMirror(r))) flags.push({ type: 'ical_overlap', reservationId: match.id, message: `New ${LABEL[platform]} dates ${e.dtstart} → ${e.dtend} overlap another stay or block. Check for a double booking.` });
        }
      }
      if (Object.keys(patch).length) updates.push({ id: match.id, patch, previous: { checkIn: match.checkIn, checkOut: match.checkOut } });
      else unchanged++;
      continue;
    }
    const clash = clashes(e.dtstart, e.dtend);
    // Channel "not available" blocks usually mirror stays already recorded from another channel; only import blocks on free dates.
    if (e.blocked && clash.length) { unchanged++; continue; }
    if (e.blocked && e.dtend < today) { unchanged++; continue; }
    const row = { platform, externalId, guestName: guestLabel(platform, e), checkIn: e.dtstart, checkOut: e.dtend, nights: nightsBetween(e.dtstart, e.dtend), status: e.blocked ? 'blocked' : 'confirmed', paymentStatus: 'unknown', revenue: '0', notes: `ical-uid:${e.uid} Imported from the ${LABEL[platform]} calendar; amounts are not supplied by iCal.` };
    if (clash.some(r => !foreignMirror(r))) row.flag = { type: 'ical_overlap', message: `${LABEL[platform]} booking ${e.dtstart} → ${e.dtend} overlaps an existing stay or block. Check for a double booking.` };
    inserts.push(row);
  }
  for (const r of existing) {
    if (claimed.has(r.id) || !active(r) || !fromThisFeed(r) || r.status === 'checked_out' || r.checkOut < today) continue;
    if (r.status === 'blocked') updates.push({ id: r.id, patch: { status: 'cancelled' }, previous: { checkIn: r.checkIn, checkOut: r.checkOut }, released: true });
    else flags.push({ type: 'ical_missing', reservationId: r.id, message: `${r.checkIn} → ${r.checkOut} is no longer in the ${LABEL[platform]} calendar. It may have been cancelled or moved — confirm and cancel it here if so.` });
  }
  return { inserts, updates, flags, unchanged };
}
