// How a statement's bottom line and fee lines read (statement card, printable statement, owner portal).
// ownerPayout is the balance after everything, including co-host payouts Airbnb already paid the owner directly
// (paidByAirbnb). A negative balance is never shown as a bare negative ("Owner owes company"); with co-host
// payouts, a balance under 1.00 either way is rounding: "Settled (rounding)".
export type BalanceView = { hasCohost: boolean; ownerShare: number; paidByAirbnb: number; owes: boolean; settled: boolean; amount: number; label: string; short: string };

export function statementBalance(stmt: { ownerPayout: number; paidByAirbnb?: number | null }, audience: "company" | "owner" = "company"): BalanceView {
  const paidByAirbnb = Number(stmt.paidByAirbnb || 0);
  const balance = Number(stmt.ownerPayout || 0);
  const hasCohost = Math.round(paidByAirbnb * 100) !== 0;
  const settled = hasCohost && Math.abs(Math.round(balance * 100)) < 100;
  const owes = !settled && Math.round(balance * 100) < 0;
  const label = settled ? "Settled (rounding)" : audience === "owner"
    ? owes ? "You owe the company" : hasCohost ? "Balance due to you" : "Your payout"
    : owes ? "Owner owes company" : hasCohost ? "Balance due to owner" : "Owner payout";
  const short = settled ? "Settled" : audience === "owner" ? (owes ? "You owe" : hasCohost ? "Due to you" : "Payout") : (owes ? "Owner owes" : hasCohost ? "Due to owner" : "Payout");
  return { hasCohost, ownerShare: Math.round((balance + paidByAirbnb) * 100) / 100, paidByAirbnb, owes, settled, amount: Math.abs(balance), label, short };
}

/** Labels for the fee lines: on the net-payout basis the channel line is the actual fees and management is X% of the net payout. */
export function feeLabels(stmt: { feeBasis?: string | null; bookingDetails?: unknown }) {
  if (stmt.feeBasis !== "net-payout") return { netBasis: false, platform: "Platform fees", management: "Management fee" };
  let rows: any[] = [];
  try { rows = typeof stmt.bookingDetails === "string" ? JSON.parse(stmt.bookingDetails) : Array.isArray(stmt.bookingDetails) ? stmt.bookingDetails : []; } catch { rows = []; }
  const pcts = [...new Set(rows.map(r => r.managementPercent).filter(v => v != null).map(v => Number(v)))];
  return { netBasis: true, platform: "Channel fees (actual)", management: pcts.length === 1 ? `Management fee (${pcts[0]}% of net payout)` : "Management fee (% of net payout)" };
}
