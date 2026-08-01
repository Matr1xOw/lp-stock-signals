import "server-only";

import { cached, stale } from "./cache";
import type { Candle, Quote, Series, Timeframe } from "./types";

/**
 * Yahoo Finance chart client.
 *
 * The v8 chart endpoint is public and needs no key, but it throttles hard:
 * bursts get 429s and occasionally an empty body. Everything here exists to
 * stay under that ceiling — a concurrency gate, retry with backoff, a TTL
 * cache, and a stale-value fallback so a throttled scan degrades instead of
 * failing.
 */

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// Deliberately minimal. Yahoo's edge routes a full desktop-browser UA down a
// path that demands a session cookie and crumb, and answers 429 without them;
// a generic client UA is served straight from the public API. Do not "improve"
// this into a realistic Chrome string — it will start failing every request.
const USER_AGENT = "Mozilla/5.0";

/** Native Yahoo interval + range to request for each desk timeframe. */
const REQUEST: Record<Timeframe, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "1h", range: "3mo" },
  // Yahoo has no 4h interval; we fold 1h bars four at a time below.
  "4h": { interval: "1h", range: "1y" },
  "1D": { interval: "1d", range: "2y" },
};

/** How long a bar set stays fresh. Roughly a quarter of the bar's own width. */
const TTL_MS: Record<Timeframe, number> = {
  "5m": 60_000,
  "15m": 150_000,
  "1h": 300_000,
  "4h": 600_000,
  "1D": 900_000,
};

/** Bars kept per series. Enough for a 200-period average plus chart history. */
const MAX_BARS = 400;

const MAX_CONCURRENT = 4;
const MAX_ATTEMPTS = 3;

let active = 0;
const waiting: Array<() => void> = [];

/** Caps simultaneous upstream requests; the rest queue. */
async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly symbol: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

type YahooChart = {
  chart: {
    error: { code: string; description: string } | null;
    result:
      | Array<{
          meta: {
            symbol: string;
            currency?: string;
            fullExchangeName?: string;
            longName?: string;
            shortName?: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currentTradingPeriod?: {
              regular?: { start: number; end: number };
            };
          };
          timestamp?: number[];
          indicators: {
            quote: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>
      | null;
  };
};

async function fetchChart(
  symbol: string,
  interval: string,
  range: string,
): Promise<YahooChart> {
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;

  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter. Yahoo's throttle window is measured
      // in seconds, so the first retry waits ~1.5s rather than milliseconds,
      // and the jitter keeps a throttled scan from retrying in lockstep.
      await sleep(1_500 * 2 ** (attempt - 1) + Math.random() * 750);
    }

    const response = await withSlot(() =>
      fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
    );

    lastStatus = response.status;
    if (response.status === 429 || response.status >= 500) continue;
    if (!response.ok) {
      throw new MarketDataError(
        `Yahoo returned ${response.status} for ${symbol}`,
        symbol,
        response.status,
      );
    }

    const text = await response.text();
    if (!text) continue; // Throttling sometimes shows up as an empty 200.
    return JSON.parse(text) as YahooChart;
  }

  throw new MarketDataError(
    `Yahoo did not respond for ${symbol} after ${MAX_ATTEMPTS} attempts`,
    symbol,
    lastStatus,
  );
}

/**
 * Folds `size` consecutive bars into one.
 *
 * Yahoo has no 4h interval, so a 4h bar is four 1h bars merged. Bars are
 * grouped from the most recent backwards, which keeps the newest (partial)
 * bar aligned with the live price rather than with an arbitrary epoch offset.
 */
function fold(candles: Candle[], size: number): Candle[] {
  const out: Candle[] = [];
  for (let end = candles.length; end > 0; end -= size) {
    const group = candles.slice(Math.max(0, end - size), end);
    out.unshift({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

/**
 * Strips Yahoo's synthetic trailing bar.
 *
 * At a session boundary Yahoo appends a placeholder bar carrying the current
 * price in all four OHLC fields and zero volume. It is not a bar that traded,
 * and leaving it in does real damage: relative volume reads ~0 on the latest
 * bar, so every volume-based score collapses, and candlestick detectors see a
 * zero-range doji that never existed. The live price is available separately
 * from `meta`, so nothing is lost by dropping it.
 */
function dropPlaceholderBar(candles: Candle[]): Candle[] {
  const bar = candles[candles.length - 1];
  const zeroRange =
    bar.open === bar.high && bar.high === bar.low && bar.low === bar.close;
  return bar.volume === 0 && zeroRange ? candles.slice(0, -1) : candles;
}

type ChartMeta = NonNullable<YahooChart["chart"]["result"]>[number]["meta"];

/**
 * Yesterday's closing price, used for the day-change figure.
 *
 * Yahoo's meta is inconsistent about this. Intraday requests carry a correct
 * `previousClose`. Daily requests omit it and offer `chartPreviousClose`
 * instead — which is the close *before the whole requested range*, i.e. two
 * years stale on a 2y request. So on daily bars we read the prior bar rather
 * than trust the meta.
 */
function priorClose(
  meta: ChartMeta,
  bars: Candle[],
  timeframe: Timeframe,
): number {
  if (timeframe === "1D") {
    return bars.length >= 2 ? bars[bars.length - 2].close : bars[0].open;
  }
  return meta.previousClose ?? meta.chartPreviousClose ?? bars[0].open;
}

function toSeries(
  raw: YahooChart,
  symbol: string,
  timeframe: Timeframe,
): Series {
  const result = raw.chart.result?.[0];
  if (!result) {
    throw new MarketDataError(
      raw.chart.error?.description ?? `No data for ${symbol}`,
      symbol,
    );
  }

  const { meta, timestamp = [], indicators } = result;
  const q = indicators.quote[0] ?? {};

  const candles: Candle[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    // Yahoo pads halted or not-yet-traded slots with nulls; drop them rather
    // than forward-filling, which would invent price action.
    if (open == null || high == null || low == null || close == null) continue;
    candles.push({
      time: timestamp[i],
      open,
      high,
      low,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }

  if (candles.length === 0) {
    throw new MarketDataError(`No usable bars for ${symbol}`, symbol);
  }

  const trimmed = dropPlaceholderBar(candles);
  const folded = timeframe === "4h" ? fold(trimmed, 4) : trimmed;
  const bars = folded.slice(-MAX_BARS);

  const now = Math.floor(Date.now() / 1000);
  const regular = meta.currentTradingPeriod?.regular;

  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    timeframe,
    price: meta.regularMarketPrice ?? bars[bars.length - 1].close,
    previousClose: priorClose(meta, bars, timeframe),
    currency: meta.currency ?? "USD",
    exchange: meta.fullExchangeName ?? "",
    marketOpen: regular ? now >= regular.start && now < regular.end : false,
    candles: bars,
  };
}

/** Fetches one symbol's bars for a timeframe, cached and de-duplicated. */
export async function getSeries(
  symbol: string,
  timeframe: Timeframe,
): Promise<Series> {
  const key = `series:${symbol}:${timeframe}`;
  const { interval, range } = REQUEST[timeframe];

  try {
    return await cached(key, TTL_MS[timeframe], async () =>
      toSeries(await fetchChart(symbol, interval, range), symbol, timeframe),
    );
  } catch (error) {
    // A stale series is far more useful than a hole in the dashboard.
    const fallback = stale<Series>(key);
    if (fallback) return fallback;
    throw error;
  }
}

/**
 * Fetches many symbols, discarding the ones that fail.
 *
 * A scan across dozens of tickers will usually lose one or two to throttling
 * or a delisting; that should thin the results, not fail the scan.
 */
export async function getManySeries(
  symbols: string[],
  timeframe: Timeframe,
): Promise<{ series: Series[]; failed: string[] }> {
  const settled = await Promise.allSettled(
    symbols.map((s) => getSeries(s, timeframe)),
  );

  const series: Series[] = [];
  const failed: string[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") series.push(outcome.value);
    else failed.push(symbols[i]);
  });

  return { series, failed };
}

/** Open positions are marked to market often, so quotes get their own TTL. */
const QUOTE_TTL_MS = 20_000;

async function getQuote(symbol: string): Promise<Quote> {
  const key = `quote:${symbol}`;
  try {
    return await cached(key, QUOTE_TTL_MS, async () => {
      // A 5-day daily chart is the smallest request that carries both a full
      // meta block and enough bars to derive the prior close.
      const series = toSeries(
        await fetchChart(symbol, "1d", "5d"),
        symbol,
        "1D",
      );
      return {
        symbol: series.symbol,
        name: series.name,
        price: series.price,
        previousClose: series.previousClose,
        marketOpen: series.marketOpen,
      };
    });
  } catch (error) {
    const fallback = stale<Quote>(key);
    if (fallback) return fallback;
    throw error;
  }
}

/** Last price for each symbol; symbols that fail are simply omitted. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const settled = await Promise.allSettled(symbols.map(getQuote));
  return settled
    .filter((o): o is PromiseFulfilledResult<Quote> => o.status === "fulfilled")
    .map((o) => o.value);
}
