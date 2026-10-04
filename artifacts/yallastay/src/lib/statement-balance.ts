// How a statement's bottom line and fee lines read (statement card, printable statement, owner portal).
// ownerPayout is the balance after everything, including what Airbnb already paid the owner directly
// (paidByAirbnb: a co-host payout, or the whole host payout on the "Airbnb pays the owner" setting). A negative
// balance is never shown as a bare negative ("Owner owes company"). With Airbnb paying the owner, a balance of
// exactly 0 is "Nothing owed" and a balance under 1.00 either way is rounding: "Settled (rounding)".
export type BalanceView = { hasCohost: boolean; ownerShare: number; paidByAirbnb: number; owes: boolean; settled: boolean; rounding: boolean; amount: number; label: string; short: string };

export function statementBalance(stmt: { ownerPayout: number; paidByAirbnb?: number | null }, audience: "company" | "owner" = "company"): BalanceView {
  const paidByAirbnb = Number(stmt.paidByAirbnb || 0);
  const balance = Number(stmt.ownerPayout || 0);
  const hasCohost = Math.round(paidByAirbnb * 100) !== 0;
  const settled = hasCohost && Math.abs(Math.round(balance * 100)) < 100;
  const rounding = settled && Math.round(balance * 100) !== 0;
  const owes = !settled && Math.round(balance * 100) < 0;
  const label = settled ? (rounding ? "Settled (rounding)" : "Settled") : audience === "owner"
    ? owes ? "You owe the company" : hasCohost ? "Balance due to you" : "Your payout"
    : owes ? "Owner owes company" : hasCohost ? "Balance due to owner" : "Owner payout";
  const short = settled ? "Settled" : audience === "owner" ? (owes ? "You owe" : hasCohost ? "Due to you" : "Payout") : (owes ? "Owner owes" : hasCohost ? "Due to owner" : "Payout");
  return { hasCohost, ownerShare: Math.round((balance + paidByAirbnb) * 100) / 100, paidByAirbnb, owes, settled, rounding, amount: Math.abs(balance), label, short };
}

function details(stmt: { bookingDetails?: unknown }): any[] {
  try { return typeof stmt.bookingDetails === "string" ? JSON.parse(stmt.bookingDetails) : Array.isArray(stmt.bookingDetails) ? stmt.bookingDetails : []; } catch { return []; }
}

/** Labels for the statement lines, by the property's fee basis:
 *  gross: guest totals, platform fee %, management %;
 *  net-payout: channel line = Airbnb's actual fees, management = X% of the net payout;
 *  airbnb-payout: Airbnb's host figures (gross earnings, Airbnb fees = gross − payout, management = X% of the payout). */
export function feeLabels(stmt: { feeBasis?: string | null; bookingDetails?: unknown }, audience: "company" | "owner" = "company") {
  const pcts = [...new Set(details(stmt).map(r => r.managementPercent).filter(v => v != null).map(v => Number(v)))];
  const you = audience === "owner";
  if (stmt.feeBasis === "airbnb-payout") return { netBasis: false, payoutBasis: true, wholePayout: true, gross: "Airbnb gross earnings (accommodation + cleaning)", platform: "Airbnb fees (gross − payout)", net: "Payout from Airbnb",
    management: pcts.length === 1 ? `Management fee (${pcts[0]}% of the Airbnb payout)` : "Management fee (% of the Airbnb payout)", paidByAirbnb: `Already paid to ${you ? "you" : "owner"} by Airbnb (whole payout)` };
  const whole = details(stmt).some(r => r.paidToOwnerByAirbnb);
  const paidByAirbnb = `Already paid to ${you ? "you" : "owner"} by Airbnb (${whole ? "whole payout" : "co-host payout"})`;
  if (stmt.feeBasis !== "net-payout") return { netBasis: false, payoutBasis: false, wholePayout: whole, gross: "Gross revenue (guest totals)", platform: "Platform fees", net: null as string | null, management: "Management fee", paidByAirbnb };
  return { netBasis: true, payoutBasis: false, wholePayout: whole, gross: "Gross revenue (guest totals)", platform: "Channel fees (actual)", net: "Net payout (guest total − channel fees)",
    management: pcts.length === 1 ? `Management fee (${pcts[0]}% of net payout)` : "Management fee (% of net payout)", paidByAirbnb };
}
