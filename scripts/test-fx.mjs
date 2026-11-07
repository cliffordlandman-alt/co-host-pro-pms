// Dirham conversion: peg, dated rates, and totals that add different currencies only after conversion.
import assert from 'node:assert/strict';
import { toAed, rateOn, aedPerUnitFromUsdCross, aedCents, USD_AED_PEG } from '../lib/fx.mjs';
import { financialTotals } from '../lib/reservation-financials.mjs';

const peg = aedPerUnitFromUsdCross({ ZAR: 16.5, EUR: 0.9 });
assert.equal(peg.USD, USD_AED_PEG);
assert.equal(Math.round(peg.ZAR * 10000) / 10000, Math.round((USD_AED_PEG / 16.5) * 10000) / 10000);

const book = {
  latest: { AED: 1, USD: USD_AED_PEG, ZAR: 0.2 },
  byDate: {
    '2026-09-04': { AED: 1, USD: USD_AED_PEG, ZAR: 0.2 },
    '2026-10-02': { AED: 1, USD: USD_AED_PEG, ZAR: 0.25 },
  },
};
assert.equal(toAed(100, 'AED', '2026-09-04', book), 100);
assert.equal(toAed(10, 'USD', '2026-09-04', book), 36.73);
assert.equal(toAed(4000, 'ZAR', '2026-09-06', book), 800, 'Saturday uses the previous rate');
assert.equal(toAed(4000, 'ZAR', '2026-10-02', book), 1000);
assert.equal(rateOn(book, 'ZAR', '2020-01-01'), 0.2, 'before the first saved day, the latest rate is used');
assert.equal(toAed(null, 'ZAR', '2026-09-04', book), null);

const bookings = [
  { id: 1, propertyId: 1, status: 'checked_out', checkOut: '2026-09-05', financeMode: 'inclusive-v1', currency: 'AED', grossAmount: 1000, revenue: 800, cleaningFee: 0, tourismFee: 0, vatAmount: 0, channelAmount: 0, managementAmount: 0, ownerAmount: 800 },
  { id: 2, propertyId: 2, status: 'checked_out', checkOut: '2026-09-05', financeMode: 'inclusive-v1', currency: 'ZAR', grossAmount: 4000, revenue: 4000, cleaningFee: 0, tourismFee: 0, vatAmount: 0, channelAmount: 0, managementAmount: 0, ownerAmount: 4000 },
];
const plain = financialTotals(bookings);
assert.deepEqual(plain.totals.map(t => t.currency).sort(), ['AED', 'ZAR']);
const shown = financialTotals(bookings, [], [], '0001-01-01', '9999-12-31', book);
assert.equal(shown.totals.length, 1);
assert.equal(shown.totals[0].currency, 'AED');
assert.equal(shown.totals[0].grossAmount, 1800);
assert.equal(aedCents(4000, 'ZAR', '2026-09-05', book), 80000);
console.log('PASS: dirham conversion uses the dated rate and totals add only after conversion');
