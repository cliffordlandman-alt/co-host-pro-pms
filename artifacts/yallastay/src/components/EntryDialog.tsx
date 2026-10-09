import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dubaiToday } from '@/lib/today-model';

/**
 * The one form for entering income or an expense by hand (used on the Company statement and the
 * Transactions tab). Booking revenue, management fees, owner payouts and automatic cleaning costs
 * are never entered here: they come from bookings and statements, so entering them again would
 * double-count.
 * With `entry`, the same form edits that entry in place (PATCH); the server applies the same rules,
 * keeps the before/after in the Activity Log, and refuses entries on a sent or paid owner statement.
 */
export const EXPENSE_CATEGORIES = ['Maintenance', 'Cleaning', 'Supplies', 'Utility', 'DEWA', 'Insurance', 'Municipality Fee', 'Agent commission', 'Transport', 'Software', 'Photography', 'Salary', 'Other'];
/** Accounting treatment (YALLA workbook). '' = follow "Charge to" (owner → owner paid, company → operating expense). */
export const TREATMENTS = [['', 'Follow "Charge to"'], ['company', 'Operating expense (company P&L)'], ['owner_paid', 'Owner paid (not company P&L)'], ['pass_through', 'Pass-through, e.g. DEWA (not company P&L)']] as const;
export const USD_AED = 3.6725;
export const INCOME_CATEGORIES = ['Additional income', 'Other'];
const CURRENCIES = ['AED', 'ZAR', 'USD', 'EUR', 'GBP'];

async function read(url: string) { const r = await apiFetch(url); if (!r.ok) throw new Error('Could not load'); return r.json(); }
const sel = 'block w-full border rounded p-2 bg-background';

/** Entries the system records itself (cleaning costs, maintenance charges); changed at their source. */
export const isAutomaticEntry = (t: any) => t?.cleaningTaskId != null || /^(cleaning|maintenance):/.test(t?.reference ?? '');

export function EntryDialog({ open, onOpenChange, defaultDate, entry }: { open: boolean; onOpenChange: (v: boolean) => void; defaultDate?: string; entry?: any }) {
  const today = dubaiToday();
  const empty = { date: defaultDate || today, type: 'expense', category: '', description: '', amount: '', currency: 'AED', propertyId: '', reservationId: '', allocation: 'company', revenueStream: '', reference: '', notes: '', treatment: '', paymentStatus: '', fxRate: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { data: bookings = [] } = useQuery({ queryKey: ['company-bookings'], queryFn: () => read('/api/reservations'), enabled: open });
  const { data: properties = [] } = useQuery({ queryKey: ['company-properties'], queryFn: () => read('/api/properties'), enabled: open });
  const fromEntry = (t: any) => ({ date: t.date, type: t.type, category: t.category || '', description: t.description || '', amount: String(t.amount ?? ''), currency: t.currency || 'AED', propertyId: t.propertyId != null ? String(t.propertyId) : '',
    reservationId: t.reservationId != null ? String(t.reservationId) : '', allocation: t.allocation || 'company', revenueStream: t.revenueStream == null ? '' : t.revenueStream ? 'yes' : 'no', reference: t.reference || '', notes: t.notes || '',
    treatment: t.treatment || '', paymentStatus: t.paymentStatus || '', fxRate: t.fxRate != null ? String(t.fxRate) : '' });
  useEffect(() => { if (open) { setForm(entry ? fromEntry(entry) : { ...empty, date: defaultDate || today }); setError(''); } }, [open, entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const property = properties.find((p: any) => String(p.id) === form.propertyId);
  const propertyCurrency = property?.currency || 'AED';
  const edit = (key: string, value: string) => setForm(f => {
    const next = { ...f, [key]: value };
    if (key === 'type') { next.category = ''; if (value === 'income') { next.allocation = 'company'; next.revenueStream = ''; } }
    // A property's costs are in its own currency (owner charges must be); follow it when a property is picked.
    if (key === 'propertyId') { const p = properties.find((x: any) => String(x.id) === value); if (p) next.currency = p.currency || 'AED'; if (!value) next.allocation = 'company'; }
    if (key === 'allocation' && value === 'owner' && property) next.currency = propertyCurrency;
    if (key === 'allocation') next.treatment = value === 'owner' ? 'owner_paid' : (f.treatment === 'owner_paid' ? '' : f.treatment);
    if (key === 'treatment') { if (value === 'owner_paid') next.allocation = 'owner'; else if (value) next.allocation = 'company'; }
    if (key === 'type' && value === 'income') next.treatment = '';
    // Salary: a company operating expense, never on a property or an owner statement.
    if (key === 'category' && value === 'Salary') { next.allocation = 'company'; next.treatment = 'company'; next.propertyId = ''; next.reservationId = ''; }
    if (key === 'currency') next.fxRate = value === 'USD' ? String(USD_AED) : '';
    return next;
  });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const body = { ...form, propertyId: form.propertyId ? Number(form.propertyId) : null, reservationId: form.reservationId ? Number(form.reservationId) : null,
        revenueStream: form.type === 'expense' && form.revenueStream ? form.revenueStream === 'yes' : null, reference: form.reference || null, notes: form.notes || null,
        treatment: form.type === 'expense' && form.treatment ? form.treatment : null, paymentStatus: form.paymentStatus || null, fxRate: ['AED', 'ZAR'].includes(form.currency) || !form.fxRate ? null : Number(form.fxRate) };
      const r = await apiFetch(entry ? `/api/accounting/transactions/${entry.id}` : '/api/accounting/transactions', { method: entry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Could not save entry'); }
      await qc.invalidateQueries(); onOpenChange(false);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  const listed = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  // An older entry may carry a category that is no longer offered; keep it selectable when editing.
  const categories = form.category && !listed.includes(form.category) ? [form.category, ...listed] : listed;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{entry ? 'Edit entry' : 'Add income or expense'}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Type<select aria-label="Entry type" className={sel} value={form.type} onChange={e => edit('type', e.target.value)}><option value="expense">Expense</option><option value="income">Income (not from a booking)</option></select></label>
            <label className="text-sm">Date<Input required type="date" value={form.date} onChange={e => edit('date', e.target.value)} /></label>
          </div>
          <label className="block text-sm">Category<select aria-label="Category" required className={sel} value={form.category} onChange={e => edit('category', e.target.value)}><option value="" disabled>Choose a category</option>{categories.map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="block text-sm">Description<Input aria-label="Description" required maxLength={500} value={form.description} onChange={e => edit('description', e.target.value)} /></label>
          <label className="block text-sm">Property (optional)<select aria-label="Property" className={sel} value={form.propertyId} onChange={e => edit('propertyId', e.target.value)}><option value="">General company entry (no property)</option>{properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block text-sm">Charge to<select aria-label="Charge to" className={sel} value={form.allocation} onChange={e => edit('allocation', e.target.value)}><option value="company">Company</option><option value="owner" disabled={form.type === 'income' || !form.propertyId}>Property owner (on the owner statement)</option></select>
            <span className="block text-xs text-muted-foreground mt-1">{form.type === 'income' ? 'Income entered here is company income.' : !form.propertyId ? 'Pick a property to charge its owner.' : form.allocation === 'owner' ? 'Deducted from the owner\u2019s payout on that month\u2019s statement.' : 'A company cost for this property; the owner is not charged.'}</span></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Amount<Input aria-label="Amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={e => edit('amount', e.target.value)} /></label>
            <label className="text-sm">Currency<select aria-label="Currency" className={sel} value={form.currency} disabled={form.allocation === 'owner'} onChange={e => edit('currency', e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
          </div>
          {form.type === 'expense' && (
            <label className="block text-sm">Revenue stream?<select aria-label="Revenue stream" className={sel} value={form.revenueStream} onChange={e => edit('revenueStream', e.target.value)}><option value="">Not tagged</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          )}
          {form.type === 'expense' && (
            <label className="block text-sm">Accounting treatment<select aria-label="Accounting treatment" className={sel} value={form.treatment} disabled={form.category === 'Salary'} onChange={e => edit('treatment', e.target.value)}>{TREATMENTS.map(([v, l]) => <option key={v} value={v} disabled={v === 'owner_paid' && !form.propertyId}>{l}</option>)}</select>
              <span className="block text-xs text-muted-foreground mt-1">{form.category === 'Salary' ? 'Salary is always a company operating expense.' : form.treatment === 'pass_through' ? 'Shown on the workbook but left out of company income and expenses.' : 'Used by the monthly finance workbook export.'}</span></label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Payment status<select aria-label="Payment status" className={sel} value={form.paymentStatus} onChange={e => edit('paymentStatus', e.target.value)}><option value="">Paid</option><option value="pending">Pending</option><option value="unpaid">Unpaid</option></select></label>
            {form.currency !== 'AED' && (
              <label className="text-sm">Rate to AED<Input aria-label="Rate to AED" type="number" step="0.0001" min="0" value={form.currency === 'ZAR' ? '' : form.fxRate} disabled={form.currency === 'USD' || form.currency === 'ZAR'} placeholder={form.currency === 'ZAR' ? 'ZAR is kept separate' : ''} onChange={e => edit('fxRate', e.target.value)} />
                <span className="block text-xs text-muted-foreground mt-1">{form.currency === 'USD' ? 'USD is fixed at 3.6725.' : form.currency === 'ZAR' ? 'Never converted to AED.' : 'Optional.'}</span></label>
            )}
          </div>
          <label className="block text-sm">Booking (optional)<select aria-label="Booking" className={sel} value={form.reservationId} onChange={e => { const b = bookings.find((b: any) => b.id === Number(e.target.value)); setForm(f => ({ ...f, reservationId: e.target.value, propertyId: b ? String(b.propertyId) : f.propertyId, currency: b ? (b.currency || properties.find((p: any) => p.id === b.propertyId)?.currency || f.currency) : f.currency })); }}><option value="">No specific booking</option>{bookings.filter((b: any) => !form.propertyId || b.propertyId === Number(form.propertyId)).map((b: any) => <option key={b.id} value={b.id}>{b.guestName} · {b.checkIn}</option>)}</select></label>
          <label className="block text-sm">Reference (optional)<Input value={form.reference} onChange={e => edit('reference', e.target.value)} placeholder="Invoice or receipt number" /></label>
          <label className="block text-sm">Notes (optional)<Input value={form.notes} onChange={e => edit('notes', e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Enter only amounts that are not already recorded. Booking revenue, management fees, booking cleaning fees and automatic cleaning costs come from bookings: don't enter them again here.</p>
          {entry && <p className="text-xs text-muted-foreground">Changes are saved to this entry and recorded in the Activity Log with the old and new values.</p>}
          {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
          <Button type="submit" disabled={saving} className="w-full sm:w-auto">{saving ? 'Saving…' : entry ? 'Save changes' : 'Save entry'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
