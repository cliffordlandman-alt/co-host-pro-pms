// Printable owner statement: only the statement, itemised owner expenses, escaped text.
import assert from 'node:assert/strict';
import { statementHtml } from '../artifacts/yallastay/src/lib/print-statement.ts';
const stmt = { propertyName: 'Sea <View> 1BR', ownerName: 'A & B Owner', month: '2026-09', currency: 'AED', status: 'draft', bookingsCount: 1, nightsOccupied: 31,
  grossRevenue: 9000, platformFees: 248.57, managementFee: 1657.14, cleaningCosts: 0, maintenanceCosts: 0, otherExpenses: 320, tourismFee: 300, vatAmount: 414.29, ownerPayout: 6060,
  bookingDetails: JSON.stringify([{ guestName: 'Harry <script>', checkIn: '2026-08-15', checkOut: '2026-09-15', platform: 'airbnb', grossAmount: '9000.00', ownerAmount: '6380.00' }]) };
const html = statementHtml(stmt, [{ date: '2026-09-20', description: 'AC repair', category: 'Maintenance', amount: 200, currency: 'AED' }, { date: '2026-09-22', description: 'Towels', category: 'Supplies', amount: 120, currency: 'AED' }]);
assert.match(html, /Sea &lt;View&gt; 1BR/); assert.match(html, /A &amp; B Owner/); assert.doesNotMatch(html, /<script>/);
assert.match(html, /September 2026/); assert.match(html, /AC repair \(Maintenance\)/); assert.match(html, /Towels \(Supplies\)/);
assert.match(html, /Expenses charged to owner<\/td><td class="r">− AED 320\.00/); assert.match(html, /Owner payout<\/td><td class="r">AED 6,060\.00/);
assert.match(html, /Harry &lt;script&gt;/);
// Co-host payout paid to the owner directly by Airbnb: owner share, already paid, then the balance; a negative
// balance reads "Owner owes company" with a positive amount (never a bare negative).
const co = { ...stmt, otherExpenses: 0, ownerPayout: 354.82, paidByAirbnb: 4328.32,
  bookingDetails: JSON.stringify([{ guestName: 'G', checkIn: '2026-09-01', checkOut: '2026-09-03', platform: 'airbnb', grossAmount: '2730.00', ownerAmount: '2102.10', cohostPayout: '1942.83' }]) };
const h2 = statementHtml(co, []);
assert.match(h2, /Owner share<\/td><td class="r">AED 4,683\.14/); assert.match(h2, /Already paid to owner by Airbnb \(co-host payout\)<\/td><td class="r">− AED 4,328\.32/);
assert.match(h2, /Balance due to owner<\/td><td class="r">AED 354\.82/); assert.match(h2, /Paid by Airbnb<\/th>/); assert.match(h2, /AED 1,942\.83/);
const h3 = statementHtml({ ...co, ownerPayout: -120.5 }, []);
assert.match(h3, /Owner owes company<\/td><td class="r">AED 120\.50/); assert.doesNotMatch(h3, /AED -120/);
assert.match(statementHtml({ ...stmt, ownerPayout: -5 }, []), /Owner owes company<\/td><td class="r">AED 5\.00/);
console.log('PASS: printable statement shows only the statement, itemised owner expenses, escaped; co-host payout already paid by Airbnb and "Owner owes company"');
