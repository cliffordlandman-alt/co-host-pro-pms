export function ownerCodeEmail(input: { ownerName: string; code: string; company?: string }): { subject: string; html: string };
export function statementEmail(input: { ownerName: string; propertyName: string; statement: any; company?: string }): { subject: string; html: string };
