import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { setFxBook, subscribeFx } from "@/lib/aed-book";

export { aedNumber, formatAed, getFxBook, setFxBook } from "@/lib/aed-book";

/** Loads the daily dirham rates once. Amounts already on screen update when the rates arrive. */
export function FxProvider({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let stop = false;
    apiFetch("/api/fx").then(r => r.ok ? r.json() : null).then(next => {
      if (!stop && next?.latest) setFxBook(next);
    }).catch(() => {});
    const stopListen = subscribeFx(() => { if (!stop) setTick(t => t + 1); });
    return () => { stop = true; stopListen(); };
  }, []);
  return children;
}
