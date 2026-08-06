/**
 * Phase 2a: does `EDGE` measure anything?
 *
 * Replays every detector across every symbol, then asks whether a
 * symbol/pattern's measured expectancy agrees with itself. See
 * docs/engine-roadmap.md for why this runs before anything else gets tuned.
 *
 *   npm run dev          # in another terminal — see below
 *   npm run reliability
 *   npm run reliability -- 1h 1D
 *
 * Bars are pulled through the running dev server rather than by importing
 * `market/yahoo.ts`, which is `server-only` and throws outside a Next runtime.
 * That also means this exercises the real cache and the real fetch path.
 */

import { backtestTrades } from "../src/lib/analysis/backtest";
import { PATTERN_NAMES } from "../src/lib/analysis/patterns";
import {
  alternating,
  chronological,
  poolingComparison,
  splitHalfReliability,
} from "../src/lib/analysis/reliability";
import { passCount, scanSlice } from "../src/lib/market/universe";
import type { Series } from "../src/lib/market/types";

const ORIGIN = process.env.DESK_ORIGIN ?? "http://localhost:3000";
/** Trades needed on each side of a split before a unit is usable. */
const MIN_PER_HALF = 3;

function universe(): string[] {
  const symbols: string[] = [];
  for (let pass = 0; pass < passCount(); pass++) symbols.push(...scanSlice(pass));
  return symbols;
}

async function loadSeries(timeframe: string): Promise<Series[]> {
  const out: Series[] = [];
  for (const symbol of universe()) {
    const url = `${ORIGIN}/api/candles?symbol=${symbol}&timeframe=${timeframe}`;
    try {
      const response = await fetch(url);
      if (response.ok) out.push((await response.json()) as Series);
    } catch {
      // One symbol short does not invalidate the study.
    }
  }
  return out;
}

const show = (value: number | null, digits = 3) =>
  value === null ? "  n/a" : value.toFixed(digits).padStart(6);

async function run(timeframe: string) {
  const series = await loadSeries(timeframe);
  if (series.length === 0) {
    console.error(
      `\nNo bars for ${timeframe}. Is the dev server up at ${ORIGIN}?`,
    );
    process.exitCode = 1;
    return;
  }

  // One unit per symbol/pattern pair: its realised R values, in order.
  const units: Array<{ group: string; rs: number[] }> = [];
  for (const s of series) {
    for (const pattern of PATTERN_NAMES) {
      const resolved = backtestTrades(s.candles, pattern).filter(
        (t) => t.outcome !== "UNRESOLVED",
      );
      if (resolved.length > 0) {
        units.push({ group: pattern, rs: resolved.map((t) => t.r) });
      }
    }
  }

  const samples = units.map((u) => u.rs);
  const internal = splitHalfReliability(samples, alternating, MIN_PER_HALF, true);
  const temporal = splitHalfReliability(samples, chronological, MIN_PER_HALF);
  const pooling = poolingComparison(units, MIN_PER_HALF);

  console.log(`\n${"═".repeat(58)}`);
  console.log(`${timeframe}  ·  ${series.length} symbols  ·  ${units.length} symbol/pattern pairs`);
  console.log("═".repeat(58));
  console.log(`internal consistency (odd/even)   r = ${show(internal.r)}   n = ${internal.n}`);
  console.log(`  Spearman-Brown corrected        r = ${show(internal.corrected)}`);
  console.log(`past predicts future (in time)    r = ${show(temporal.r)}   n = ${temporal.n}`);
  console.log(`  own history as predictor        r = ${show(pooling.specific)}   n = ${pooling.n}`);
  console.log(`  pattern pooled, self excluded   r = ${show(pooling.pooled)}`);
}

async function main() {
  const timeframes = process.argv.slice(2);
  for (const timeframe of timeframes.length ? timeframes : ["15m", "1h", "1D"]) {
    await run(timeframe);
  }
  console.log(
    "\nA factor that scores near zero on the temporal test cannot predict,\nwhatever it scores on internal consistency.\n",
  );
}

main();
