export interface SplitRow { reservationId: number | null; code: string | null; guestName: string | null; checkIn: string | null; checkOut: string | null; currency: string; known: boolean; source?: string; inYallaPMS?: boolean;
  total?: number | null; cohostPayout?: number | null; cohostBasis?: "paid" | "expected" | null; company?: number; companyBasis?: "paid" | "upcoming" | "expected"; companyPaidTo?: string | null; reason?: string }
export interface SplitTotal { currency: string; bookings: number; total: number; cohostPayout: number; cohostPaid: number; cohostExpected: number; company: number; companyPaid: number; companyNotYet: number; cohostUnknown: number; properties?: number }
export interface Split { settingOn: boolean; fileHasCohost: boolean; rows: SplitRow[]; totals: SplitTotal[]; withoutFigures: number }
export declare function airbnbSplit(input: { property: any; rules: any; bookings: any[]; lines: any[]; period: { start: string; end: string }; paidTo?: Record<string, string> }): Split | null;
export declare function addSplitTotals(splits: (Split | null)[]): (SplitTotal & { properties: number })[];
