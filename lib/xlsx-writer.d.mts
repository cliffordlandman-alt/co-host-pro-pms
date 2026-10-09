export const STYLE: Record<'none' | 'header' | 'date' | 'aed' | 'usd' | 'rate' | 'title' | 'banner' | 'pct' | 'monthYear' | 'greyLabel' | 'greyDate' | 'kpiTeal' | 'kpiRed' | 'kpiNavy' | 'kpiAmber' | 'kpiAed' | 'kpiInt' | 'headerAed' | 'headerPct' | 'note' | 'headerWrap' | 'listHeader', number>;
export function colName(i: number): string;
export function excelDate(iso: string): number;
export function writeXlsx(sheets: { name: string; rows: Record<number, any[]>; widths?: Record<string, number>; heights?: Record<number, number>; merges?: string[] }[]): Buffer;
