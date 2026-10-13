export function periodTitle(p: any): string;
export function exportFileName(p: any, ext: string): string;
export function exportModel(report: any, bookingsByProperty?: Record<number, any[]>, opts?: { generatedAt?: Date }): { title: string; sheets: { name: string; rows: any[][]; widths?: number[] }[] };
export function zip(files: [string, string][]): Buffer;
export function toXlsx(model: any): Buffer;
export function toPdf(model: any): Buffer;
