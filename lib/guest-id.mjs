// Guest ID status, derived from the booking. Nothing here creates or implies an ID document record:
// `idCollected` stays false until someone actually collects the guest's ID.
//
// Channel verification (owner's rule): Airbnb verifies every guest's identity before a booking is confirmed,
// so an Airbnb booking counts as "Verified by Airbnb" whatever its payment or stay status.
// Booking.com and direct bookings are NOT channel-verified: they stay "ID pending" until an ID is collected.
const CHANNEL_VERIFIED = { airbnb: 'Airbnb' };

/** Name of the channel that verified the guest's ID ("Airbnb"), or null. */
export function idVerifiedByChannel(b) { return CHANNEL_VERIFIED[b?.platform] ?? null; }

/** True when the guest's ID is collected or verified by the channel (used by Task Centre, Today and guest messages). */
export function guestIdComplete(b) { return Boolean(b?.idCollected) || idVerifiedByChannel(b) !== null; }

/** Short status label for screens. */
export function guestIdLabel(b) {
  if (b?.idCollected) return 'ID collected';
  const channel = idVerifiedByChannel(b);
  return channel ? `Verified by ${channel}` : 'ID pending';
}

/**
 * Dubai DTCM guest registration needs a passport copy, which Airbnb does not pass on. True for channel-verified
 * bookings at Dubai properties where no ID has been collected. Informational only: it never makes the ID "pending"
 * and never affects readiness.
 */
export function dtcmPassportNeeded(b, property) {
  return !b?.idCollected && idVerifiedByChannel(b) !== null && /dubai/i.test(String(property?.city ?? ''))
    && !['cancelled', 'blocked'].includes(b?.status);
}
