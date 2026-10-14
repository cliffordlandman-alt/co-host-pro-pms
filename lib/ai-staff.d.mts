export const PLANS: Record<string, string[]>;
export const BOTS: Record<string, any>;
export function botList(): any[];
export function botEnabled(config: any, id: string): boolean;
export function canRead(bot: string, path: string): boolean;
export function canWrite(bot: string, method: string, path: string): boolean;
export function runChecks(data: any): any[];
