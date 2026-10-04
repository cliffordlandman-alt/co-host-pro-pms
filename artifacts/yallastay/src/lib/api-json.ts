import { apiFetch } from "@/lib/api-fetch";
/** JSON request through the app's authenticated fetch; throws the server's error message on failure. */
export async function apiJson<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await apiFetch(url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d as T;
}
const dubai = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
/** "4 Oct, 12:22 Dubai" for a server timestamp; "never" when empty. */
export const dubaiTime = (v?: string | null) => (v ? `${dubai.format(new Date(v))} Dubai` : "never");
/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(v?: string | null, now = Date.now()) {
  if (!v) return "never";
  const m = Math.max(0, Math.round((now - new Date(v).getTime()) / 60000));
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
