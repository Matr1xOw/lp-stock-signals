/**
 * Does confidence separate good entries from bad ones?
 *
 * The placebo harness showed the detectors do not beat random entry timing on
 * average. But the desk does not trade the average — it trades what clears
 * confidence, R:R, RSI, ±DI and the pooled edge. If the score is doing work,
 * high-confidence signals should beat their placebos and low-confidence ones
 * should not.
 *
 *   npm run dev      # in another terminal
 *   npm run decile
 *   npm run decile -- 1h 1D
 *
 * Each real trade is scored at its own detection bar and paired with placebo
 * draws that land in the same bucket, so every row compares like with like.
 *
 * `EDGE` is excluded and the remaining 82 points are rescaled to 100.
 * Recomputing it historically means backtesting a prefix at every bar, which
 * is O(n²), and once pooled it is close to constant within a pattern — so it
 * shifts patterns against each other rather than separating signals inside
 * one. The five factors here are the ones that could plausibly rank a signal.
 */

import {
  backtestTrades,
  horizonFor,
  resolveFrom,
  type BacktestTrade,
} from "../src/lib/analysis/backtest";
import {
  adx as adxSeries,
  atr as atrSeries,
  correlation,
  macd as macdSeries,
  relativeVolume,
  returns,
  rsi as rsiSeries,
} from "../src/lib/analysis/indicators";
import { PATTERN_NAMES } from "../src/lib/analysis/patterns";
import { scoreSignal } from "../src/lib/signals/scoring";
import { BENCHMARK, passCount, scanSlice } from "../src/lib/market/universe";
import type { Candle, Series } from "../src/lib/market/types";

const ORIGIN = process.env.DESK_ORIGIN ?? "http://localhost:3000";
const DRAWS = 5;
const WARMUP = 80;
/** The five factors that are cheap to recompute, out of 100. */
const SCORED_POINTS = 30 + 17 + 16 + 11 + 8;

function rng(seed = 20260812) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const mean = (v: number[]) =>
  v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
const show = (v: number, w = 9) =>
  (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(3)).padStart(w);

async function load(symbol: string, timeframe: string): Promise<Series | null> {
  const r = await fetch(`${ORIGIN}/api/candles?symbol=${symbol}&timeframe=${timeframe}`);
  return r.ok ? ((await r.json()) as Series) : null;
}

function placebo(
  candles: Candle[],
  atr: number[],
  trade: BacktestTrade,
  next: () => number,
): number | null {
  const horizon = horizonFor(trade.rr * trade.riskAtr);
  const last = candles.length - horizon - 1;
  if (last <= WARMUP) return null;

  const start = WARMUP + Math.floor(next() * (last - WARMUP));
  const vol = atr[start];
  if (!Number.isFinite(vol) || vol <= 0) return null;

  const entry = candles[start].close;
  const risk = trade.riskAtr * vol;
  const reward = trade.rr * risk;
  const resolved = resolveFrom(
    candles,
    start,
    {
      entry,
      stop: trade.long ? entry - risk : entry + risk,
      target: trade.long ? entry + reward : entry - reward,
      risk,
      rr: trade.rr,
      riskAtr: trade.riskAtr,
    },
    trade.long,
    horizon,
  );
  return resolved.outcome === "UNRESOLVED" ? null : resolved.r;
}

async function run(timeframe: string) {
  const symbols: string[] = [];
  for (let p = 0; p < passCount(); p++) symbols.push(...scanSlice(p));

  const benchmark = await load(BENCHMARK, timeframe);
  const benchmarkReturns = benchmark
    ? returns(benchmark.candles.map((c) => c.close))
    : [];

  const next = rng();
  const scored: Array<{ confidence: number; real: number; control: number[] }> = [];

  for (const symbol of symbols) {
    const series = await load(symbol, timeframe);
    if (!series) continue;
    const { candles } = series;
    const closes = candles.map((c) => c.close);

    const atr = atrSeries(candles, 14);
    const { adx, plusDi, minusDi } = adxSeries(candles, 14);
    const rsi = rsiSeries(closes, 14);
    const histogram = macdSeries(closes).histogram;
    const relVolume = relativeVolume(candles, 20);
    const symbolReturns = returns(closes);

    for (const pattern of PATTERN_NAMES) {
      for (const trade of backtestTrades(candles, pattern)) {
        if (trade.outcome === "UNRESOLVED") continue;
        const at = trade.index;

        // Correlation as it stood at the detection bar, both series truncated
        // there so nothing after the signal leaks into its own score.
        const corr = correlation(
          symbolReturns.slice(0, at),
          benchmarkReturns.slice(0, at),
        );

        const { confidence } = scoreSignal({
          patternQuality: trade.quality,
          edge: null,
          edgeSample: 0,
          edgePooled: false,
          adx: adx[at],
          plusDi: plusDi[at],
          minusDi: minusDi[at],
          rsi: rsi[at],
          macdHistogram: histogram[at],
          relativeVolume: relVolume[at],
          benchmarkCorrelation: corr,
          long: trade.long,
        });

        // scoreSignal includes EDGE's fallback 7.2; drop it and rescale.
        const withoutEdge = confidence - Math.round(18 * 0.4);
        const control: number[] = [];
        for (let d = 0; d < DRAWS; d++) {
          const r = placebo(candles, atr, trade, next);
          if (r !== null) control.push(r);
        }
        scored.push({
          confidence: (withoutEdge / SCORED_POINTS) * 100,
          real: trade.r,
          control,
        });
      }
    }
  }

  if (scored.length === 0) {
    console.error(`\nNo trades. Is the dev server up at ${ORIGIN}?`);
    process.exitCode = 1;
    return;
  }

  scored.sort((a, b) => a.confidence - b.confidence);
  const size = Math.floor(scored.length / 10);

  console.log(`\n${"═".repeat(66)}`);
  console.log(`${timeframe}  ·  ${scored.length} trades  ·  confidence excludes EDGE, rescaled to 100`);
  console.log("═".repeat(66));
  console.log("decile   conf range        n      real   placebo      edge");

  for (let d = 0; d < 10; d++) {
    const slice = scored.slice(d * size, d === 9 ? scored.length : (d + 1) * size);
    if (slice.length === 0) continue;
    const real = mean(slice.map((s) => s.real));
    const control = mean(slice.flatMap((s) => s.control));
    console.log(
      `${String(d + 1).padStart(4)}   ` +
        `${slice[0].confidence.toFixed(0).padStart(3)}–${slice[slice.length - 1].confidence.toFixed(0).padEnd(3)}` +
        String(slice.length).padStart(9) +
        show(real) +
        show(control) +
        show(real - control),
    );
  }

  const top = scored.slice(-size * 3);
  const bottom = scored.slice(0, size * 3);
  const edge = (g: typeof scored) =>
    mean(g.map((s) => s.real)) - mean(g.flatMap((s) => s.control));
  console.log(`\ntop 30%    edge ${show(edge(top))}`);
  console.log(`bottom 30% edge ${show(edge(bottom))}`);
  console.log(`spread          ${show(edge(top) - edge(bottom))}`);
}

async function main() {
  const args = process.argv.slice(2);
  for (const timeframe of args.length ? args : ["15m", "1D"]) await run(timeframe);
  console.log(
    "\nA positive spread means the score ranks entries. Near zero means it\n" +
      "orders signals by something that does not predict anything.\n",
  );
}

main();
