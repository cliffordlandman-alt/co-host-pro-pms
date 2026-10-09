// Lease P&L accruals from its cash cheques (YALLA rule 1, confirmed 9 Oct 2026).
// Each cheque covers `months` months, back to back from the lease start. Every month accrues the cheque amount
// divided by its months, rounded down to the cent; the cheque's last month takes the remainder, so the months of
// a cheque always add up to the cheque (28,750 → 9,583.33 / 9,583.33 / 9,583.34). Each accrual is dated on the
// lease's period day (the start date's day, e.g. the 8th) and covers that day to the day before the next period.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORD = ['', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
function minusDay(iso) { const t = new Date(Date.parse(iso + 'T00:00:00Z') - 86400000); return t.toISOString().slice(0, 10); }
const short = iso => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const cents = v => Math.round(Number(v || 0) * 100);
const fmt = c => (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** @returns {{date:string,month:string,from:string,to:string,amount:number,chequeSeq:number,chequeAmount:number,chequeDue:string,chequePaidOn:string|null,part:number,parts:number,description:string}[]} */
export function leaseAccruals(lease, cheques) {
  const out = [];
  let start = lease.startDate;
  for (const c of [...cheques].sort((a, b) => a.seq - b.seq)) {
    const n = Math.max(1, Number(c.months || 3)), total = cents(c.amount), each = Math.floor(total / n);
    for (let i = 0; i < n; i++) {
      const from = addMonths(start, i), to = minusDay(addMonths(start, i + 1));
      if (lease.endDate && from > lease.endDate) break;
      const amount = i === n - 1 ? total - each * (n - 1) : each;
      const paid = c.paidOn ? ` paid ${short(c.paidOn)}` : ` due ${short(c.dueDate)}`;
      out.push({ date: from, month: from.slice(0, 7), from, to, amount: amount / 100, chequeSeq: c.seq, chequeAmount: total / 100, chequeDue: c.dueDate, chequePaidOn: c.paidOn ?? null, part: i + 1, parts: n,
        description: `Rent ${short(from)}-${short(to)} (1/${n} of ${ORD[c.seq] ?? 'cheque ' + c.seq} cheque ${fmt(total)}${paid})` });
    }
    start = addMonths(start, n);
  }
  return out;
}

/** Cheques for a lease paid in equal instalments: annual rent / count, first on `firstDue`, then every 12/count months from the start. */
export function equalCheques(lease, count, firstDue) {
  const n = 12 / count, total = cents(lease.annualRent), each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({ seq: i + 1, months: n, amount: (i === count - 1 ? total - each * (count - 1) : each) / 100, dueDate: i === 0 ? firstDue : addMonths(lease.startDate, i * n), paidOn: null }));
}
