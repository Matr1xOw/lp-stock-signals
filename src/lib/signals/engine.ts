import "server-only";

import { backtestPattern, backtestTrades } from "@/lib/analysis/backtest";
import {
  DEFAULT_SHRINKAGE,
  EDGE_SHRINKAGE,
  poolPriorsExcluding,
  type Prior,
  shrink,
  type Unit,
} from "@/lib/analysis/pooling";
import {
  adx as adxSeries,
  atr as atrSeries,
  correlation,
  last,
  macd as macdSeries,
  relativeVolume,
  returns,
  rsi as rsiSeries,
} from "@/lib/analysis/indicators";
import {
  detectPattern,
  detectPatterns,
  PATTERN_NAMES,
} from "@/lib/analysis/patterns";
import { getManySeries, getSeries } from "@/lib/market/yahoo";
import { BENCHMARK, passCount, scanSlice, UNIVERSE } from "@/lib/market/universe";
import type { Series, Timeframe } from "@/lib/market/types";
import { buildLevels } from "./levels";
import type { ScanResult, Signal, SignalFactor } from "./types";

/**
 * The signal engine.
 *
 * A pattern on its own is not a trade. This layer takes each detected pattern
 * and asks whether the surrounding market agrees with it — is there a trend,
 * is momentum pointing the same way, is anyone actually trading it, and is
 * the move anything more than the whole market moving? Patterns that fail
 * those questions are dropped; the rest get a confidence score that shows its
 * own work, so a signal card can explain why it scored what it did.
 */

/** Minimum reward-to-risk worth taking. */
const MIN_RR = 1.5;
/**
 * Default confidence floor.
 *
 * Callers can override it — a daily scan legitimately clears fewer points
 * than an intraday one, because relative volume and ADX both read lower on
 * slower bars, so the same trade quality lands at a lower score.
 */
export const DEFAULT_MIN_CONFIDENCE = 55;
/**
 * If the two best patterns disagree on direction and are this close in
 * quality, the chart is genuinely ambiguous and there is no trade.
 */
const AMBIGUITY_MARGIN = 0.12;
/** How far back to look for the bar a pattern first appeared on. */
const DETECTION_LOOKBACK = 20;
/**
 * Expectancy at or below this, on a large enough sample, kills the signal
 * outright. A setup measured to lose this much per attempt is not a low-
 * confidence trade — it is a trade whose own history argues against it.
 */
const NEGATIVE_EDGE_VETO = -0.35;
const VETO_MIN_SAMPLE = 10;

type Weighted = { points: number; max: number; detail: string };

/** Pattern geometry — the strongest single input, but never the only one. */
function scorePattern(quality: number): Weighted {
  const max = 30;
  return {
    points: quality * max,
    max,
    detail: `geometry ${(quality * 100).toFixed(0)}/100`,
  };
}

/**
 * Measured edge: how this pattern has actually performed, from the backtest.
 *
 * Scored on expectancy rather than win rate, because win rate on its own is
 * not an edge — a pattern that wins 20% of the time at 6R makes money and one
 * that wins 60% at 0.4R does not.
 *
 * The expectancy handed in is the symbol's own record already blended toward
 * the pattern's record across the rest of the scan. It used to be the symbol's
 * record alone, which phase 2a measured as almost uncorrelated with what
 * happened next. `sample` still counts only this symbol's trades, because that
 * is what the detail line is telling the reader about.
 */
function scoreEdge(
  expectancy: number | null,
  sample: number,
  pooled: boolean,
): Weighted {
  const max = 18;
  if (expectancy === null) {
    return { points: max * 0.4, max, detail: "no measured record" };
  }
  // −0.5R earns nothing, +1R earns full marks.
  const normalised = Math.max(0, Math.min(1, (expectancy + 0.5) / 1.5));
  const sign = expectancy >= 0 ? "+" : "−";
  const value = `${sign}${Math.abs(expectancy).toFixed(2)}R`;
  return {
    points: normalised * max,
    max,
    detail: pooled
      ? `${value}, ${sample} setups here blended with the pattern's record`
      : `${value} over ${sample} setups`,
  };
}

/**
 * Trend strength and agreement.
 *
 * ADX says how strongly the market is trending; ±DI says which way. A pattern
 * pointing against a strong trend is the most common way to lose money on
 * otherwise correct chart reading, so disagreement scores zero rather than
 * merely less.
 */
function scoreTrend(
  adx: number,
  plusDi: number,
  minusDi: number,
  long: boolean,
): Weighted {
  const max = 17;
  if (!Number.isFinite(adx)) {
    return { points: 0, max, detail: "no reading" };
  }

  // ADX below 20 is chop; 40+ is a strong trend.
  const strength = Math.max(0, Math.min(1, (adx - 20) / 20));
  const withTrend = long ? plusDi > minusDi : minusDi > plusDi;
  const points = withTrend ? strength * max : 0;

  return {
    points,
    max,
    detail: `ADX ${adx.toFixed(0)} ${withTrend ? "with" : "against"} ${long ? "+DI" : "−DI"}`,
  };
}

/**
 * Momentum: MACD histogram for direction of thrust, RSI for room to run.
 *
 * RSI is scored as *headroom*, not as an overbought/oversold signal — a long
 * at RSI 78 may still work, but it has far less distance to travel before it
 * is fighting sellers than the same setup at 55.
 */
function scoreMomentum(
  histogram: number,
  rsi: number,
  long: boolean,
): Weighted {
  const max = 16;
  const half = max / 2;
  const thrustAligned = long ? histogram > 0 : histogram < 0;
  const thrust = thrustAligned ? half : 0;

  let headroom = 0;
  if (Number.isFinite(rsi)) {
    headroom = long
      ? Math.max(0, Math.min(1, (75 - rsi) / 30)) * half
      : Math.max(0, Math.min(1, (rsi - 25) / 30)) * half;
  }

  return {
    points: thrust + headroom,
    max,
    detail: `MACD ${thrustAligned ? "aligned" : "opposed"}, RSI ${rsi.toFixed(0)}`,
  };
}

/** Volume conviction: is anyone actually behind this move? */
function scoreVolume(relVolume: number): Weighted {
  const max = 11;
  if (!Number.isFinite(relVolume)) {
    return { points: 0, max, detail: "no reading" };
  }
  // 1× average earns nothing; 2.5× earns full marks.
  const points = Math.max(0, Math.min(1, (relVolume - 1) / 1.5)) * max;
  return { points, max, detail: `${relVolume.toFixed(1)}× avg volume` };
}

/**
 * Independence from the benchmark.
 *
 * A "signal" on a name that simply tracks SPY is a bet on the index wearing a
 * ticker's clothes. Lower correlation means the pattern is describing
 * something specific to this symbol.
 */
function scoreIndependence(corr: number): Weighted {
  const max = 8;
  if (!Number.isFinite(corr)) {
    return { points: max * 0.5, max, detail: "no benchmark data" };
  }
  const points = (1 - Math.min(1, Math.abs(corr))) * max;
  return { points, max, detail: `SPY correlation ${corr.toFixed(2)}` };
}

/**
 * Finds the bar a pattern first became visible on.
 *
 * Replaying the detector over the recent tail gives a real "detected 40m ago"
 * instead of pretending every signal appeared on the current bar.
 */
function firstDetectedAt(
  series: Series,
  patternName: string,
): number {
  const { candles } = series;
  let earliest = candles.length - 1;

  for (let back = 1; back <= DETECTION_LOOKBACK; back++) {
    const end = candles.length - back;
    if (end < 80) break;
    if (!detectPattern(candles.slice(0, end), patternName)) break;
    earliest = end - 1;
  }

  return candles[earliest].time;
}

/** Builds a signal for one symbol, or returns null if nothing qualifies. */
export function buildSignal(
  series: Series,
  benchmarkReturns: number[],
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
  /**
   * Pattern-level expectancy pooled across the other symbols in this scan.
   * Absent, scoring falls back to the symbol's own record alone — which is
   * what phase 2a measured at r = 0.03 to the future on 15m bars.
   */
  priors?: Map<string, Prior>,
): Signal | null {
  const { candles } = series;
  if (candles.length < 80) return null;

  const matches = detectPatterns(candles);
  if (matches.length === 0) return null;

  const best = matches[0];

  // Two credible patterns pointing opposite ways is not a signal.
  const opposing = matches.find((m) => m.direction !== best.direction);
  if (opposing && best.score - opposing.score < AMBIGUITY_MARGIN) return null;

  const closes = candles.map((c) => c.close);
  const atr = last(atrSeries(candles, 14));
  const levels = buildLevels(best, atr, candles[candles.length - 1].close);
  if (!levels) return null;
  if (levels.rr < MIN_RR) return null;

  const { adx, plusDi, minusDi } = adxSeries(candles, 14);
  const currentAdx = last(adx);
  const currentPlusDi = last(plusDi);
  const currentMinusDi = last(minusDi);
  const currentRsi = last(rsiSeries(closes, 14));
  const histogram = last(macdSeries(closes).histogram);
  const relVolume = last(relativeVolume(candles, 20));
  const corr = correlation(returns(closes), benchmarkReturns);

  const long = best.direction === "LONG";

  // Hard vetoes — conditions no confidence score should be able to outvote.
  if (long && currentRsi > 80) return null;
  if (!long && currentRsi < 20) return null;
  if (long && currentMinusDi - currentPlusDi > 10) return null;
  if (!long && currentPlusDi - currentMinusDi > 10) return null;

  // The track record is measured before scoring, not after, so that a pattern
  // with a demonstrated history of losing money on this symbol cannot be
  // promoted to the top of the list by good-looking geometry.
  const history = backtestPattern(candles, best.name);

  // What the engine actually scores is the symbol's record blended toward the
  // pattern's record everywhere. Phase 2a measured why: on 15m bars a pair's
  // own expectancy correlates 0.03 with its own future and the pooled figure
  // correlates 0.22, so the unblended number is close to no information at
  // all. Shrinking lifts that to 0.19 out of sample.
  const prior = priors?.get(best.name) ?? null;
  const edge = shrink(
    history.expectancy,
    history.sample,
    prior,
    EDGE_SHRINKAGE[series.timeframe] ?? DEFAULT_SHRINKAGE,
  );

  // The veto reads the blended figure for the same reason. Rejecting a signal
  // outright on a statistic that does not generalise is the most expensive
  // thing a scan can do with it.
  if (
    edge !== null &&
    edge < NEGATIVE_EDGE_VETO &&
    history.sample + (prior?.sample ?? 0) >= VETO_MIN_SAMPLE
  ) {
    return null;
  }

  const weighted: Array<[string, Weighted]> = [
    ["PATTERN", scorePattern(best.score)],
    ["EDGE", scoreEdge(edge, history.sample, prior !== null)],
    ["TREND", scoreTrend(currentAdx, currentPlusDi, currentMinusDi, long)],
    ["MOMENTUM", scoreMomentum(histogram, currentRsi, long)],
    ["VOLUME", scoreVolume(relVolume)],
    ["INDEPENDENCE", scoreIndependence(corr)],
  ];

  const confidence = Math.round(
    weighted.reduce((sum, [, w]) => sum + w.points, 0),
  );
  if (confidence < minConfidence) return null;

  const factors: SignalFactor[] = weighted.map(([label, w]) => ({
    label,
    points: Math.round(w.points),
    max: w.max,
    detail: w.detail,
  }));

  return {
    id: `${series.symbol}-${series.timeframe}-${best.name}`.replace(
      /[^A-Za-z0-9-]+/g,
      "-",
    ),
    symbol: series.symbol,
    name: series.name,
    direction: best.direction,
    timeframe: series.timeframe,

    entry: levels.entry,
    stop: levels.stop,
    target: levels.target,
    rr: levels.rr,

    price: series.price,
    previousClose: series.previousClose,

    pattern: best.name,
    patternDetail: best.detail,
    detectedAt: firstDetectedAt(series, best.name),

    confidence,
    factors,
    context: {
      adx: currentAdx,
      plusDi: currentPlusDi,
      minusDi: currentMinusDi,
      rsi: currentRsi,
      macdHistogram: histogram,
      relativeVolume: relVolume,
      benchmarkCorrelation: corr,
      atr,
    },

    historicalWinRate: history.winRate,
    historicalExpectancy: history.expectancy,
    typicalHoldBars: history.medianBarsToResolve,
    typicalHeatR: history.typicalHeatR,
    historicalSample: history.sample,
  };
}

export type ScanOptions = {
  timeframe: Timeframe;
  /** Which slice of the universe to sweep; successive passes advance. */
  pass?: number;
  /** Confidence floor for this scan. */
  minConfidence?: number;
};

/**
 * Every pattern's realised trades on every symbol in a scan, as pooling units.
 *
 * This is the input the priors are estimated from. It replays all eleven
 * detectors over every symbol rather than the one that happens to be scoring
 * best, which costs about 1.6s of CPU for a slice and avoids a selection
 * effect that would otherwise be invisible: pooling only the patterns that
 * currently look best on a symbol estimates a prior from the cases already
 * selected for looking good.
 */
function poolingUnits(series: Series[]): Unit[] {
  const units: Unit[] = [];
  for (const s of series) {
    for (const pattern of PATTERN_NAMES) {
      const rs = backtestTrades(s.candles, pattern)
        .filter((t) => t.outcome !== "UNRESOLVED")
        .map((t) => t.r);
      if (rs.length > 0) units.push({ key: s.symbol, group: pattern, rs });
    }
  }
  return units;
}

/** Sweeps a slice of the universe and returns everything that qualified. */
export async function scan({
  timeframe,
  pass = 0,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
}: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const symbols = scanSlice(pass);

  // The benchmark is fetched once and reused as the correlation reference.
  const benchmark = await getSeries(BENCHMARK, timeframe).catch(() => null);
  const benchmarkReturns = benchmark
    ? returns(benchmark.candles.map((c) => c.close))
    : [];

  const { series, failed } = await getManySeries(symbols, timeframe);

  const units = poolingUnits(series);

  const signals = series
    .map((s) => {
      try {
        // Priors exclude the symbol being scored. A prior a symbol helped
        // build is partly a measurement of itself, and shrinking toward it
        // would quietly hand back the noise this is meant to remove.
        return buildSignal(
          s,
          benchmarkReturns,
          minConfidence,
          poolPriorsExcluding(units, s.symbol),
        );
      } catch {
        // One malformed series must not take down the whole scan.
        return null;
      }
    })
    .filter((s): s is Signal => s !== null)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    signals,
    // What came back, not what was asked for: a symbol that failed to fetch
    // has not been checked, and expiring its signals would drop them on an
    // upstream hiccup rather than on evidence.
    covered: series.map((s) => s.symbol),
    pass,
    passes: passCount(),
    scanned: series.length,
    failed,
    universeSize: UNIVERSE.length,
    durationMs: Date.now() - startedAt,
    marketOpen: benchmark?.marketOpen ?? series[0]?.marketOpen ?? false,
    scannedAt: Date.now(),
  };
}
