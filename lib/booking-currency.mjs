// Booking currency and statement booking order, shared by the API and the web app.

/** A booking's amounts are in its own currency when one was stamped (the property's currency changed later),
 *  otherwise in the property's currency. Never relabel: always read a booking's currency through this. */
export function bookingCurrency(booking, property) {
  return booking?.currency || property?.currency || 'AED';
}

/** The booking's confirmation code (Airbnb), or null. */
export function confirmationCode(externalId) {
  return typeof externalId === 'string' && externalId.startsWith('airbnb:') ? externalId.slice(7) : null;
}

/** Statement booking rows: by check-in date, then confirmation code (bookings without one last), then id. */
export function compareStatementBookings(a, b) {
  const ci = String(a.checkIn ?? '').localeCompare(String(b.checkIn ?? ''));
  if (ci) return ci;
  const ca = a.code ?? null, cb = b.code ?? null;
  if (ca !== cb) { if (ca == null) return 1; if (cb == null) return -1; const c = ca.localeCompare(cb); if (c) return c; }
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

export function sortStatementBookings(rows) {
  return [...(rows ?? [])].sort(compareStatementBookings);
}
