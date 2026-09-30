import assert from 'node:assert/strict';
import {reservationFinancials,financialTotals} from '../lib/reservation-financials.mjs';
const b={id:1,propertyId:1,externalId:'airbnb:ABC',platform:'airbnb',revenue:'0',paymentStatus:'unknown',checkOut:'2026-09-30'};
const earnings=[{propertyId:1,confirmationCode:'ABC',currency:'ZAR',amount:123,kind:'cohost',status:'paid'},{propertyId:2,confirmationCode:'ABC',currency:'ZAR',amount:999,kind:'cohost',status:'paid'}];
const f=reservationFinancials(b,earnings);assert.equal(f.grossAmount,null);assert.equal(f.amountPaid,null);assert.equal(f.channelEarnings[0].amount,123);assert.equal(f.state,'channel_earnings_only');
const known={...b,financeMode:'inclusive-v1',grossAmount:'105',revenue:'100',vatAmount:'5',managementAmount:'20',ownerAmount:'80',paymentStatus:'partial',balanceDue:'50'};
const k=reservationFinancials(known,earnings,{currency:'ZAR'});assert.equal(k.amountPaid,55);assert.equal(k.grossAmount,105);assert.equal(k.currency,'ZAR');
const totals=financialTotals([b,known,{...known,id:2,status:'cancelled'}],earnings,[{id:1,currency:'ZAR'}],'2026-09-01','2026-09-30');assert.equal(totals.missing,1);assert.equal(totals.totals[0].grossAmount,105);assert.equal(totals.totals[0].managementAmount,20);console.log('PASS: unknown vs zero, exact channel linking, separate currencies, no payout double count, pending/paid amounts, cancellation exclusion');
