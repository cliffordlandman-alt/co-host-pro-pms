export function bookingCurrency(booking: { currency?: string | null } | null | undefined, property?: { currency?: string | null } | null): string;
export function confirmationCode(externalId: string | null | undefined): string | null;
export function compareStatementBookings(a: { checkIn?: string | null; code?: string | null; id?: number | null }, b: { checkIn?: string | null; code?: string | null; id?: number | null }): number;
export function sortStatementBookings<T extends { checkIn?: string | null; code?: string | null; id?: number | null }>(rows: T[] | null | undefined): T[];
