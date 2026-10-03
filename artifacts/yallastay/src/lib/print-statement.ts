/**
 * Printable owner statement: opens a clean page with only the statement (no app menus) and the browser's
 * print dialog, where "Save as PDF" makes the file. Nothing is sent anywhere.
 */
import { statementBalance, feeLabels } from "./statement-balance.ts";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number, c: string) => `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function statementHtml(stmt: any, ownerLines: any[], company = "YallaStay Holiday Homes") {
  const c = stmt.currency || "AED";
  const monthLabel = new Date(`${stmt.month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  let bookings: any[] = [];
  try { bookings = typeof stmt.bookingDetails === "string" ? JSON.parse(stmt.bookingDetails) : stmt.bookingDetails || []; } catch { bookings = []; }
  const bal = statementBalance(stmt);
  const fl = feeLabels(stmt);
  const row = (label: string, value: number, minus = true, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${minus ? "− " : ""}${esc(money(value, c))}</td></tr>`;
  const lines = [
    row("Gross revenue (guest totals)", stmt.grossRevenue, false),
    stmt.platformFees > 0 ? row(fl.platform, stmt.platformFees) : "",
    fl.netBasis ? `<tr class="share"><td>Net payout (guest total − channel fees)</td><td class="r">${esc(money(stmt.grossRevenue - stmt.platformFees, c))}</td></tr>` : "",
    row(fl.management, stmt.managementFee),
    stmt.cleaningCosts > 0 ? row("Cleaning", stmt.cleaningCosts) : "",
    stmt.maintenanceCosts > 0 ? row("Maintenance", stmt.maintenanceCosts) : "",
    stmt.otherExpenses > 0 ? row("Expenses charged to owner", stmt.otherExpenses) : "",
    ...ownerLines.map(l => `<tr class="sub"><td>${esc(l.date)} · ${esc(l.description)} (${esc(l.category)})</td><td class="r">− ${esc(money(l.amount, l.currency || c))}</td></tr>`),
    stmt.tourismFee > 0 ? row("Tourism fee", stmt.tourismFee) : "",
    stmt.vatAmount > 0 ? row("VAT", stmt.vatAmount) : "",
    bal.hasCohost ? `<tr class="share"><td>Owner share</td><td class="r">${esc(money(bal.ownerShare, c))}</td></tr>` : "",
    bal.hasCohost ? row("Already paid to owner by Airbnb (co-host payout)", bal.paidByAirbnb) : "",
    bal.settled ? `<tr class="total"><td>${esc(bal.label)}</td><td class="r">Nothing owed</td></tr><tr class="sub"><td>Rounding difference, not paid either way</td><td class="r">${esc(money(bal.amount, c))}</td></tr>`
      : `<tr class="total"><td>${esc(bal.label)}</td><td class="r">${esc(money(bal.amount, c))}</td></tr>`,
  ].join("");
  const bookingRows = bookings.map(b => `<tr><td>${esc(b.guestName)}</td><td>${esc(b.checkIn)} → ${esc(b.checkOut)}</td><td>${esc(b.platform)}</td><td class="r">${esc(money(Number(b.grossAmount), c))}</td><td class="r">${esc(money(Number(b.ownerAmount), c))}</td>${bal.hasCohost ? `<td class="r">${b.cohostPayout == null ? "–" : esc(money(Number(b.cohostPayout), c))}</td>` : ""}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owner statement · ${esc(stmt.propertyName)} · ${esc(monthLabel)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:32px;font-size:13px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:24px 0 8px}
.muted{color:#4b5563}table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}.r{text-align:right;white-space:nowrap}
tr.share td{font-weight:600;border-top:1px solid #9ca3af}tr.sub td{font-size:11px;color:#4b5563;padding-left:16px}tr.total td{font-weight:700;font-size:15px;border-top:2px solid #111827;border-bottom:none}.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:16px}
@media print{body{margin:12mm}}</style></head><body>
<div class="head"><div><h1>Owner statement</h1><div class="muted">${esc(company)}</div></div><div class="r"><strong>${esc(monthLabel)}</strong><div class="muted">Status: ${esc(stmt.status)}</div></div></div>
<p><strong>Property:</strong> ${esc(stmt.propertyName)}<br><strong>Owner:</strong> ${esc(stmt.ownerName || "—")}<br><strong>Bookings:</strong> ${esc(stmt.bookingsCount)} · ${esc(stmt.nightsOccupied)} nights</p>
<table>${lines}</table>
${bookingRows ? `<h2>Bookings recognised in this month (by checkout date)</h2><table><thead><tr><th>Guest</th><th>Dates</th><th>Channel</th><th class="r">Guest total</th><th class="r">Owner share</th>${bal.hasCohost ? `<th class="r">Paid by Airbnb</th>` : ""}</tr></thead><tbody>${bookingRows}</tbody></table>` : ""}
<p class="muted" style="margin-top:24px">Revenue is recognised in the checkout month. VAT and tourism fees are included in guest totals and shown as deductions.</p>
</body></html>`;
}

export function printStatement(stmt: any, ownerLines: any[]) {
  const w = window.open("", "_blank");
  if (!w) { window.alert("Allow pop-ups for this site to print or save the statement as PDF."); return; }
  w.document.open(); w.document.write(statementHtml(stmt, ownerLines)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
}
