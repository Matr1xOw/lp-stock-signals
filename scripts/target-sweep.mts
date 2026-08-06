/**
 * Does aiming at less of the measured move help?
 *
 * `buildLevels` targets the full measured move. Expectancy across patterns
 * tracks reward-to-risk inversely — the patterns asking 3-5R are the losing
 * ones — which reads like a target that is too ambitious. This sweeps the
 * target back toward entry and measures whether that is actually the lever.
 *
 *   npm run dev          # in another terminal
 *   npm run target-sweep
 *   npm run target-sweep -- 1h
 *
 * Two things make the answer trustworthy rather than a curve fit:
 *
 *  - The population is held constant. `MIN_RR` is *not* applied, because a
 *    smaller target lowers reward-to-risk and would filter out most setups —
 *    at f = 0.6 several patterns retain nothing. Comparing those to the full
 *    target compares different trades, not different exits.
 *  - Each pattern's optimum is reported for the first and second chronological
 *    half separately. If they disagree, the optimum is noise.
 */

import { backtestTrades, type BacktestTrade } from "../src/lib/analysis/backtest";
import { PATTERN_NAMES } from "../src/lib/analysis/patterns";
import { passCount, scanSlice } from "../src/lib/market/universe";
import type { Series } from "../src/lib/market/types";

const ORIGIN = process.env.DESK_ORIGIN ?? "http://localhost:3000";
const MIN_RR = 1.5;
const FRACTIONS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

const mean = (v: number[]) =>
  v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;

type Tagged = BacktestTrade & { late: boolean };

async function main() {
  const timeframe = process.argv[2] ?? "15m";
  const symbols: string[] = [];
  for (let p = 0; p < passCount(); p++) symbols.push(...scanSlice(p));

  const series: Series[] = [];
  for (const symbol of symbols) {
    const response = await fetch(
      `${ORIGIN}/api/candles?symbol=${symbol}&timeframe=${timeframe}`,
    );
    if (response.ok) series.push((await response.json()) as Series);
  }
  if (series.length === 0) {
    console.error(`\nNo bars. Is the dev server up at ${ORIGIN}?`);
    process.exitCode = 1;
    return;
  }

  const data = new Map<string, Map<number, Tagged[]>>();
  for (const s of series) {
    const midpoint = s.candles.length / 2;
    for (const pattern of PATTERN_NAMES) {
      let byFraction = data.get(pattern);
      if (!byFraction) {
        byFraction = new Map();
        data.set(pattern, byFraction);
      }
      for (const f of FRACTIONS) {
        const trades = backtestTrades(s.candles, pattern, f)
          .filter((t) => t.outcome !== "UNRESOLVED")
          .map((t) => ({ ...t, late: t.index >= midpoint }));
        byFraction.set(f, [...(byFraction.get(f) ?? []), ...trades]);
      }
    }
  }

  const argmax = (values: number[]) => {
    const best = Math.max(...values.filter(Number.isFinite));
    return FRACTIONS[values.indexOf(best)];
  };
  const cell = (v: number) =>
    (Number.isNaN(v) ? "—" : v.toFixed(3)).padStart(8);

  console.log(`\n${timeframe} — expectancy by target fraction, same trades throughout`);
  console.log(
    "            " +
      FRACTIONS.map((f) => f.toFixed(1).padStart(8)).join("") +
      "   | early/late argmax",
  );
  for (const [name, byFraction] of [...data].sort()) {
    const at = (pick: (t: Tagged) => boolean) =>
      FRACTIONS.map((f) => mean((byFraction.get(f) ?? []).filter(pick).map((t) => t.r)));
    console.log(
      name.padEnd(12) +
        at(() => true).map(cell).join("") +
        `   |  ${argmax(at((t) => !t.late))} / ${argmax(at((t) => t.late))}`,
    );
  }

  console.log(`\nshare of occurrences that would still clear MIN_RR ${MIN_RR}:`);
  for (const [name, byFraction] of [...data].sort()) {
    const base = (byFraction.get(1)?.length ?? 0) || 1;
    console.log(
      name.padEnd(12) +
        FRACTIONS.map((f) => {
          const kept = (byFraction.get(f) ?? []).filter((t) => t.rr >= MIN_RR).length;
          return `${Math.round((kept / base) * 100)}%`.padStart(8);
        }).join(""),
    );
  }
}

main();
