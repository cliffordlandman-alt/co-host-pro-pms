// Display-time conversion into UAE dirhams. Stored amounts and their currencies are never rewritten.
// US dollars use the Central Bank of the UAE peg (3.6725). Other currencies use the rate for the
// transaction date when one is available, otherwise the latest cached rate, otherwise the fallback below.

export const DISPLAY_CURRENCY = "AED";
export const USD_AED_PEG = 3.6725;

// Last-resort dirhams per 1 unit, used only when no cached rate and both rate sources fail.
// USD is the official peg. The others are a recent cross from that peg, replaced as soon as a fetch works.
export const FALLBACK_AED_PER_UNIT = {
  AED: 1,
  USD: USD_AED_PEG,
  EUR: 4.0982,
  GBP: 4.9116,
  ZAR: 0.2224,
};

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function monthEnd(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** YYYY-MM-DD, or the last day of YYYY-MM. */
export function asDate(date) {
  const s = String(date || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return monthEnd(s.slice(0, 7));
  return null;
}

export function fallbackBook() {
  return {
    displayCurrency: DISPLAY_CURRENCY,
    updatedAt: null,
    stale: true,
    pegUsdAed: USD_AED_PEG,
    latest: { ...FALLBACK_AED_PER_UNIT },
    byDate: {},
  };
}

/** Dirhams per 1 unit, from "units of currency per 1 USD" (ZAR: 16.5 means 1 USD buys 16.5 ZAR). */
export function aedPerUnitFromUsdCross(cross, peg = USD_AED_PEG) {
  const out = { AED: 1, USD: peg };
  for (const [cur, perUsd] of Object.entries(cross || {})) {
    const n = Number(perUsd);
    if (cur && cur !== "USD" && Number.isFinite(n) && n > 0) out[cur] = peg / n;
  }
  return out;
}

/** Same shape as an open latest-USD quote that also includes AED. */
export function aedPerUnitFromUsdQuote(rates) {
  const aed = Number(rates?.AED);
  if (!Number.isFinite(aed) || aed <= 0) return null;
  const out = { AED: 1, USD: aed };
  for (const [cur, perUsd] of Object.entries(rates || {})) {
    const n = Number(perUsd);
    if (cur === "AED" || cur === "USD" || !Number.isFinite(n) || n <= 0) continue;
    out[cur] = aed / n;
  }
  return out;
}

/** Dirhams per 1 unit of currency on that date (previous available day when the date itself has no rate). */
export function rateOn(book, currency, date) {
  const cur = String(currency || DISPLAY_CURRENCY).toUpperCase();
  if (cur === DISPLAY_CURRENCY) return 1;
  const day = asDate(date);
  const byDate = book?.byDate || {};
  if (day) {
    const dates = Object.keys(byDate).filter(d => d <= day);
    dates.sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      const rate = Number(byDate[dates[i]]?.[cur]);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  }
  const latest = Number(book?.latest?.[cur]);
  if (Number.isFinite(latest) && latest > 0) return latest;
  const fallback = Number(FALLBACK_AED_PER_UNIT[cur]);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

/** Convert one amount. AED (and a blank currency) is unchanged. Null stays null. */
export function toAed(amount, currency, date, book) {
  if (amount == null || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cur = String(currency || DISPLAY_CURRENCY).toUpperCase();
  if (cur === DISPLAY_CURRENCY) return round2(n);
  const rate = rateOn(book, cur, date);
  if (rate == null) return null;
  return round2(n * rate);
}

/** Integer dirham cents, for summing without float drift. */
export function aedCents(amount, currency, date, book) {
  const v = toAed(amount, currency, date, book);
  return v == null ? 0 : Math.round(v * 100);
}
