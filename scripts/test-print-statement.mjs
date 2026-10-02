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
console.log('PASS: printable statement shows only the statement, itemised owner expenses, escaped');
