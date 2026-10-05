/**
 * Server-side paging for list endpoints. A list is paged only when the request has `page`; without it the
 * endpoint keeps returning the plain array (older screens, calendar, exports and tests rely on that).
 * Paged response: { items, total, page, pageSize, pages, summary } where `summary` is computed by the
 * server over the WHOLE filtered set, never just the current page.
 */
export type PageParams = { page: number; pageSize: number; offset: number };

export function pageParams(query: Record<string, unknown>): PageParams | null {
  if (query.page == null || query.page === "") return null;
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const size = Math.floor(Number(query.pageSize ?? 25)) || 25;
  const pageSize = Math.min(100, Math.max(1, size));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paged<T, S>(items: T[], total: number, p: PageParams, summary: S) {
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)), summary };
}

/** Escape a user search term for ILIKE. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, m => "\\" + m)}%`;
