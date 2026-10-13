// Show-only currency conversion (13 Oct 2026, Clifford): Garden Retreat keeps its books in ZAR; reports add an AED
// equivalent beside the ZAR figures. Recorded amounts are never changed and AED-recorded money (e.g. Bonnita's
// AED 209.23) stays AED. Rate, source and date come from app setting "fx" and are printed with every converted figure.
export const FX_DEFAULT = { pairs: { 'ZAR>AED': { rate: 0.221987, source: 'ExchangeRate-API (open.er-api.com), ZAR base', asOf: '2026-10-12T23:57:31Z' } }, convertPropertyIds: [4] };
const FIELDS = ['gross', 'taxes', 'channelFees', 'cleaning', 'expenses', 'managementFee', 'ownerShare', 'paidByAirbnb', 'ownerBalance', 'netPayout', 'companyIncome', 'grossRevenue', 'platformFees', 'ownerPayout'];
export function aedEquivalent(row, fx = FX_DEFAULT) {
  const cur = row?.currency; if (!cur || cur === 'AED') return null;
  const p = fx.pairs?.[`${cur}>AED`]; if (!p) return null;
  const out = { currency: 'AED', from: cur, rate: p.rate, source: p.source, asOf: p.asOf };
  for (const f of FIELDS) if (typeof row[f] === 'number') out[f] = Math.round(row[f] * p.rate * 100) / 100;
  return out;
}
export function withAedEquivalents(report, fx = FX_DEFAULT) {
  const ids = new Set(fx.convertPropertyIds ?? []);
  const properties = (report.properties ?? []).map(p => ids.has(p.propertyId) ? { ...p, rows: (p.rows ?? []).map(r => r.currency && r.currency !== 'AED' ? { ...r, aedEquivalent: aedEquivalent(r, fx) } : r) } : p);
  return { ...report, properties, fx: { ...fx, note: 'AED equivalents are for display; recorded amounts stay in their own currency.' } };
}
