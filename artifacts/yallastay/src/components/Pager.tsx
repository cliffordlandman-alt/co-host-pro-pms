import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

/** Paged list response from the API (see api-server/src/lib/paging.ts). `summary` covers the whole filtered set. */
export type Paged<T = any, S = any> = { items: T[]; total: number; page: number; pageSize: number; pages: number; summary: S };

/**
 * Fetches one page of a server-paged list. `filters` are sent as query params (empty / "all" values are dropped);
 * changing any filter returns to page 1. The query key starts with `key`, so existing
 * `invalidateQueries({ queryKey: [key] })` calls keep refreshing the list.
 */
export function usePagedList<T = any, S = any>(key: string, path: string, filters: Record<string, string | number | null | undefined>, pageSize = 25) {
  const [page, setPage] = useState(1);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== "" && v !== "all").map(([k, v]) => [k, String(v)]));
  const sig = JSON.stringify(clean);
  useEffect(() => { setPage(1); }, [sig]);
  const params = new URLSearchParams({ ...clean, page: String(page), pageSize: String(pageSize) });
  const query = useQuery<Paged<T, S>>({
    queryKey: [key, "paged", clean, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await apiFetch(`/api/${path}?${params}`);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Could not load (${r.status})`);
      return r.json();
    },
  });
  // If rows were removed and the current page no longer exists, step back to the last page.
  const pages = query.data?.pages;
  useEffect(() => { if (pages && page > pages) setPage(pages); }, [pages, page]);
  return { ...query, page, setPage };
}

export function Pager({ page, pages, total, pageSize, onPage, noun = "items", busy = false }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void; noun?: string; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  if (total === 0) return null;
  // After changing page, bring the top of the page back into view (on phones the pager sits below a long list).
  const go = (n: number) => { onPage(n); window.scrollTo({ top: 0 }); ref.current?.closest("main")?.scrollTo?.({ top: 0 }); };
  const label = total === 1 ? noun.replace(/s$/, "") : noun;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <nav ref={ref} aria-label="Pagination" className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="text-muted-foreground text-xs sm:text-sm" aria-live="polite">
        {from}–{to} of {total} {label}{pages > 1 && <span className="hidden sm:inline"> · page {page} of {pages}</span>}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-9 px-2.5" onClick={() => go(page - 1)} disabled={page <= 1 || busy} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline ml-1">Previous</span>
          </Button>
          <span className="text-xs text-muted-foreground sm:hidden tabular-nums">{page}/{pages}</span>
          <Button variant="outline" size="sm" className="h-9 px-2.5" onClick={() => go(page + 1)} disabled={page >= pages || busy} aria-label="Next page">
            <span className="hidden sm:inline mr-1">Next</span><ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </nav>
  );
}
