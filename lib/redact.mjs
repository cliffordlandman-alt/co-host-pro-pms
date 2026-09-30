// Redact secret-bearing values before they are stored in (or shown from) the audit log.
// Pure function: no database or network access. Keep in step with drizzle/0015_redact_audit_secrets.sql.
export const REDACTED = '[redacted]';
export const REDACTED_URL = '[redacted URL]';
// Field names whose values are secrets: channel calendar feeds (private links) and credentials.
export const SECRET_KEY = /ical|password|passwd|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|signature/i;
// Private links inside free text: calendar feeds, or any URL carrying a token-like query parameter.
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const SECRET_URL = /ical|\.ics\b|[?&](s|t|token|key|sig|signature|secret|auth|access_token)=/i;
export function redactText(text) {
  return String(text).replace(URL_RE, u => (SECRET_URL.test(u) ? REDACTED_URL : u));
}
export function redactSecrets(value, key = '') {
  if (value === null || value === undefined) return value;
  if (key && SECRET_KEY.test(key) && value !== '' && typeof value !== 'boolean') return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(v => redactSecrets(v));
  if (value instanceof Date) return value;
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v, k)]));
  return value;
}
