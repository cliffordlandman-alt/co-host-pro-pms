export declare const AED_PER_USD: number;
export interface PayoutLine { id: string; source: "earnings" | "breakdown"; kind: "booking" | "transfer"; confirmationCode: string | null; listing: string | null; guestName: string | null; checkIn: string | null; checkOut: string | null;
  currency: string; amount: number; cohostPayout: number | null; cohostBasis: "paid" | "expected" | null; cohostTo: string | null; guestPaid: number | null; payoutDate: string | null; status: string; reference: string | null; destination: string | null; notes: string | null; fileName: string | null }
export declare function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] };
export declare function parsePayoutFile(text: string, fileName?: string): { format: "earnings" | "breakdown"; lines: PayoutLine[] };
export declare function reconcilePayouts(input: { lines: any[]; bookings: any[]; properties: any[]; today: string }): {
  rows: any[]; missing: any[]; transfers: any[]; window: { from: string; to: string } | null;
  totals: { paid: { currency: string; destination: string | null; amount: number }[]; upcoming: { currency: string; amount: number }[]; transfers: { currency: string; destination: string; amount: number }[] };
  counts: Record<string, number>;
};
