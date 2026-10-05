export const REDACTED: string;
export const REDACTED_URL: string;
export const SECRET_KEY: RegExp;
export function redactText(text: string): string;
export function redactSecrets<T>(value: T, key?: string): T;
