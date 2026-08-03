"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type SessionStatus, sessionStatus } from "@/lib/market/session";
import type { Series, Timeframe } from "@/lib/market/types";
import type { ScanResult } from "@/lib/signals/types";

/**
 * Data-fetching hooks for the dashboard.
 *
 * A shared rule runs through all of them: a failed refresh never clears data
 * that is already on screen. Yahoo throttles, and a trading desk that blanks
 * out every time a poll fails is worse than one showing prices a minute old —
 * so errors surface as a status flag beside the stale data, not instead of it.
 */

type Fetched<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}

/**
 * Polls a JSON endpoint, keeping the last good value through failures.
 *
 * `onData` fires once per successful response. It exists so callers can react
 * to fresh data — logging a completed scan, say — from inside the fetch
 * continuation rather than from an effect watching the returned value, which
 * would be a second render pass reacting to the first.
 */
function usePolled<T>(
  url: string | null,
  intervalMs: number,
  onData?: (data: T) => void,
): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Kept in a ref so a caller passing an inline callback does not restart
  // polling on every render.
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (!url) return;

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const result = await getJson<T>(url, controller.signal);
        if (!cancelled) {
          setData(result);
          setError(null);
          onDataRef.current?.(result);
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        // Deliberately leaves `data` untouched.
        setError(cause instanceof Error ? cause.message : "Request failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const timer = setInterval(run, intervalMs);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [url, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, refresh };
}

/** Signals for a timeframe, rescanned on an interval. */
export function useScan(
  timeframe: Timeframe,
  pass: number,
  intervalMs = 60_000,
  onData?: (result: ScanResult) => void,
): Fetched<ScanResult> {
  return usePolled<ScanResult>(
    `/api/scan?timeframe=${timeframe}&pass=${pass}`,
    intervalMs,
    onData,
  );
}

/** Bars for the chart panel. */
export function useCandles(
  symbol: string | null,
  timeframe: Timeframe,
  intervalMs = 60_000,
): Fetched<Series> {
  return usePolled<Series>(
    symbol ? `/api/candles?symbol=${symbol}&timeframe=${timeframe}` : null,
    intervalMs,
  );
}

/** Last prices for the journal's open symbols. */
export function useQuotes(
  symbols: string[],
  intervalMs = 30_000,
): { prices: Record<string, number>; error: string | null } {
  // Sorted and joined so the URL — and therefore the effect — is stable when
  // the same symbols arrive in a different order.
  const key = Array.from(new Set(symbols)).sort().join(",");
  const { data, error } = usePolled<{
    quotes: Array<{ symbol: string; price: number }>;
  }>(key ? `/api/quotes?symbols=${key}` : null, intervalMs);

  const prices: Record<string, number> = {};
  for (const quote of data?.quotes ?? []) prices[quote.symbol] = quote.price;

  return { prices, error };
}

/** A value that updates on an interval, for clocks and relative times. */
export function useTicker(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Nothing to subscribe to — the value differs by environment, not over time. */
const noopSubscribe = () => () => {};

/**
 * Defers rendering until after hydration.
 *
 * Clocks and relative timestamps differ between the server render and the
 * first client render, which React reports as a hydration mismatch. Gating
 * them on this avoids the warning without disabling SSR for the whole page.
 *
 * Expressed as a store snapshot that is `false` on the server and `true` on
 * the client, which is exactly what the distinction is — React then handles
 * the swap as part of hydration rather than as a post-mount state update.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Live exchange session state, and the clock it was read from.
 *
 * Read from the clock rather than from the last scan, because the scan's
 * `marketOpen` is a fact about the past: at 09:30 the desk would go on
 * claiming the market was shut until the next sweep came back. Anything
 * telling you whether you can trade right now has to age in real time.
 *
 * `null` until hydration — the answer depends on the wall clock, so a server
 * render of it is a hydration mismatch waiting to happen.
 */
export function useSession(intervalMs = 30_000): {
  session: SessionStatus | null;
  now: number;
} {
  const now = useTicker(intervalMs);
  const mounted = useMounted();
  const session = useMemo(
    () => (mounted ? sessionStatus(now) : null),
    [mounted, now],
  );
  return { session, now };
}
