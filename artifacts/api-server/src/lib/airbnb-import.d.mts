export function money(value: unknown): string;
export function parseCsv(text: string): string[][];
export function normalizeImport(input: any, properties: any[]): any;
export function reservationState(status: string): "cancelled" | "ignore" | "booked";
export function earningsAmount(value: string, currencyColumn?: string): { currency: string; amount: string };
