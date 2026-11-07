import { fallbackBook, toAed } from "../../../../lib/fx.mjs";

type Book = ReturnType<typeof fallbackBook>;
let book: Book = fallbackBook();
const listeners = new Set<() => void>();

export function setFxBook(next: Book) {
  book = next;
  listeners.forEach(fn => fn());
}
export function getFxBook() { return book; }
export function subscribeFx(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function aedNumber(amount: number | string | null | undefined, currency?: string | null, date?: string | null) {
  return toAed(amount, currency || "AED", date, book);
}

export function formatAed(amount: number | string | null | undefined, currency: string | null = "AED", date?: string | null, digits = 2) {
  if (amount == null || amount === "") return "—";
  const n = aedNumber(amount, currency, date);
  if (n == null) return "—";
  return `AED ${Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
