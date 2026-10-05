export type StatementFigures = { currency: string; bookings: number; nights: number; gross: number; vat: number; tourism: number; channel: number; management: number; cleaning: number; maintenance: number; other: number; paidByAirbnb: number; ownerPayout: number };
export function monthBounds(month: string): { start: string; end: string };
export function recognizedBookings(bookings: any[], propertyId: number, month: string): any[];
export function ownerExpenses(transactions: any[], propertyId: number, month: string): any[];
export function completedTickets(tickets: any[], propertyId: number, month: string): any[];
export function ownerStatementCalc(input: { property: any; rules: any; bookings: any[]; expenses: any[]; tickets: any[]; month: string; payouts?: any[] }): {
  propertyCurrency: string; recognized: any[]; verified: any[]; unverified: any[]; entries: any[]; maintenanceTickets: any[];
  groups: StatementFigures[]; hold: (Record<string, any> & { reason: string }) | null; statement: Record<string, any> | null };
