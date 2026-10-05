import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { BRAND } from "../../../../lib/brand.mjs";

/** "Company name on documents" (Settings → Company). Public read, so the owner login page and Owner Portal can use it. */
export function useDocumentName(): string {
  const { data } = useQuery({
    queryKey: ["brand"],
    queryFn: async () => { const r = await apiFetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/brand`); return r.ok ? r.json() : null; },
    staleTime: 60_000,
  });
  return (data && typeof data.documentName === "string" && data.documentName) || BRAND;
}

/** Same, for code that runs outside React (print windows). */
export async function fetchDocumentName(): Promise<string> {
  try { const r = await apiFetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/brand`); const d = r.ok ? await r.json() : null; return (d && d.documentName) || BRAND; } catch { return BRAND; }
}
