#!/usr/bin/env node
// Record cleaning-company costs for all checkouts in the last N days or one month (Dubai dates).
// Works against any running YallaPMS API (local or production); preview is the default.
//
//   BASE=https://your-yallapms-host EMAIL=admin@example.com PASSWORD=... node scripts/backfill-cleaning-expenses.mjs            # preview
//   BASE=... EMAIL=... PASSWORD=... node scripts/backfill-cleaning-expenses.mjs --apply    # record (administrator only)
//   Options: --days=30 (1-366) or --month=2026-09. TOKEN=... may be used instead of EMAIL/PASSWORD.
// Safe to repeat: each checkout gets at most one cleaning expense. Properties with no rate set are listed as skipped.
const base = (process.env.BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const apply = process.argv.includes('--apply');
const days = Number((process.argv.find(a => a.startsWith('--days=')) || '--days=30').slice(7));
const month = (process.argv.find(a => a.startsWith('--month=')) || '').slice(8) || undefined;
async function main() {
  let token = process.env.TOKEN;
  if (!token) {
    if (!process.env.EMAIL || !process.env.PASSWORD) throw new Error('Set EMAIL and PASSWORD (or TOKEN) for an administrator account');
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || `Login failed (${r.status})`); token = d.token;
  }
  const r = await fetch(`${base}/api/accounting/cleaning-expenses/backfill`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(month ? { month, dryRun: !apply } : { days, dryRun: !apply }) });
  const res = await r.json(); if (!r.ok) throw new Error(res.error || `Request failed (${r.status})`);
  const pad = (v, n) => String(v ?? '').padEnd(n).slice(0, n);
  console.log(`${res.dryRun ? 'DRY RUN (nothing recorded)' : 'RECORDED'} · checkouts ${res.from} to ${res.to} (Dubai) · payee: ${res.vendor ?? 'none'}`);
  console.log(`${pad('Property', 34)} ${pad('Checkout', 10)} ${pad('Unit', 7)} ${pad('Amount', 13)} Status`);
  for (const i of res.items) console.log(`${pad(i.property, 34)} ${pad(i.checkout, 10)} ${pad(i.unitSize, 7)} ${pad(i.amount == null ? '-' : `${i.currency} ${i.amount.toFixed(2)}`, 13)} ${i.action === 'record' ? (res.dryRun ? 'will record' : 'recorded') : i.action === 'already recorded' ? 'already recorded' : `${i.noRate ? 'SKIPPED, NO RATE SET' : 'skipped'}: ${i.reason}`}`);
  console.log(`To record: ${res.toRecord} · already recorded: ${res.alreadyRecorded} · skipped: ${res.skipped} (no rate set: ${res.noRateSet ?? 0}) · total: ${res.totals.map(t => `${t.currency} ${t.amount.toFixed(2)}`).join(', ') || '0'}${res.dryRun ? '' : ` · recorded now: ${res.recorded}`}`);
}
main().catch(e => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
