// Income per property: shared types, formatting and month helpers. Every figure is computed by the server
// (GET /api/reports/income, the owner-statement calculation); nothing here recalculates money.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { formatAed } from "@/lib/aed-book";

export type IncomeRow = { currency: string; bookings: number; nights: number; gross: number; taxes: number; channelFees: number; cleaning: number; expenses: number; managementFee: number;
  ownerShare: number; paidByAirbnb: number; ownerBalance: number; companyIncome: number; companyCosts: number; companyNet: number };
export type Unverified = { count: number; nights: number; withoutAmount: number; estimates: { currency: string; amount: number }[] };
export type IncomeProperty = { propertyId: number; name: string; unitNumber: string | null; currency: string; ownerName: string | null; hasOwner: boolean;
  occupancy: { nights: number; days: number; percent: number }; rows: IncomeRow[]; unverified: Unverified; estimate: boolean;
  statement: { status: "none" | "draft" | "sent" | "paid" | "duplicate"; id?: number } | { published: number; drafts: number }; held: string | null };
export type IncomeTotal = IncomeRow & { properties: number; unverifiedBookings: number; unverifiedEstimate: number };
export type IncomeReport = { period: { kind: "month" | "year"; month?: string; year?: string; start: string; end: string; days: number }; properties: IncomeProperty[]; totals: IncomeTotal[];
  companyOther: { currency: string; income: number; costs: number; net: number }[] };
export type Period = { month: string } | { year: string };

export const dubaiMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
export const shiftMonth = (m: string, by: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1)); return d.toISOString().slice(0, 7); };
export const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
export const shortMonth = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
export const periodLabel = (p: Period) => "month" in p ? monthLabel(p.month) : `Year ${p.year}`;
export const periodQuery = (p: Period) => "month" in p ? `month=${p.month}` : `year=${p.year}`;
export function money(v: number | null | undefined, currency: string, decimals = 2, date?: string | null) {
  if (v == null) return "–";
  const text = formatAed(v, currency, date, decimals);
  return text === "—" ? "–" : text;
}
export const hasFigures = (r: IncomeRow) => r.bookings > 0 || [r.gross, r.cleaning, r.expenses, r.managementFee, r.ownerShare, r.companyIncome, r.companyCosts].some(v => v !== 0);
export const estimateText = (u: Unverified) => u.estimates.map(e => money(e.amount, e.currency)).join(" + ");

async function read(url: string) {
  const r = await apiFetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`) as Error & { status?: number }; e.status = r.status; throw e; }
  return d;
}
export function useIncome(p: Period, enabled = true) {
  return useQuery<IncomeReport>({ queryKey: ["income", periodQuery(p)], enabled, retry: false, staleTime: 30000, queryFn: () => read(`/api/reports/income?${periodQuery(p)}`) });
}
export function useIncomeDetail(id: number, p: Period) {
  return useQuery<any>({ queryKey: ["income-detail", id, periodQuery(p)], retry: false, queryFn: () => read(`/api/reports/income/${id}?${periodQuery(p)}`) });
}
/** Period from the address bar (?month= or ?year=), else the current Dubai month. */
export function periodFromSearch(search: string): Period {
  const q = new URLSearchParams(search);
  if (/^20\d\d$/.test(q.get("year") || "")) return { year: q.get("year")! };
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(q.get("month") || "")) return { month: q.get("month")! };
  return { month: dubaiMonth() };
}
