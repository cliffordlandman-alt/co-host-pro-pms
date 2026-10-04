import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, UserPlus } from "lucide-react";

// Suggested owners (named by Clifford). Nothing is saved until "Create owner": that runs the normal paths
// (POST /owners, then PATCH /properties/:id for each property, then the property's fee settings for the co-host
// option), each audit-logged. Creating an owner sends nothing to them.
type Prop = { label: string; expectedCurrency: string; problem: string | null;
  match: { id: number; name: string; currency: string | null; ownerId: number | null; ownerName: string | null } | null };
type Suggestion = { key: string; name: string; phone: string; note: string; cohostOption: boolean; feeOption: { basis: "net-payout"; percent: number; label: string } | null;
  currencyOption: { currency: string; label: string } | null;
  payoutOption: { label: string; settings: { feeBasis: "airbnb-payout"; managementFeePercent: number; payoutToOwner: true; includeCleaning: boolean; cleaningFee: number } } | null;
  existingOwner: { id: number; name: string; phone: string | null } | null; properties: Prop[] };

async function json(r: Response) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }
const send = (url: string, method: string, body?: unknown) => apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then(json);

export function SuggestedOwners() {
  const { data } = useQuery<Suggestion[]>({ queryKey: ["owner-suggestions"], queryFn: async () => json(await apiFetch("/api/owners/suggestions")) });
  if (!data?.length) return null;
  return (
    <section data-testid="suggested-owners" className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <h2 className="font-semibold">Suggested owners</h2>
      <p className="text-xs text-muted-foreground">From Clifford's notes. Check the details, then create. Creating an owner sends them nothing (no email or WhatsApp).</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">{data.map(s => <SuggestionCard key={s.key} s={s} />)}</div>
    </section>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const qc = useQueryClient();
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState(s.phone);
  const [cohost, setCohost] = useState(s.cohostOption);
  const [fee, setFee] = useState(!!s.feeOption);
  const [currency, setCurrency] = useState(!!s.currencyOption);
  const [payout, setPayout] = useState(!!s.payoutOption);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"" | "create" | "dismiss">("");
  const [error, setError] = useState("");
  const assignable = s.properties.filter(p => p.match && (p.match.ownerId == null || p.match.ownerId === s.existingOwner?.id));
  async function create() {
    setBusy("create"); setError("");
    try {
      if (!name.trim()) throw new Error("Enter the owner's name");
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("Check the email address (or leave it empty for now)");
      // Currency first: it is the step that can be refused (nothing else is created then). Fee Settings save,
      // audit-logged; amounts already recorded keep their currency.
      const cur = s.currencyOption && currency ? s.currencyOption.currency : null;
      if (cur) for (const p of assignable) if (p.match!.currency !== cur) await send(`/api/accounting/settings/${p.match!.id}`, "PUT", { currency: cur });
      const ownerId = s.existingOwner?.id ?? (await send("/api/owners", "POST", { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null })).id;
      for (const p of assignable) {
        if (p.match!.ownerId !== ownerId) await send(`/api/properties/${p.match!.id}`, "PATCH", { ownerId });
        // One fee-settings save per property (audit-logged): co-host flag and fee basis together.
        const settings = { ...(s.cohostOption && cohost ? { cohostPaidToOwner: true } : {}), ...(s.feeOption && fee ? { feeBasis: s.feeOption.basis, managementFeePercent: s.feeOption.percent } : {}),
          ...(s.payoutOption && payout ? s.payoutOption.settings : {}) };
        if (Object.keys(settings).length) await send(`/api/accounting/settings/${p.match!.id}`, "PUT", settings);
      }
    } catch (e) { setError((e as Error).message); }
    setBusy("");
    await qc.invalidateQueries();
  }
  async function dismiss() {
    setBusy("dismiss"); setError("");
    try { await send(`/api/owners/suggestions/${s.key}/dismiss`, "POST"); } catch (e) { setError((e as Error).message); }
    setBusy("");
    await qc.invalidateQueries({ queryKey: ["owner-suggestions"] });
  }
  return (
    <div data-testid={`suggestion-${s.key}`} className="rounded-lg border bg-card p-3 text-sm">
      {s.existingOwner && <p className="mb-2 text-xs text-amber-800">Owner "{s.existingOwner.name}" already exists; this will assign the properties below to them.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Name<Input aria-label={`Name for ${s.name}`} value={name} onChange={e => setName(e.target.value)} disabled={!!s.existingOwner || !!busy} /></label>
        <label className="text-xs">Phone{!s.phone && <span className="text-muted-foreground"> (optional)</span>}<Input aria-label={`Phone for ${s.name}`} inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={!!s.existingOwner || !!busy} /></label>
        {!s.existingOwner && <label className="text-xs sm:col-span-2">Email <span className="text-muted-foreground">(optional, can be added later)</span><Input aria-label={`Email for ${s.name}`} type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!!busy} /></label>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{s.note}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {s.properties.map(p => (
          <li key={p.label} className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{p.match ? p.match.name : p.label}</span>
            {p.match && <span className="text-muted-foreground">{p.match.currency || "no currency"}</span>}
            {p.match && p.match.currency && p.match.currency !== p.expectedCurrency && s.currencyOption?.currency === p.expectedCurrency && currency && <span className="text-sky-800">→ {p.expectedCurrency} on Create owner</span>}
            {p.match && p.match.currency && p.match.currency !== p.expectedCurrency && !(s.currencyOption?.currency === p.expectedCurrency && currency) && <span className="flex items-center gap-1 text-amber-800"><AlertTriangle className="h-3 w-3" />Expected {p.expectedCurrency}; set to {p.match.currency}. Check in Finance → Fee Settings (not changed here).</span>}
            {p.problem && <span className="flex items-center gap-1 text-amber-800"><AlertTriangle className="h-3 w-3" />{p.problem}</span>}
          </li>
        ))}
      </ul>
      {s.cohostOption && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={cohost} onChange={e => setCohost(e.target.checked)} disabled={!!busy} aria-label="Airbnb co-host payout goes directly to the owner" />
        <span>Airbnb co-host payout goes directly to the owner<span className="block text-muted-foreground">Statements then show it as already paid to the owner by Airbnb and deduct it from the balance.</span></span></label>}
      {s.feeOption && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={fee} onChange={e => setFee(e.target.checked)} disabled={!!busy} aria-label={s.feeOption.label} />
        <span>{s.feeOption.label}<span className="block text-muted-foreground">Management fee {s.feeOption.percent}% of the net payout (guest total minus Airbnb's actual fees), matching Airbnb's split. Bookings need Airbnb's fees from the breakdown.</span></span></label>}
      {s.currencyOption && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={currency} onChange={e => setCurrency(e.target.checked)} disabled={!!busy} aria-label={s.currencyOption.label} />
        <span>{s.currencyOption.label}<span className="block text-muted-foreground">Nothing is converted: bookings, entries and statements already recorded keep their currency (e.g. AED). New bookings and imports use {s.currencyOption.currency}. A month with amounts in both currencies can't be summed without an exchange rate, so its statement is held with a clear item.</span></span></label>}
      {s.payoutOption && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={payout} onChange={e => setPayout(e.target.checked)} disabled={!!busy} aria-label={s.payoutOption.label} />
        <span>{s.payoutOption.label}<span className="block text-muted-foreground">Bookings are calculated from Airbnb's payout: management fee {s.payoutOption.settings.managementFeePercent}%, no cleaning cost, and the whole payout shows on statements as already paid to the owner by Airbnb, so nothing is owed either way.</span></span></label>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={create} disabled={!!busy || (!!s.existingOwner && !assignable.length)}>{busy === "create" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1 h-3.5 w-3.5" />}{s.existingOwner ? "Assign properties" : "Create owner"}</Button>
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={!!busy}>Dismiss</Button>
        {!assignable.length && <Link href="/properties" className="self-center text-xs underline">Properties</Link>}
      </div>
    </div>
  );
}
