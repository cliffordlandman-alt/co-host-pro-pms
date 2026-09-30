// Calendar bars: one continuous bar per stay per row, name once per row, round ends only at check-in/checkout.
import assert from 'node:assert/strict';
import { layoutBars } from '../artifacts/yallastay/src/lib/calendar-bars.ts';
import { calendarBookingName, isChannelBlock } from '../artifacts/yallastay/src/lib/calendar-labels.ts';
const week = d => Array.from({ length: 7 }, (_, i) => { const x = new Date(Date.UTC(2026, 8, d + i)); return x.toISOString().slice(0, 10); });
const w3 = week(13), w4 = week(20); // Sun 13 - Sat 19 Sep, Sun 20 - Sat 26 Sep 2026
const theriza = { id: 84, checkIn: '2026-09-15', checkOut: '2026-09-18' };
let { bars, lanes } = layoutBars([theriza], w3);
assert.equal(bars.length, 1, 'one bar, not one pill per day'); assert.equal(lanes, 1);
assert.deepEqual([bars[0].roundStart, bars[0].roundEnd, bars[0].showLabel], [true, true, true]);
assert.equal(bars[0].left, 5 / 14, 'starts mid check-in day'); assert.equal(bars[0].width, 6 / 14, 'ends mid checkout day');
// A stay crossing into the next week: square end in week 1, square start + name again in week 2.
const cross = { id: 1, checkIn: '2026-09-18', checkOut: '2026-09-23' };
const a = layoutBars([cross], w3).bars[0], b = layoutBars([cross], w4).bars[0];
assert.deepEqual([a.roundStart, a.roundEnd, a.showLabel], [true, false, true]);
assert.deepEqual([b.roundStart, b.roundEnd, b.showLabel, b.left], [false, true, true, 0]);
assert.equal(a.left + a.width, 1, 'runs to the end of the week row');
// Checkout morning at the start of a week: short stub without a label (no fragments).
const stub = layoutBars([{ id: 2, checkIn: '2026-09-10', checkOut: '2026-09-13' }], w3).bars[0];
assert.deepEqual([stub.showLabel, stub.roundEnd, stub.width], [false, true, 1 / 14]);
// Same-day turnover shares a lane; a real overlap gets a second lane.
const turn = layoutBars([{ id: 3, checkIn: '2026-09-13', checkOut: '2026-09-15' }, { id: 4, checkIn: '2026-09-15', checkOut: '2026-09-17' }], w3);
assert.equal(turn.lanes, 1, 'checkout and next check-in on the same day fit in one lane');
const clash = layoutBars([{ id: 5, checkIn: '2026-09-14', checkOut: '2026-09-17' }, { id: 6, checkIn: '2026-09-15', checkOut: '2026-09-16' }], w3);
assert.equal(clash.lanes, 2);
// Outside the row or zero nights: nothing drawn.
assert.equal(layoutBars([{ id: 7, checkIn: '2026-10-01', checkOut: '2026-10-03' }, { id: 8, checkIn: '2026-09-15', checkOut: '2026-09-15' }], w3).bars.length, 0);
// Block labels: channel blocks say where they came from; manual blocks keep their own label; stays unchanged.
assert.equal(calendarBookingName({ platform: 'airbnb', status: 'blocked', guestName: 'Airbnb blocked dates' }), 'Blocked on Airbnb');
assert.equal(calendarBookingName({ platform: 'booking_com', status: 'blocked', guestName: 'Booking.com blocked dates' }), 'Blocked on Booking.com');
assert.equal(calendarBookingName({ platform: 'vrbo', status: 'blocked' }), 'Blocked on Vrbo');
assert.equal(calendarBookingName({ platform: 'some_channel', status: 'blocked' }), 'Blocked on Some channel');
assert.equal(calendarBookingName({ platform: 'direct', status: 'blocked', guestName: 'Blocked: Owner stay' }), 'Blocked: Owner stay');
assert.equal(isChannelBlock({ platform: 'direct', status: 'blocked' }), false);
assert.equal(calendarBookingName({ platform: 'airbnb', status: 'confirmed', guestName: 'Theriza Le Roux' }), 'Theriza Le Roux');
console.log('PASS: "Blocked on <channel>" labels, manual block labels kept; continuous bars, name once per row, round ends only at check-in/checkout, no fragments, lanes for overlaps');
