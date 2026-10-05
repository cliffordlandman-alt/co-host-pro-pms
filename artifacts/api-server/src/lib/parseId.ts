/**
 * Parse a route/query param value into a positive integer ID.
 *
 * Accepts `string | string[] | undefined` because Express 5 types both
 * `req.params` and `req.query` values as `string | string[]`.
 * When an array is supplied, the first element is used.
 *
 * Returns `null` when the value is missing, non-numeric, or zero/negative.
 */
export function parseId(raw: string | string[] | undefined): number | null {
  const str = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(str ?? "", 10);
  return isNaN(n) || n <= 0 ? null : n;
}
