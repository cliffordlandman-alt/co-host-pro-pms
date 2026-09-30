export function airbnbIdAssumed(b) {
  return b?.platform === 'airbnb' && b.paymentStatus === 'paid' && ['confirmed', 'checked_in', 'checked_out'].includes(b.status);
}
export function guestIdComplete(b) { return Boolean(b?.idCollected) || airbnbIdAssumed(b); }
