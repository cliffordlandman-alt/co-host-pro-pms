import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { Switch } from "@/components/ui/switch";
import { CalendarClock } from "lucide-react";

// Monthly automatic owner statements, per owner. Off by default. From the 6th of each month the previous month's
// statements are saved as drafts for owners with it on. Emailing them needs all of: auto-send on, an email address,
// outgoing messages switched on for this system (OUTBOUND_DELIVERY=on), and an earlier automatic month approved in
// the app ("Mark as Sent"). Until then each one waits for approval with an in-app notification.
type Owner = { id: number; name: string; email: string | null; autoStatements: boolean; autoSend: boolean; lastRun: string | null; wouldEmail: boolean; waitReason: string | null };
async function json(r: Response) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }

export function AutoStatementsSettings() {
  const qc = useQueryClient();
  const { data } = useQuery<{ today: string; outbound: boolean; owners: Owner[] }>({ queryKey: ["auto-statements"], queryFn: async () => json(await apiFetch("/api/accounting/auto-statements")) });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function set(o: Owner, patch: Partial<Pick<Owner, "autoStatements" | "autoSend">>) {
    setBusy(o.id); setError("");
    try { await json(await apiFetch(`/api/owners/${o.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })); }
    catch (e) { setError((e as Error).message); }
    setBusy(null);
    await qc.invalidateQueries({ queryKey: ["auto-statements"] });
  }
  if (!data?.owners.length) return null;
  return (
    <section data-testid="auto-statements" className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4" />Monthly automatic statements</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Off by default. When on, the previous month's statements are saved as drafts from the 6th of each month. The first automatic month always waits for you to approve it (Owner statements → Mark as Sent). Emailing needs the owner's email, "Email automatically" on, and outgoing messages switched on for this system (OUTBOUND_DELIVERY=on){data.outbound ? "" : ", which is off here, so nothing is emailed"}. Anything not emailed shows up as a notification to approve.</p>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y">
        {data.owners.map(o => <li key={o.id} data-testid={`auto-owner-${o.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{o.name}</p>
            <p className="text-xs text-muted-foreground">{!o.autoStatements ? "Off" : o.wouldEmail ? "Drafts saved and emailed monthly" : `Drafts saved monthly; ${o.waitReason ? o.waitReason.replace(/^Waiting for approval: /, "waits for approval: ") : "waits for approval"}`}{o.lastRun ? ` · last run for ${o.lastRun}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs"><Switch aria-label={`Automatic statements for ${o.name}`} checked={o.autoStatements} disabled={busy === o.id} onCheckedChange={v => set(o, { autoStatements: v, ...(v ? {} : { autoSend: false }) })} />Create automatically</label>
            <label className={`flex items-center gap-2 text-xs ${o.autoStatements ? "" : "opacity-50"}`}><Switch aria-label={`Email statements automatically to ${o.name}`} checked={o.autoSend} disabled={busy === o.id || !o.autoStatements} onCheckedChange={v => set(o, { autoSend: v })} />Email automatically{!o.email && <span className="text-muted-foreground">(no email yet)</span>}</label>
          </div>
        </li>)}
      </ul>
    </section>
  );
}
