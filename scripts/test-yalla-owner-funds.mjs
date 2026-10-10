// YALLA workbook, Clifford's 10 Oct answers (master Income Input rows 38, 52-57; Lists & Sources rows 31, 42-48):
// owner money held (deposits register kind 'owner_funds') is a liability, not company income; an owner's fee paid in
// the listing currency (Dylan's ZAR) counts once; a rounding row ties the month's Airbnb income to the AED payout
// lines; void entries (cancelled, kept for the record) are counted nowhere.
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildWorkbookRows, companyMonthSummary, workbookXlsx } from '../lib/yalla-workbook.mjs';
import { companyStatement } from '../lib/company-statement.mjs';

function unzip(buf) {
  const out = {}; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString(), data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString(); i += 30 + nlen + xlen + size;
  }
  return out;
}

const line = (id, propertyId, currency, amount) => ({ id, payoutId: 'P1', confirmationCode: id, propertyId, currency, amount: String(amount), kind: 'home', status: 'paid', checkIn: '2026-09-10', checkOut: '2026-09-15', sourceDate: '2026-09-20' });
const data = {
  owners: [{ id: 1, name: 'Dylan Matthysen' }, { id: 2, name: 'Bonnita' }],
  properties: [
    { id: 1, name: 'Sunrise Bay 2106', reportName: 'Sunrise Bay 2106', currency: 'AED' },
    { id: 2, name: 'Garden Retreat | Cozy Suite', reportName: 'Garden Retreat', ownerId: 2, currency: 'AED' },
    { id: 3, name: 'The Green Lawn House - Port Elizabeth', reportName: 'Green Lawn House - Port Elizabeth', ownerId: 1, currency: 'ZAR' },
    { id: 4, name: 'The Grey House | 2BR, Bar & Open Kitchen', reportName: '2 Bedroom Mount Pleasant', ownerId: 1, currency: 'ZAR' },
  ],
  payouts: [{ id: 'P1', currency: 'USD', amount: '1000.00', sourceDate: '2026-09-20' }],
  earnings: [line('A', 1, 'AED', 3000), line('B', 2, 'AED', 600), line('C', 3, 'ZAR', 500), line('D', 4, 'ZAR', 250)],
  bookings: [{ id: 9, propertyId: 3, status: 'confirmed', financeMode: 'inclusive-v1', checkOut: '2026-08-20', managementPercent: '15', managementAmount: '0', currency: 'ZAR' }],
  deposits: [
    { id: 7, kind: 'owner_funds', propertyId: 2, counterparty: 'Bonnita', amount: '100.00', currency: 'AED', date: '2026-08-31', status: 'held', notes: "Airbnb net for Bonnita's bookings; fee not agreed\nSource: Airbnb earnings CSV / Clifford 10 Oct\nDetail: AED 100 bookings" },
    { id: 8, kind: 'owner_funds', propertyId: 2, counterparty: 'Bonnita', amount: '600.01', currency: 'AED', date: '2026-09-30', status: 'held', notes: "Airbnb net for Bonnita's bookings; fee not agreed\nSource: Owner statement / Clifford 10 Oct" },
  ],
  transactions: [
    { id: 100, type: 'income', allocation: 'company', date: '2026-09-01', category: 'Booking', amount: '2250', currency: 'AED', propertyId: 1, description: 'Direct booking', paymentStatus: 'void' },
    { id: 101, type: 'expense', allocation: 'company', date: '2026-08-31', category: 'Refund', amount: '2250', currency: 'AED', propertyId: 1, description: 'Booking refund', paymentStatus: 'void' },
  ],
};
const r = buildWorkbookRows(data, '2026-09', {}, { from: '2026-08', today: '2026-10-10' });
const k = kind => r.income.filter(x => x.kind === kind);
// Owner money: negative Transaction rows; September first on its date, August appended at the end.
assert.deepEqual(k('owner-funds').map(x => [x.date, x.property, x.payer, x.gross, x.source, x.view]), [['2026-09-30', 'Garden Retreat', 'Bonnita', -600.01, 'Owner statement / Clifford 10 Oct', 'Transaction'], ['2026-08-31', 'Garden Retreat', 'Bonnita', -100, 'Airbnb earnings CSV / Clifford 10 Oct', 'Transaction']]);
assert.ok(r.income.indexOf(k('owner-funds')[0]) < r.income.findIndex(x => x.kind === 'airbnb-monthly' && x.date === '2026-09-30') && r.income.indexOf(k('owner-funds')[1]) > r.income.findIndex(x => x.kind === 'airbnb-property'));
assert.equal(k('owner-funds')[1].description, "Garden Retreat Airbnb net - Bonnita's money held for her, not company income (see Lists & Sources: Owed to owners) - Aug (AED 100 bookings)");
assert.deepEqual(r.lists.ownerFundsHeld.rows.map(o => [o.owner, o.amount, o.status, o.notes]), [['Bonnita', 100, 'Held', "Airbnb net for Bonnita's bookings; fee not agreed"], ['Bonnita', 600.01, 'Held', "Airbnb net for Bonnita's bookings; fee not agreed"]]);
assert.equal(r.lists.ownerFundsHeld.total, 700.01);
assert.equal(r.lists.ownerFundsHeld.note, 'Owed to Bonnita to 30 Sep (Oct bookings not yet included)');
assert.ok(!r.lists.depositsHeld.length, 'owner money is not a guest / tenant deposit');
// Dylan's fee counted once, in ZAR: his properties' USD allocation out of AED income; memo item in ZAR.
assert.deepEqual(k('fee-once').map(x => [x.property, x.payer, x.gross]), [['Green Lawn House - Port Elizabeth', 'Dylan', -48.33], ['2 Bedroom Mount Pleasant', 'Dylan', -24.17]]);
const memo = r.lists.items.find(i => i.key === 'fee-once:1');
assert.deepEqual([memo.item, memo.value, memo.units, memo.period, memo.reference, memo.treatment], ['Dylan 15% fee Sept (company revenue, ZAR)', 750, 'ZAR', 'Sept 2026', 'Grey House 250.00 + Green Lawn 500.00', 'Counted once, in ZAR - not in AED totals']);
// Rounding: September Airbnb income = the AED payout lines of the company's own listing (3,000.00).
assert.deepEqual(k('airbnb-tie').map(x => [x.gross, x.description]), [[0.01, 'Airbnb USD rounding - ties Sept Airbnb income to the Sea View AED payout 3,000.00']]);
// Void entries: nowhere.
assert.ok(!r.income.some(x => x.transactionId === 100) && !r.expense.some(x => x.transactionId === 101));
assert.ok(!companyStatement(data, '2026-08-01', '2026-09-30').lines?.some?.(l => String(l.id).startsWith('manual-10')));
// Month view = the export: revenue 3,000.00, all Airbnb; ZAR fee counted in ZAR.
const cm = companyMonthSummary(data, '2026-09', {}, { today: '2026-10-10' });
assert.equal(cm.revenue.total, 3000); assert.equal(cm.revenue.airbnb, 3000);
assert.deepEqual(cm.otherCurrencies.map(o => [o.currency, o.airbnbInAedRevenue, o.countedInCurrency]), [['ZAR', 0, 750]]);
// The .xlsx: the master's formulas (=-H<allocation>, the tie) and the Owed to owners table.
const parts = unzip(workbookXlsx(r)), ii = parts['xl/worksheets/sheet4.xml'], ls = parts['xl/worksheets/sheet8.xml'];
const rowOf = key => 7 + r.income.findIndex(x => x.key === key);
const sep = rowOf('owner-funds:8'), gr = rowOf('airbnb-property:2'), gl = rowOf('airbnb-property:3'), mp = rowOf('airbnb-property:4'), mon = rowOf('airbnb-monthly:2026-09');
assert.ok(ii.includes(`<f>-H${gr}</f>`), 'September owner money = -H<Garden Retreat allocation>');
assert.ok(ii.includes(`<f>-H${gl}</f>`) && ii.includes(`<f>-H${mp}</f>`));
assert.ok(ii.includes(`<f>3000+H${gr}+H${gl}+H${mp}-H${mon}</f>`), 'rounding tie formula');
assert.ok(ii.includes('(Lists &amp; Sources row ' + (23 + r.lists.items.findIndex(i => i.key === 'fee-once:1')) + ')'), 'fee row names its memo row');
assert.ok(ls.includes('Owed to owners - owner money held') && ls.includes(`<f>-&apos;Income Input&apos;!H${sep}</f>`) || ls.includes(`<f>-'Income Input'!H${sep}</f>`), 'Owed to owners links to the income row');
assert.ok(ls.includes('Owed to Bonnita to 30 Sep (Oct bookings not yet included)'));
// Paid out (Clifford, 10 Oct: Bonnita paid): Owed to owners = 0, rows listed as Paid out, revenue unchanged.
{ const paid = { ...data, deposits: data.deposits.map(d => ({ ...d, status: 'paid_out', settledOn: d.date, notes: d.notes + '\nPaid: Paid to Bonnita (Clifford confirmed 10 Oct); exact date TBC' })) };
  const rp = buildWorkbookRows(paid, '2026-09', {}, { from: '2026-08', today: '2026-10-10' });
  assert.equal(rp.lists.ownerFundsHeld.total, 0);
  assert.deepEqual(rp.lists.ownerFundsHeld.rows.map(o => [o.status, o.notes]), [['Paid out', 'Paid to Bonnita (Clifford confirmed 10 Oct); exact date TBC'], ['Paid out', 'Paid to Bonnita (Clifford confirmed 10 Oct); exact date TBC']]);
  assert.equal(rp.lists.ownerFundsHeld.note, 'Nothing owed to Bonnita at 30 Sep - paid out');
  assert.equal(companyMonthSummary(paid, '2026-09', {}, { today: '2026-10-10' }).revenue.total, 3000, 'paying the owner does not change company revenue');
  assert.ok(unzip(workbookXlsx(rp))['xl/worksheets/sheet8.xml'].includes('&quot;Held&quot;)'), 'TOTAL counts held rows only'); }
console.log('OK owner money held, fee counted once in ZAR, rounding tie, void entries');
