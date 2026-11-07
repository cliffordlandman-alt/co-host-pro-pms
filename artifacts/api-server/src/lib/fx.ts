// Daily dirham rates, cached in app_settings. No vendor name is returned to the client.
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  DISPLAY_CURRENCY, USD_AED_PEG, aedPerUnitFromUsdCross, aedPerUnitFromUsdQuote, fallbackBook,
} from "../../../../lib/fx.mjs";

const KEY = "fx_rates";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HISTORY_START = "2024-01-01";
const HISTORY_URL = "https://api.frankfurter.dev/v1";
const LATEST_URL = "https://open.er-api.com/v6/latest/USD";

type Book = {
  displayCurrency: string;
  updatedAt: string | null;
  stale: boolean;
  pegUsdAed: number;
  latest: Record<string, number>;
  byDate: Record<string, Record<string, number>>;
};

let memory: { book: Book; at: number } | null = null;
let refreshing: Promise<Book> | null = null;

function fixedBook(): Book | null {
  const raw = process.env.FX_FIXED_RATES;
  if (!raw) return null;
  const rates = JSON.parse(raw) as Record<string, number>;
  return { displayCurrency: DISPLAY_CURRENCY, updatedAt: new Date().toISOString(), stale: false, pegUsdAed: USD_AED_PEG, latest: { AED: 1, USD: USD_AED_PEG, ...rates }, byDate: {} };
}

async function readCache(): Promise<Book | null> {
  try {
    const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, KEY));
    const value = row?.value as Book | undefined;
    if (!value || typeof value !== "object" || !value.latest) return null;
    return value;
  } catch {
    return null;
  }
}

async function writeCache(book: Book) {
  const existing = await db.select({ id: appSettingsTable.id }).from(appSettingsTable).where(eq(appSettingsTable.key, KEY));
  if (existing.length) await db.update(appSettingsTable).set({ value: book, updatedAt: new Date() }).where(eq(appSettingsTable.key, KEY));
  else await db.insert(appSettingsTable).values({ key: KEY, value: book });
}

async function fetchHistory(start: string, end: string) {
  const url = `${HISTORY_URL}/${start}..${end}?from=USD&to=ZAR,EUR,GBP`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`history ${res.status}`);
  const data = await res.json() as { rates?: Record<string, Record<string, number>> };
  const byDate: Record<string, Record<string, number>> = {};
  for (const [date, cross] of Object.entries(data.rates || {})) byDate[date] = aedPerUnitFromUsdCross(cross);
  return byDate;
}

async function fetchLatest() {
  const res = await fetch(LATEST_URL, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`latest ${res.status}`);
  const data = await res.json() as { result?: string; rates?: Record<string, number> };
  if (data.result !== "success") throw new Error("latest unavailable");
  return aedPerUnitFromUsdQuote(data.rates);
}

function newestRates(byDate: Record<string, Record<string, number>>) {
  const dates = Object.keys(byDate).sort();
  return dates.length ? byDate[dates[dates.length - 1]] : null;
}

async function refresh(previous: Book | null): Promise<Book> {
  const end = new Date().toISOString().slice(0, 10);
  let byDate = { ...(previous?.byDate || {}) };
  let latest = { ...(previous?.latest || fallbackBook().latest) };
  let historyOk = false;
  let latestOk = false;
  try {
    byDate = { ...byDate, ...(await fetchHistory(HISTORY_START, end)) };
    const recent = newestRates(byDate);
    if (recent) latest = { ...latest, ...recent };
    historyOk = true;
  } catch { /* keep what we have */ }
  try {
    const quote = await fetchLatest();
    if (quote) { latest = { ...latest, ...quote }; latestOk = true; }
  } catch { /* history or the previous cache still applies */ }
  if (!historyOk && !latestOk && !previous) throw new Error("no rates");
  const book: Book = {
    displayCurrency: DISPLAY_CURRENCY,
    updatedAt: new Date().toISOString(),
    stale: !historyOk && !latestOk,
    pegUsdAed: USD_AED_PEG,
    latest,
    byDate,
  };
  try { await writeCache(book); } catch { /* memory copy still serves this process */ }
  return book;
}

/** Rates for display and for adding amounts up. Refreshes at most once a day. */
export async function getFxBook(): Promise<Book> {
  const fixed = fixedBook();
  if (fixed) return fixed;
  if (memory && Date.now() - memory.at < 60_000) return memory.book;
  const cached = await readCache();
  const fresh = cached?.updatedAt && Date.now() - Date.parse(cached.updatedAt) < MAX_AGE_MS && !cached.stale;
  if (fresh && cached) {
    memory = { book: cached, at: Date.now() };
    return cached;
  }
  if (!refreshing) {
    refreshing = refresh(cached).then(book => {
      memory = { book, at: Date.now() };
      return book;
    }).catch(() => {
      const book = cached ? { ...cached, stale: true } : fallbackBook();
      memory = { book, at: Date.now() };
      return book;
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** What the app may show. No source name. */
export function publicBook(book: Book) {
  return {
    displayCurrency: DISPLAY_CURRENCY,
    updatedAt: book.updatedAt,
    stale: !!book.stale,
    pegUsdAed: USD_AED_PEG,
    latest: book.latest,
    byDate: book.byDate,
  };
}
