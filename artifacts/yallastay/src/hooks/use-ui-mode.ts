import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";

export type UiMode = "full" | "simple";
const API = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Pages shown in Simple mode (everything else is hidden from the menus; Full shows all). */
export const SIMPLE_PATHS = ["/dashboard", "/multi-calendar", "/calendar", "/reservations", "/cleaning", "/maintenance", "/accounting", "/cleaner-app", "/settings"];
export const inSimple = (href: string) => { const [path, q] = href.split("?"); return SIMPLE_PATHS.includes(path) && (path !== "/accounting" || !q); };

export function useUiMode() {
  const qc = useQueryClient();
  const q = useQuery<{ mode: UiMode | null }>({
    queryKey: ["ui-mode"],
    queryFn: async () => { const r = await apiFetch(`${API}/api/me/ui-mode`); if (!r.ok) return { mode: null }; return r.json(); },
    staleTime: Infinity,
  });
  const m = useMutation({
    mutationFn: async (mode: UiMode) => { const r = await apiFetch(`${API}/api/me/ui-mode`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not save"); return r.json(); },
    onSuccess: (d) => qc.setQueryData(["ui-mode"], d),
  });
  return { mode: (q.data?.mode ?? null) as UiMode | null, loaded: q.isSuccess, setMode: m.mutateAsync, saving: m.isPending };
}
