// Display labels that explain a booking's money state. Display only: nothing here changes stored data.
//
// Payment: Airbnb collects the guest's payment itself and never tells the host a "payment status", so an Airbnb
// booking stored as 'unknown' is shown as "Collected by Airbnb" rather than "Not supplied". The stored value stays
// 'unknown' (a 'paid' value would feed rules such as the management-fee "booking_paid" status).
const CHANNEL_COLLECTED = { airbnb: 'Airbnb' };
const LABELS = { paid: 'Paid', partial: 'Partial', pending: 'Pending', unknown: 'Not supplied by channel' };

/** { key, label } for a booking's guest-payment status. key 'channel' = collected by the channel. */
export function paymentLabel(b) {
  const status = b?.paymentStatus || 'pending';
  const channel = CHANNEL_COLLECTED[b?.platform];
  if (status === 'unknown' && channel && !['cancelled', 'blocked'].includes(b?.status)) return { key: 'channel', label: `Collected by ${channel}` };
  return { key: status, label: LABELS[status] ?? status };
}

/**
 * Why a booking's money is not verified yet and what verifies it, or null when it is verified.
 * f = reservationFinancials(b); today = 'YYYY-MM-DD'.
 */
export function unverifiedReason(b, f, today = new Date().toISOString().slice(0, 10)) {
  if (!f || f.verified || ['cancelled', 'blocked'].includes(b?.status)) return null;
  const airbnb = b?.platform === 'airbnb';
  if (airbnb && !f.hasChannelEarnings && String(b?.checkIn ?? '') > today)
    return 'Upcoming stay: Airbnb pays out after check-in. Verify it once the payout and Airbnb’s reservation breakdown (guest total and fees) are available.';
  if (airbnb && f.hasChannelEarnings)
    return 'Airbnb payout is linked, but Airbnb’s earnings export has no guest-paid total or fee breakdown. Import the reservation breakdown under Verify bookings to verify it.';
  if (airbnb) return 'No Airbnb payout or reservation breakdown imported yet. Import the earnings CSV or reservation breakdown under Verify bookings.';
  return 'Enter the guest total and fees under Verify bookings to include this stay in owner statements.';
}
