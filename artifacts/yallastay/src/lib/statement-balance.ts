// How a statement's bottom line reads. ownerPayout is the balance after everything, including co-host payouts
// Airbnb already paid the owner directly (paidByAirbnb). A negative balance is never shown as a bare negative:
// it is "Owner owes company".
export type BalanceView = { hasCohost: boolean; ownerShare: number; paidByAirbnb: number; owes: boolean; amount: number; label: string; short: string };

export function statementBalance(stmt: { ownerPayout: number; paidByAirbnb?: number | null }, audience: "company" | "owner" = "company"): BalanceView {
  const paidByAirbnb = Number(stmt.paidByAirbnb || 0);
  const balance = Number(stmt.ownerPayout || 0);
  const owes = Math.round(balance * 100) < 0;
  const hasCohost = Math.round(paidByAirbnb * 100) !== 0;
  const label = audience === "owner"
    ? owes ? "You owe the company" : hasCohost ? "Balance due to you" : "Your payout"
    : owes ? "Owner owes company" : hasCohost ? "Balance due to owner" : "Owner payout";
  const short = audience === "owner" ? (owes ? "You owe" : hasCohost ? "Due to you" : "Payout") : (owes ? "Owner owes" : hasCohost ? "Due to owner" : "Payout");
  return { hasCohost, ownerShare: Math.round((balance + paidByAirbnb) * 100) / 100, paidByAirbnb, owes, amount: Math.abs(balance), label, short };
}
