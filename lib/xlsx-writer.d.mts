export const STYLE: { none: 0; header: 1; date: 2; aed: 3; usd: 4; rate: 5; title: 6 };
export function colName(i: number): string;
export function excelDate(iso: string): number;
export function writeXlsx(sheets: { name: string; rows: Record<number, any[]>; widths?: Record<string, number> }[]): Buffer;
