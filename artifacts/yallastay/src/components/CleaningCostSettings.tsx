import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

const label = (n: number) => n === 0 ? 'Studio' : `${n}BR`;
async function send(url: string, body?: unknown, method = 'POST') {
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// Cleaning company rate card (company expense per checkout clean) and the 30-day backfill.
export function CleaningCostSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<any>({ queryKey: ['cleaning-costs'], queryFn: async () => { const r = await apiFetch('/api/accounting/cleaning-costs'); if (!r.ok) throw new Error('Could not load the cleaning rate card'); return r.json(); } });
  const [vendorName, setVendorName] = useState('');
  const [rows, setRows] = useState<{ bedrooms: number; amount: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setVendorName(data.vendor?.name ?? '');
    setRows(data.rates.map((r: any) => ({ bedrooms: r.bedrooms, amount: String(r.amount) })));
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      const removed = (data?.rates ?? []).filter((r: any) => !rows.some(x => x.bedrooms === r.bedrooms)).map((r: any) => ({ bedrooms: r.bedrooms, amount: null }));
      await send('/api/accounting/cleaning-costs', { vendorName: vendorName.trim() || undefined, rates: [...rows.map(r => ({ bedrooms: r.bedrooms, amount: r.amount === '' ? null : Number(r.amount) })), ...removed] }, 'PUT');
      await qc.invalidateQueries({ queryKey: ['cleaning-costs'] });
      toast({ title: 'Cleaning rate card saved', description: 'Applies to cleans completed from now on. Already recorded costs are not changed.' });
    } catch (e) { toast({ title: 'Could not save the rate card', description: (e as Error).message, variant: 'destructive' }); }
    finally { setSaving(false); }
  }
  async function runBackfill(dryRun: boolean) {
    setBusy(true);
    try {
      const result = await send('/api/accounting/cleaning-expenses/backfill', { days: 30, dryRun });
      setPreview(result);
      if (!dryRun) { await qc.invalidateQueries(); toast({ title: `${result.recorded} cleaning ${result.recorded === 1 ? 'expense' : 'expenses'} recorded` }); }
    } catch (e) { toast({ title: dryRun ? 'Could not preview' : 'Could not record expenses', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  const nextSize = rows.length ? Math.max(...rows.map(r => r.bedrooms)) + 1 : 0;
  const money = (n: number | null, c: string | null) => n == null ? '—' : `${c || 'AED'} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return <Card><CardContent className="pt-4 pb-4 space-y-4">
    <div>
      <h3 className="font-semibold text-sm">Cleaning company costs</h3>
      <p className="text-xs text-muted-foreground mt-0.5">What the cleaning company charges the company per checkout clean, by unit size. Recorded automatically as a company expense when a checkout clean is first marked completed (once per clean). A property’s “Cleaning cost override” below replaces the rate card for that property. The cleaning fee charged on bookings stays company income.</p>
    </div>
    {isLoading ? <p className="text-sm">Loading…</p> : error ? <p role="alert" className="text-sm text-red-600">{(error as Error).message}</p> : <>
      <label className="block text-xs max-w-sm">Cleaning company (payee)<Input value={vendorName} onChange={e => setVendorName(e.target.value)} /></label>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {rows.map((r, i) => <div key={r.bedrooms}>
          <label className="text-xs block mb-1">{label(r.bedrooms)} ({data.rates.find((x: any) => x.bedrooms === r.bedrooms)?.currency ?? 'AED'})</label>
          <div className="flex gap-1"><Input type="number" min="0" step="1" value={r.amount} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
            {i === rows.length - 1 && rows.length > 1 && <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${label(r.bedrooms)} rate`} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</Button>}</div>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {nextSize <= 20 && <Button type="button" variant="outline" size="sm" onClick={() => setRows(rs => [...rs, { bedrooms: nextSize, amount: '' }])}>Add {label(nextSize)} rate</Button>}
        <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rate card'}</Button>
      </div>
      <div className="border-t pt-3 space-y-2">
        <p className="text-sm font-medium">Record cleaning costs for the last 30 days</p>
        <p className="text-xs text-muted-foreground">For every checkout in the last 30 days (Dubai dates) that has a checkout clean and no cleaning cost yet. Preview first; recording is safe to repeat and never creates duplicates. Recording needs an administrator.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => runBackfill(true)}>Preview</Button>
          {preview?.dryRun && preview.toRecord > 0 && <Button type="button" size="sm" disabled={busy} onClick={() => runBackfill(false)}>Record {preview.toRecord} {preview.toRecord === 1 ? 'expense' : 'expenses'}</Button>}
        </div>
        {preview && <div className="text-xs space-y-2">
          <p>{preview.from} to {preview.to} · {preview.dryRun ? 'Preview' : `Recorded ${preview.recorded}`} · to record {preview.toRecord} · already recorded {preview.alreadyRecorded} · skipped {preview.skipped}{preview.totals.length ? ` · total ${preview.totals.map((t: any) => money(t.amount, t.currency)).join(', ')}` : ''}</p>
          {preview.items.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left min-w-[520px]"><thead><tr className="border-b"><th className="py-1 pr-2">Property</th><th className="pr-2">Checkout</th><th className="pr-2">Unit</th><th className="pr-2">Amount</th><th>Status</th></tr></thead>
            <tbody>{preview.items.map((i: any) => <tr key={`${i.reservationId}-${i.taskId}`} className="border-b last:border-0"><td className="py-1 pr-2">{i.property}</td><td className="pr-2">{i.checkout}</td><td className="pr-2">{i.unitSize}</td><td className="pr-2">{money(i.amount, i.currency)}</td><td>{i.action === 'record' ? (preview.dryRun ? 'Will record' : 'Recorded') : i.action === 'already recorded' ? 'Already recorded' : `Skipped: ${i.reason}`}</td></tr>)}</tbody></table></div>}
        </div>}
      </div>
    </>}
  </CardContent></Card>;
}
