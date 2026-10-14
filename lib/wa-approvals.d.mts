export const CATEGORIES: string[]; export const BLOCKED: string[]; export const DEFAULT_PROMPT: string;
export function isBlocked(cat: any): boolean; export function waEnabled(env?: any): boolean; export function normContact(c: any): string;
export function matchRule(rules: any[], draft: any): any; export function newRule(x: { contact?: string; contactName?: string; category: string; scope: string }, by: string): any;
