#!/usr/bin/env node
// One-off, idempotent data fix from Raju's Airbnb booking verification (12 Oct 2026,
// /workspace/yallapms/booking_verification_2026-10-12.csv), only the fixes Clifford approved:
//   1. Green Lawn, Grey House and Lakeside -> ZAR (Garden Retreat stays AED)
//   2. Lakeside management fee -> 0 %
//   3. Lofts West unit 306 -> 603
//   4. Gross and Airbnb host fee on the 31 matched bookings (booking is then calculated by the app, "Verified")
//   5. Guest name on HMPZ825599 -> Lukona Aureto Masoka
//   6. Add HMYR4DCJ88 (Lakeside, 10-13 Sep, payout 3,719.24 ZAR) and the 7 past cancelled stays
// NOT included (need Clifford): HMQSK24ZRT payout, the 0.02 on HMXPZK9MAS, the 209.23 earnings line,
// the future cancellations HM8JBZ4SJ2 and HMXQ595JE3.
// Optional, only with --fee-rule: Clifford's fee rule (fee basis "net payout": 15 %, Lofts West 10 %, Lakeside 0 %)
// on every property that is not already on it, except properties with VAT or tourism fee on (the app's net-payout
// basis refuses those; they are listed for Clifford). Run it BEFORE the bookings are filled so they are calculated on it.
//
// Everything goes through the app's own API (same validation, currency guard, audit log); re-running changes
// nothing that is already right. Back up .local-data first. Usage, with the app running:
//   YALLA_EMAIL=... YALLA_PASSWORD=... node scripts/fix-booking-verification-2026-10-12.mjs [--dry-run] [--fee-rule]
// API_BASE defaults to http://127.0.0.1:3002/api.
const B = process.env.API_BASE || "http://127.0.0.1:3002/api";
const DRY = process.argv.includes("--dry-run"), FEE_RULE = process.argv.includes("--fee-rule");
if (!process.env.YALLA_EMAIL || !process.env.YALLA_PASSWORD) { console.error("Set YALLA_EMAIL and YALLA_PASSWORD"); process.exit(2); }

// [code, PMS id on 4 Oct, gross, Airbnb host fee] in the property's currency (Airbnb's figures).
const FILLS = [
  ["HMD5HQR44K", 32, "78.40", "2.47"],
  ["HMCAW2CS5J", 30, "1222.80", "217.96"],
  ["HM2YYYBBPF", 31, "1030.72", "32.47"],
  ["HMKWRS5BN5", 28, "3186.00", "109.92"],
  ["HM423JZTWH", 29, "259.70", "8.18"],
  ["HM2QWAXMYW", 27, "2000.00", "325.50"],
  ["HM2N22NMN2", 26, "83.30", "13.56"],
  ["HMWA8THBRD", 25, "94.00", "15.30"],
  ["HMSAJD849E", 24, "443.94", "72.25"],
  ["HM554K5BXQ", 22, "5359.20", "955.28"],
  ["HMRDFYK8MX", 23, "10188.20", "1658.13"],
  ["HMMQ8J4TPK", 21, "235.20", "38.28"],
  ["HMBJA9WXZP", 20, "8740.80", "1558.04"],
  ["HMJBBW88BD", 17, "1830.00", "297.83"],
  ["HM5RWTSNE2", 15, "9713.72", "1731.47"],
  ["HMZWZDR84C", 16, "132.30", "21.54"],
  ["HM38E49CQJ", 14, "132.30", "21.54"],
  ["HMM8WMFPJF", 11, "2730.00", "444.31"],
  ["HMDQKCWB92", 13, "274.40", "44.66"],
  ["HMYFHE8FMC", 10, "341.00", "55.50"],
  ["HMSJ9PPDRR", 9, "2543.80", "453.43"],
  ["HM2K29ST89", 8, "348.88", "56.78"],
  ["HM92FHCHNC", 6, "1069.00", "36.88"],
  ["HMXPZK9MAS", 7, "14356.12", "2336.46"],
  ["HMQ5BNF2Y8", 5, "242.00", "39.39"],
  ["HMY395Q29B", 4, "4245.69", "756.79"],
  ["HMWYJYHHTY", 1, "3352.00", "545.54"],
  ["HMEPQYME4Q", 3, "389.06", "63.32"],
  ["HMJR5FQD9F", 78, "3879.00", "691.44"],
  ["HMPZ825599", 1081, "249.90", "40.67"],
  ["HMA4F2MW5B", 79, "8803.44", "1569.21"]
];
const ZAR = [/^Lakeside 3BR/, /^The Green Lawn House/, /^The Grey House/];
// Past cancelled stays Airbnb lists that are not in PMS. [code, property, guest, check-in, check-out]
const CANCELLED = [
  ["HM5KSMSH3C", /^The Green Lawn House/, "Nolitha", "2026-09-24", "2026-09-26"],
  ["HMCDDKE8W3", /^The Green Lawn House/, "Yamkela", "2026-09-24", "2026-09-27"],
  ["HM4RZ9HPPA", /^The Grey House/, "Thithiba", "2026-09-26", "2026-09-28"],
  ["HMH4HEMRCR", /^The Green Lawn House/, "Jochen", "2026-09-25", "2026-09-29"],
  ["HM5MWJX4T2", /^Sea View 1BR/, "Shanay Michelle", "2026-10-01", "2026-10-05"],
  ["HMDFWTHKJH", /^The Green Lawn House/, "Simamkele", "2026-10-10", "2026-10-12"],
  ["HM2E8HQ9KR", /^Sea View 1BR/, "Louisa", "2026-10-19", "2026-11-02"],
];
const NEVER = ["HMQSK24ZRT", "HM8JBZ4SJ2", "HMXQ595JE3"];

let token; const log = [];
async function api(route, method = "GET", body) {
  const r = await fetch(B + route, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status >= 400) throw new Error(`${method} ${route} -> ${r.status}: ${typeof j === "string" ? j : j.error ?? JSON.stringify(j)}`);
  return j;
}
const did = (what) => { log.push(what); console.log((DRY ? "WOULD " : "") + what); };
const write = async (what, route, method, body) => { did(what); if (!DRY) return api(route, method, body); };
const eq2 = (a, b) => a != null && a !== "" && Number(a).toFixed(2) === Number(b).toFixed(2);

token = (await api("/auth/login", "POST", { email: process.env.YALLA_EMAIL, password: process.env.YALLA_PASSWORD })).token;
const props = await api("/properties");
const find = re => { const p = props.filter(x => re.test(x.name)); if (p.length !== 1) throw new Error(`expected one property for ${re}, found ${p.length}`); return p[0]; };
const settingsList = await api("/accounting/settings");
const settingsOf = async id => (Array.isArray(settingsList) ? settingsList : settingsList.settings ?? []).find(s => s.propertyId === id) ?? {};

// 1. Currencies (the app refuses if it would relabel recorded amounts; reported, nothing half-done).
for (const re of ZAR) { const p = find(re); if ((p.currency || "AED") !== "ZAR") await write(`${p.name}: currency ${p.currency || "AED"} -> ZAR`, `/properties/${p.id}`, "PATCH", { currency: "ZAR" }); }
// 2. Lakeside 0 %.
const lake = find(/^Lakeside 3BR/);
if (Number((await settingsOf(lake.id)).managementFeePercent) !== 0) await write(`${lake.name}: management fee -> 0 %`, `/accounting/settings/${lake.id}`, "PUT", { managementFeePercent: 0 });
// 3. Lofts West 603.
const lofts = find(/^The Lofts West/);
if (String(lofts.unitNumber ?? "").trim() !== "603") await write(`${lofts.name}: unit "${lofts.unitNumber}" -> "603"`, `/properties/${lofts.id}`, "PATCH", { unitNumber: "603" });
// Optional fee rule.
if (FEE_RULE) for (const p of props) {
  const want = p.id === lake.id ? 0 : p.id === lofts.id ? 10 : 15, s = await settingsOf(p.id);
  if (s.vatEnabled || s.tourismEnabled) { did(`SKIP fee rule on ${p.name}: VAT/tourism fee is on, and the app's net-payout basis does not support them (needs Clifford's decision)`); continue; }
  if (s.feeBasis !== "net-payout" || Number(s.managementFeePercent) !== want) await write(`${p.name}: fee ${s.managementFeePercent}% ${s.feeBasis} -> ${want}% net-payout`, `/accounting/settings/${p.id}`, "PUT", { feeBasis: "net-payout", managementFeePercent: want });
}

// Bookings by Airbnb code.
const all = await api("/reservations");
const byCode = new Map(all.filter(r => String(r.externalId ?? "").startsWith("airbnb:")).map(r => [r.externalId.slice(7), r]));
// 4. Gross + host fee -> calculated booking.
for (const [code, , gross, fee] of FILLS) {
  const r = byCode.get(code); if (!r) { did(`SKIP ${code}: not in PMS`); continue; }
  if (r.financeMode === "inclusive-v1" && eq2(r.grossAmount, gross) && eq2(r.channelFees, fee)) continue;
  try { await write(`${code} ${r.guestName}: gross ${gross}, Airbnb host fee ${fee}, calculate`, `/reservations/${r.id}`, "PATCH", { financeMode: "inclusive-v1", grossAmount: gross, channelFees: fee }); }
  catch (e) { did(`FAILED ${code}: ${e.message}`); process.exitCode = 1; }
}
// 5. Guest name.
{ const r = byCode.get("HMPZ825599"); if (r && r.guestName !== "Lukona Aureto Masoka") await write(`HMPZ825599: guest "${r.guestName}" -> "Lukona Aureto Masoka"`, `/reservations/${r.id}`, "PATCH", { guestName: "Lukona Aureto Masoka" }); }
// 6. Missing stays.
const add = async (code, p, body) => { if (byCode.has(code)) return; await write(`add ${code} ${body.guestName} ${body.checkIn}..${body.checkOut} ${body.status} at ${p.name}`, "/reservations", "POST", { propertyId: p.id, platform: "airbnb", externalId: `airbnb:${code}`, paymentStatus: "unknown", ...body }); };
await add("HMYR4DCJ88", lake, { guestName: "Tanya Van Niekerk", checkIn: "2026-09-10", checkOut: "2026-09-13", status: "checked_out", airbnbPayout: "3719.24", notes: "Airbnb HMYR4DCJ88. Imported 12 Oct 2026 from Raju's verification: Airbnb payout 3,719.24 ZAR (gross and host fee not in the files)." });
for (const [code, re, guestName, checkIn, checkOut] of CANCELLED) await add(code, find(re), { guestName, checkIn, checkOut, status: "cancelled", notes: `Airbnb ${code}, cancelled on Airbnb. Imported 12 Oct 2026 from Raju's verification.` });
for (const c of NEVER) if (log.some(l => l.includes(c))) throw new Error(`refusing: ${c} is not approved`);
console.log(`${DRY ? "DRY RUN: " : ""}${log.length} change(s)${log.length ? "" : " - already applied"}`);
