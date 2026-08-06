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
  mean,
  poolingComparison,
  splitHalfReliability,
} from "../src/lib/analysis/reliability";
import {
  poolPriorsExcluding,
  shrink,
  type Unit,
} from "../src/lib/analysis/pooling";
import { correlation } from "../src/lib/analysis/indicators";
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

/** Shrinkage constants to try. 0 is the current engine; Infinity is pure prior. */
const K_GRID = [0, 1, 2, 4, 8, 16, 32, 64, 128, Infinity];

/**
 * How well a shrunk past estimate predicts future R, at each k.
 *
 * Everything is fitted on the chronological *past* half and scored against the
 * *future* half, and each unit's prior excludes itself — so a k that wins here
 * won a genuine out-of-sample contest rather than a curve fit.
 */
function sweepK(units: Unit[], minPerHalf: number) {
  type Row = { key: string; group: string; past: number[]; future: number };

  const rows: Row[] = [];
  for (const unit of units) {
    const [past, future] = chronological(unit.rs);
    if (past.length < minPerHalf || future.length < minPerHalf) continue;
    rows.push({ key: unit.key, group: unit.group, past, future: mean(future) });
  }
  if (rows.length < 10) return [];

  // Priors are built from past halves only. Using a unit's future to build the
  // prior that predicts its future would be the same leak in a new costume.
  const pastUnits: Unit[] = rows.map((r) => ({
    key: r.key,
    group: r.group,
    rs: r.past,
  }));

  return K_GRID.map((k) => {
    const estimates: number[] = [];
    const futures: number[] = [];
    for (const row of rows) {
      const prior = poolPriorsExcluding(pastUnits, row.key).get(row.group) ?? null;
      const value = shrink(mean(row.past), row.past.length, prior, k);
      if (value === null || !Number.isFinite(value)) continue;
      estimates.push(value);
      futures.push(row.future);
    }
    const r = correlation(estimates, futures);
    return { k, n: estimates.length, r: Number.isFinite(r) ? r : null };
  });
}

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
  const units: Unit[] = [];
  for (const s of series) {
    for (const pattern of PATTERN_NAMES) {
      const resolved = backtestTrades(s.candles, pattern).filter(
        (t) => t.outcome !== "UNRESOLVED",
      );
      if (resolved.length > 0) {
        units.push({
          key: `${s.symbol}:${pattern}`,
          group: pattern,
          rs: resolved.map((t) => t.r),
        });
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

  const sweep = sweepK(units, MIN_PER_HALF);
  if (sweep.length > 0) {
    const best = sweep.reduce((a, b) => ((b.r ?? -2) > (a.r ?? -2) ? b : a));
    console.log("\nshrinkage toward the pattern prior, scored out of sample:");
    for (const row of sweep) {
      const label = row.k === Infinity ? "prior only" : `k = ${row.k}`;
      const marker = row === best ? "  ← best" : "";
      console.log(`  ${label.padEnd(12)} r = ${show(row.r)}${marker}`);
    }
  }
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
