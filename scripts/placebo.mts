/**
 * Is the detector's timing worth anything, or is it just the market's drift?
 *
 * Correcting the unfilled-entry bug left every long pattern positive and every
 * short pattern negative. Over a fifteen-day window that is exactly what a
 * rising market produces regardless of whether the detectors see anything, so
 * the split cannot be read as detector quality without controlling for it.
 *
 *   npm run dev       # in another terminal
 *   npm run placebo
 *   npm run placebo -- 1h 1D
 *
 * The control is a matched placebo. For every real trade, the same trade is
 * resolved from a *random* bar on the *same symbol*: same direction, same
 * reward-to-risk, same horizon, and the same stop distance in ATR at that
 * bar's own volatility. Everything the market did over the window is held
 * constant; the only thing removed is the detector's choice of moment.
 *
 * Both sides run through `resolveFrom`, so a difference cannot come from two
 * implementations of the same rules disagreeing.
 *
 * Read `edge` — real minus placebo. That is the detector's contribution.
 */

import {
  backtestTrades,
  horizonFor,
  resolveFrom,
  type BacktestTrade,
} from "../src/lib/analysis/backtest";
import { atr as atrSeries } from "../src/lib/analysis/indicators";
import { PATTERN_NAMES } from "../src/lib/analysis/patterns";
import { passCount, scanSlice } from "../src/lib/market/universe";
import type { Candle, Series } from "../src/lib/market/types";

const ORIGIN = process.env.DESK_ORIGIN ?? "http://localhost:3000";
/** Control draws per real trade. */
const DRAWS = 5;
/** Detectors need history; placebos start no earlier than the replay does. */
const WARMUP = 80;

/** Seeded LCG so a null result is reproducible rather than a lucky roll. */
function rng(seed = 20260812) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const mean = (v: number[]) =>
  v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;

const show = (v: number, width = 9) =>
  (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(3)).padStart(width);

/** Resolves the same geometry from a random bar on the same series. */
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
  const volatility = atr[start];
  if (!Number.isFinite(volatility) || volatility <= 0) return null;

  const entry = candles[start].close;
  const risk = trade.riskAtr * volatility;
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
  for (let pass = 0; pass < passCount(); pass++) symbols.push(...scanSlice(pass));

  const next = rng();
  const real = new Map<string, number[]>();
  const control = new Map<string, number[]>();
  let loaded = 0;

  for (const symbol of symbols) {
    const response = await fetch(
      `${ORIGIN}/api/candles?symbol=${symbol}&timeframe=${timeframe}`,
    );
    if (!response.ok) continue;
    const series = (await response.json()) as Series;
    loaded++;

    const atr = atrSeries(series.candles, 14);
    for (const pattern of PATTERN_NAMES) {
      const trades = backtestTrades(series.candles, pattern).filter(
        (t) => t.outcome !== "UNRESOLVED",
      );
      if (trades.length === 0) continue;

      real.set(pattern, [...(real.get(pattern) ?? []), ...trades.map((t) => t.r)]);

      const drawn: number[] = [];
      for (const trade of trades) {
        for (let d = 0; d < DRAWS; d++) {
          const r = placebo(series.candles, atr, trade, next);
          if (r !== null) drawn.push(r);
        }
      }
      control.set(pattern, [...(control.get(pattern) ?? []), ...drawn]);
    }
  }

  if (loaded === 0) {
    console.error(`\nNo bars. Is the dev server up at ${ORIGIN}?`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${timeframe}  ·  ${loaded} symbols  ·  ${DRAWS} control draws per trade`);
  console.log("═".repeat(64));
  console.log("pattern            n     real   placebo      edge   direction");

  const rows = [...real]
    .map(([name, rs]) => ({
      name,
      n: rs.length,
      real: mean(rs),
      placebo: mean(control.get(name) ?? []),
    }))
    .map((r) => ({ ...r, edge: r.real - r.placebo }))
    .sort((a, b) => b.edge - a.edge);

  for (const row of rows) {
    const side = /BEAR|TOP|BREAKDOWN|DESC/.test(row.name) ? "short" : "long";
    console.log(
      row.name.padEnd(15) +
        String(row.n).padStart(6) +
        show(row.real) +
        show(row.placebo) +
        show(row.edge) +
        "   " +
        side,
    );
  }

  const allReal = rows.flatMap((r) => real.get(r.name) ?? []);
  const allControl = rows.flatMap((r) => control.get(r.name) ?? []);
  console.log(
    "ALL".padEnd(15) +
      String(allReal.length).padStart(6) +
      show(mean(allReal)) +
      show(mean(allControl)) +
      show(mean(allReal) - mean(allControl)),
  );

  for (const side of ["long", "short"] as const) {
    const names = rows
      .filter((r) => (/BEAR|TOP|BREAKDOWN|DESC/.test(r.name) ? "short" : "long") === side)
      .map((r) => r.name);
    const rs = names.flatMap((n) => real.get(n) ?? []);
    const cs = names.flatMap((n) => control.get(n) ?? []);
    console.log(
      `  ${side} only`.padEnd(15) +
        String(rs.length).padStart(6) +
        show(mean(rs)) +
        show(mean(cs)) +
        show(mean(rs) - mean(cs)),
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  for (const timeframe of args.length ? args : ["15m", "1D"]) await run(timeframe);
  console.log(
    "\nedge = real − placebo. Anything near zero means the detector is\n" +
      "contributing nothing the market was not doing anyway.\n",
  );
}

main();
