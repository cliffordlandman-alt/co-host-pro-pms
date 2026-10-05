import assert from 'node:assert/strict';
import { parseIcalEvents, planIcalSync } from '../lib/ical-sync.mjs';
const ics = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map(e => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${e.s}\r\nDTEND;VALUE=DATE:${e.e}\r\nUID:${e.uid}\r\nSUMMARY:${e.sum}\r\n${e.desc ? `DESCRIPTION:${e.desc}\r\n` : ''}${e.status ? `STATUS:${e.status}\r\n` : ''}END:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
const events = parseIcalEvents(ics(
  { s: '20261010', e: '20261013', uid: 'a1@airbnb.com', sum: 'Reserved', desc: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC12345\\nPhone Number (Last 4 Digits): 1234' },
  { s: '20261020', e: '20261025', uid: 'b1@airbnb.com', sum: 'Airbnb (Not available)' },
  { s: '20261101', e: '20261101', uid: 'bad@airbnb.com', sum: 'Reserved' },
  { s: '20261105', e: '20261107', uid: 'x@airbnb.com', sum: 'Reserved', status: 'CANCELLED' }));
assert.equal(events.length, 2, 'zero-night and cancelled events are ignored');
assert.equal(events[0].code, 'HMABC12345'); assert.equal(events[0].blocked, false); assert.equal(events[1].blocked, true);
const today = '2026-10-01';
// Fresh feed: guest stay imported with the Airbnb confirmation code, "Not available" imported as a block (not a fake guest), no amounts invented.
let plan = planIcalSync({ platform: 'airbnb', events, existing: [], today });
assert.equal(plan.inserts.length, 2);
assert.equal(plan.inserts[0].externalId, 'airbnb:HMABC12345'); assert.equal(plan.inserts[0].status, 'confirmed'); assert.equal(plan.inserts[0].paymentStatus, 'unknown'); assert.equal(plan.inserts[0].guestName, 'Airbnb guest');
assert.equal(plan.inserts[1].status, 'blocked'); assert.match(plan.inserts[1].guestName, /blocked/);
// Re-sync is idempotent.
const saved = plan.inserts.map((r, i) => ({ ...r, id: i + 1 }));
plan = planIcalSync({ platform: 'airbnb', events, existing: saved, today });
assert.equal(plan.inserts.length, 0); assert.equal(plan.updates.length, 0); assert.equal(plan.flags.length, 0); assert.equal(plan.unchanged, 2);
// Guest changes dates on Airbnb: same stay is moved, not duplicated.
const moved = parseIcalEvents(ics({ s: '20261011', e: '20261014', uid: 'a1@airbnb.com', sum: 'Reserved', desc: 'details/HMABC12345' }, { s: '20261020', e: '20261025', uid: 'b1@airbnb.com', sum: 'Airbnb (Not available)' }));
plan = planIcalSync({ platform: 'airbnb', events: moved, existing: saved, today });
assert.equal(plan.inserts.length, 0); assert.deepEqual(plan.updates[0].patch, { checkIn: '2026-10-11', checkOut: '2026-10-14', nights: 3 });
// Stay disappears from the feed: flagged for a person, never auto-cancelled. A block that disappears is released.
plan = planIcalSync({ platform: 'airbnb', events: [], existing: saved, today });
assert.equal(plan.flags.length, 1); assert.equal(plan.flags[0].type, 'ical_missing'); assert.equal(plan.flags[0].reservationId, 1);
assert.equal(plan.updates.length, 1); assert.equal(plan.updates[0].id, 2); assert.equal(plan.updates[0].patch.status, 'cancelled');
// Airbnb reissues a "Not available" UID: the new block replaces the stale one in the same sync (no open gap), unflagged.
const stale = [{ id: 20, platform: 'airbnb', externalId: 'ical:airbnb:old-na@airbnb.com', notes: 'ical-uid:old-na@airbnb.com', checkIn: '2026-09-29', checkOut: '2027-02-01', status: 'blocked' }];
const reissued = parseIcalEvents(ics({ s: '20260930', e: '20270201', uid: 'new-na@airbnb.com', sum: 'Airbnb (Not available)' }));
plan = planIcalSync({ platform: 'airbnb', events: reissued, existing: stale, today });
assert.equal(plan.inserts.length, 1, 'reissued block imported'); assert.equal(plan.inserts[0].externalId, 'ical:airbnb:new-na@airbnb.com');
assert.equal(plan.inserts[0].checkIn, '2026-09-30'); assert.equal(plan.inserts[0].status, 'blocked'); assert.equal(plan.inserts[0].flag, undefined);
assert.equal(plan.updates.length, 1); assert.equal(plan.updates[0].id, 20); assert.equal(plan.updates[0].released, true);
// A block still in the feed is not stale: a second, overlapping new block is still treated as a mirror.
plan = planIcalSync({ platform: 'airbnb', events: [...reissued, ...parseIcalEvents(ics({ s: '20261001', e: '20261005', uid: 'other-na@airbnb.com', sum: 'Airbnb (Not available)' }))], existing: [{ ...stale[0], externalId: 'ical:airbnb:new-na@airbnb.com', notes: null, checkIn: '2026-09-30' }], today });
assert.equal(plan.inserts.length, 0); assert.equal(plan.updates.length, 0);
// A stale block never hides a guest stay's real clash with another source: a manual booking still blocks the mirror.
plan = planIcalSync({ platform: 'airbnb', events: reissued, existing: [...stale, { id: 21, platform: 'direct', externalId: null, notes: null, checkIn: '2026-10-10', checkOut: '2026-10-20', status: 'confirmed' }], today });
assert.equal(plan.inserts.length, 0, 'block overlapping a direct stay is a mirror, not imported'); assert.equal(plan.updates[0].released, true);
// Legacy rows (UID kept in notes) are recognised; old "same check-in date" skipping no longer hides a genuinely new booking.
const legacy = [{ id: 7, platform: 'airbnb', externalId: null, notes: 'ical-uid:a1@airbnb.com', checkIn: '2026-10-10', checkOut: '2026-10-13', status: 'confirmed' }];
plan = planIcalSync({ platform: 'airbnb', events: [events[0]], existing: legacy, today });
assert.equal(plan.inserts.length, 0); assert.equal(plan.updates[0].patch.externalId, 'airbnb:HMABC12345');
// A manually typed or CSV-imported booking for the same dates is linked, not duplicated.
const manual = [{ id: 9, platform: 'airbnb', externalId: 'airbnb:HMABC12345', notes: null, checkIn: '2026-10-10', checkOut: '2026-10-13', status: 'confirmed' }];
plan = planIcalSync({ platform: 'airbnb', events: [events[0]], existing: manual, today });
assert.equal(plan.inserts.length, 0);
const typed = [{ id: 10, platform: 'booking_com', externalId: null, notes: null, checkIn: '2026-10-10', checkOut: '2026-10-13', status: 'confirmed' }];
const bEvents = parseIcalEvents(ics({ s: '20261010', e: '20261013', uid: 'bk1', sum: 'CLOSED - Not available' }, { s: '20261015', e: '20261018', uid: 'bk2', sum: 'John Smith' }));
plan = planIcalSync({ platform: 'booking_com', events: bEvents, existing: typed, today });
// The Booking.com "closed" block on dates that are already occupied is a mirror and is not imported; the new guest booking is.
assert.equal(plan.inserts.length, 1); assert.equal(plan.inserts[0].guestName, 'John Smith'); assert.equal(plan.inserts[0].externalId, 'ical:booking_com:bk2');
// Double booking across channels is recorded (it is real on the channel) and flagged.
const clash = parseIcalEvents(ics({ s: '20261011', e: '20261012', uid: 'bk3', sum: 'Jane Roe' }));
plan = planIcalSync({ platform: 'booking_com', events: clash, existing: typed, today });
assert.equal(plan.inserts.length, 1); assert.equal(plan.inserts[0].flag.type, 'ical_overlap');
// Checked-out stays are never moved automatically.
plan = planIcalSync({ platform: 'airbnb', events: moved, existing: [{ ...saved[0], status: 'checked_out' }, saved[1]], today });
assert.equal(plan.updates.length, 0); assert.equal(plan.flags[0].type, 'ical_dates_changed');
console.log('PASS: iCal parsing, block detection, idempotent re-sync, date changes, missing-stay flags, block release, legacy UID and manual/CSV linking, double-booking flags, checked-out protection');
