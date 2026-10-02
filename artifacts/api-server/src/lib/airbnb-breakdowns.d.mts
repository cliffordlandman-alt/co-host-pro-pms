export type BreakdownRow = { line: number; code: string; listing: string | null; guestName: string | null; checkIn: string | null; checkOut: string | null; currency: string | null;
  guestTotal: string | null; cleaningFee: string | null; hostPayout: string | null; guestServiceFee: string | null; hostServiceFee: string | null;
  otherFees: string | null; notes: string | null; cohost: { mentioned: boolean; amount: string | null }; errors: string[] };
export const BREAKDOWN_COLUMNS: string[];
export function money(value: unknown, label: string, errors: string[]): string | null;
export function cohostFromNotes(notes: unknown): { mentioned: boolean; amount: string | null };
export function parseBreakdowns(text: unknown): BreakdownRow[];
