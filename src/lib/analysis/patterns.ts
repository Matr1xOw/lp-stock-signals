import type { Candle } from "@/lib/market/types";
import { atr, pivots, relativeVolume, sma, type Pivot } from "./indicators";

/**
 * Chart-pattern detection.
 *
 * Each detector examines the tail of a bar series and either returns a match
 * or `null`. A match describes the *geometry* only — where the pattern breaks
 * out, where it is structurally wrong, and where the measured move projects.
 * Turning that into a tradeable entry/stop/target, and deciding whether the
 * broader context supports it at all, is the signal engine's job.
 *
 * Two rules hold throughout:
 *
 *  - Detectors only use confirmed pivots, so a pattern cannot repaint into
 *    existence on the current bar and out of it on the next.
 *  - Every threshold is expressed relative to price or ATR, never in dollars,
 *    so the same detector works on a $5 stock and a $500 one.
 */

export type Direction = "LONG" | "SHORT";

export type PatternMatch = {
  /** Display name, e.g. "BULL FLAG". */
  name: string;
  direction: Direction;
  /** Geometric quality of the fit, 0–1. */
  score: number;
  /** Price level whose break triggers the pattern. */
  breakout: number;
  /** Level that structurally invalidates the pattern. */
  invalidation: number;
  /** Measured-move objective implied by the pattern's own height. */
  measured: number;
  /** First bar of the pattern, for chart annotation. */
  startIndex: number;
  /** One-line description of what was actually found. */
  detail: string;
};

export type PatternContext = {
  candles: Candle[];
  atr: number[];
  relVolume: number[];
  volumeSma: number[];
  highs: Pivot[];
  lows: Pivot[];
};

export function buildContext(candles: Candle[]): PatternContext {
  return {
    candles,
    atr: atr(candles, 14),
    relVolume: relativeVolume(candles, 20),
    volumeSma: sma(
      candles.map((c) => c.volume),
      20,
    ),
    ...pivots(candles, 3),
  };
}

/** Clamps a raw 0–1-ish quality figure into a usable score. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Highest high / lowest low over a slice. */
const highest = (candles: Candle[], from: number, to: number) =>
  Math.max(...candles.slice(from, to).map((c) => c.high));
const lowest = (candles: Candle[], from: number, to: number) =>
  Math.min(...candles.slice(from, to).map((c) => c.low));

/**
 * Bull flag: a sharp advance (the pole) followed by a shallow, orderly drift
 * against it (the flag).
 *
 * The trade is the resumption. What makes it worth taking is the *contrast* —
 * a fast impulse then a tight, low-volume pause. A deep or sloppy pullback is
 * a reversal in progress, not a flag, so retracement depth and flag tightness
 * dominate the score.
 */
function bullFlag(ctx: PatternContext): PatternMatch | null {
  const { candles } = ctx;
  const n = candles.length;
  if (n < 40) return null;

  const currentAtr = ctx.atr[n - 1];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  let best: PatternMatch | null = null;

  // Search flag lengths and pole lengths, keeping the best-scoring fit.
  for (let flagLen = 3; flagLen <= 12; flagLen++) {
    for (let poleLen = 5; poleLen <= 16; poleLen++) {
      const flagStart = n - flagLen;
      const poleStart = flagStart - poleLen;
      if (poleStart < 1) continue;

      const poleLow = lowest(candles, poleStart, flagStart);
      const poleHigh = highest(candles, poleStart, flagStart);
      const poleHeight = poleHigh - poleLow;

      // The pole must be a real impulse, not noise: at least 2 ATR of range
      // and a decisively higher close.
      if (poleHeight < currentAtr * 2) continue;
      if (candles[flagStart - 1].close < poleLow + poleHeight * 0.6) continue;

      const flagHigh = highest(candles, flagStart, n);
      const flagLow = lowest(candles, flagStart, n);

      // The flag must stay under the pole's high — a break already happened
      // otherwise, and this is no longer a setup.
      if (flagHigh > poleHigh * 1.002) continue;

      const retrace = (poleHigh - flagLow) / poleHeight;
      if (retrace > 0.5 || retrace < 0.05) continue;

      // Tightness: a good flag's range is small next to the pole it follows.
      const tightness = 1 - (flagHigh - flagLow) / poleHeight;
      if (tightness < 0.35) continue;

      // Volume should dry up during the pause.
      const poleVol = average(
        candles.slice(poleStart, flagStart).map((c) => c.volume),
      );
      const flagVol = average(candles.slice(flagStart, n).map((c) => c.volume));
      const volumeContraction =
        poleVol > 0 ? clamp01(1 - flagVol / poleVol) : 0;

      const score = clamp01(
        0.4 * tightness +
          0.3 * (1 - Math.abs(retrace - 0.3) / 0.3) +
          0.3 * volumeContraction,
      );

      if (!best || score > best.score) {
        best = {
          name: "BULL FLAG",
          direction: "LONG",
          score,
          breakout: flagHigh,
          invalidation: flagLow,
          measured: flagHigh + poleHeight,
          startIndex: poleStart,
          detail: `${poleLen}-bar pole, ${flagLen}-bar flag retracing ${(retrace * 100).toFixed(0)}%`,
        };
      }
    }
  }

  return best;
}

/** Bear flag: the mirror of a bull flag — sharp drop, shallow drift upward. */
function bearFlag(ctx: PatternContext): PatternMatch | null {
  const { candles } = ctx;
  const n = candles.length;
  if (n < 40) return null;

  const currentAtr = ctx.atr[n - 1];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  let best: PatternMatch | null = null;

  for (let flagLen = 3; flagLen <= 12; flagLen++) {
    for (let poleLen = 5; poleLen <= 16; poleLen++) {
      const flagStart = n - flagLen;
      const poleStart = flagStart - poleLen;
      if (poleStart < 1) continue;

      const poleHigh = highest(candles, poleStart, flagStart);
      const poleLow = lowest(candles, poleStart, flagStart);
      const poleHeight = poleHigh - poleLow;

      if (poleHeight < currentAtr * 2) continue;
      if (candles[flagStart - 1].close > poleHigh - poleHeight * 0.6) continue;

      const flagHigh = highest(candles, flagStart, n);
      const flagLow = lowest(candles, flagStart, n);
      if (flagLow < poleLow * 0.998) continue;

      const retrace = (flagHigh - poleLow) / poleHeight;
      if (retrace > 0.5 || retrace < 0.05) continue;

      const tightness = 1 - (flagHigh - flagLow) / poleHeight;
      if (tightness < 0.35) continue;

      const poleVol = average(
        candles.slice(poleStart, flagStart).map((c) => c.volume),
      );
      const flagVol = average(candles.slice(flagStart, n).map((c) => c.volume));
      const volumeContraction =
        poleVol > 0 ? clamp01(1 - flagVol / poleVol) : 0;

      const score = clamp01(
        0.4 * tightness +
          0.3 * (1 - Math.abs(retrace - 0.3) / 0.3) +
          0.3 * volumeContraction,
      );

      if (!best || score > best.score) {
        best = {
          name: "BEAR FLAG",
          direction: "SHORT",
          score,
          breakout: flagLow,
          invalidation: flagHigh,
          measured: flagLow - poleHeight,
          startIndex: poleStart,
          detail: `${poleLen}-bar pole, ${flagLen}-bar flag retracing ${(retrace * 100).toFixed(0)}%`,
        };
      }
    }
  }

  return best;
}

/**
 * Cup and handle: a rounded base that recovers to its old high, then pauses.
 *
 * The pattern's meaning is exhausted supply — sellers who were trapped at the
 * left rim get out on the way back up, and the shallow handle shows there are
 * few left. So the score rewards rim symmetry (a genuine round trip) and
 * punishes a deep handle, which means supply is not actually gone.
 */
function cupAndHandle(ctx: PatternContext): PatternMatch | null {
  const { candles, highs, lows } = ctx;
  const n = candles.length;
  if (n < 60 || highs.length < 1 || lows.length < 1) return null;

  // Left rim: a confirmed swing high old enough to have a cup after it.
  const leftCandidates = highs.filter((h) => h.index < n - 25);
  if (leftCandidates.length === 0) return null;

  let best: PatternMatch | null = null;

  for (const leftRim of leftCandidates.slice(-6)) {
    const cupLows = lows.filter((l) => l.index > leftRim.index);
    if (cupLows.length === 0) continue;

    const cupLow = cupLows.reduce((a, b) => (b.price < a.price ? b : a));
    const depth = leftRim.price - cupLow.price;
    if (depth <= 0) continue;

    const depthPct = depth / leftRim.price;
    // Too shallow is noise; too deep is a crash, not a base.
    if (depthPct < 0.06 || depthPct > 0.45) continue;

    // The right side must actually recover toward the rim.
    const rightHigh = highest(candles, cupLow.index, n);
    const recovery = (rightHigh - cupLow.price) / depth;
    if (recovery < 0.75) continue;

    const rightRimIndex =
      cupLow.index +
      candles
        .slice(cupLow.index, n)
        .findIndex((c) => c.high === rightHigh);

    // The handle is the drift after the right rim.
    const handleLen = n - rightRimIndex - 1;
    if (handleLen < 2 || handleLen > 20) continue;

    const handleLow = lowest(candles, rightRimIndex + 1, n);
    const handleDepth = rightHigh - handleLow;
    // A handle deeper than a third of the cup is a failed retest.
    if (handleDepth > depth * 0.35) continue;
    if (handleDepth <= 0) continue;

    const symmetry = clamp01(
      1 - Math.abs(leftRim.price - rightHigh) / (depth * 0.5),
    );
    const handleQuality = clamp01(1 - handleDepth / (depth * 0.35));
    const shape = clamp01(recovery);

    const score = clamp01(0.4 * symmetry + 0.3 * handleQuality + 0.3 * shape);

    if (!best || score > best.score) {
      best = {
        name: "CUP & HANDLE",
        direction: "LONG",
        score,
        breakout: Math.max(rightHigh, leftRim.price),
        invalidation: handleLow,
        measured: Math.max(rightHigh, leftRim.price) + depth,
        startIndex: leftRim.index,
        detail: `${(depthPct * 100).toFixed(0)}% cup, ${handleLen}-bar handle`,
      };
    }
  }

  return best;
}

/**
 * Double top / double bottom.
 *
 * Two failures at the same level, separated by a real trough, with the trade
 * being the neckline break.
 *
 * The naive version of this detector fires on almost everything: over a few
 * hundred bars, any series contains two similar highs *somewhere*, so it will
 * happily report a double top and a double bottom on the same symbol at the
 * same time. Four constraints make it mean something:
 *
 *  1. The second extreme must be recent, or the pattern already resolved.
 *  2. Nothing between the two extremes may exceed them — otherwise they are
 *     incidental pivots on a trend, not twin peaks.
 *  3. Price must still be positioned to trade the break, neither collapsed
 *     through the neckline already nor broken out the far side.
 *  4. There must be a prior move for the pattern to reverse.
 */
function doubleExtreme(
  ctx: PatternContext,
  direction: Direction,
): PatternMatch | null {
  const { candles, highs, lows } = ctx;
  const n = candles.length;
  if (n < 60) return null;

  const currentAtr = ctx.atr[n - 1];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  const isTop = direction === "SHORT";
  const extremes = isTop ? highs : lows;
  const counters = isTop ? lows : highs;
  if (extremes.length < 2 || counters.length < 1) return null;

  const close = candles[n - 1].close;
  const recent = extremes.slice(-6);
  let best: PatternMatch | null = null;

  for (let i = 0; i < recent.length - 1; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const first = recent[i];
      const second = recent[j];

      // (1) The setup has to be live, not a historical curiosity.
      if (second.index < n - 25) continue;

      const separation = second.index - first.index;
      if (separation < 6 || separation > 60) continue;

      const divergence =
        Math.abs(first.price - second.price) / Math.abs(first.price);
      if (divergence > 0.02) continue;

      const peak = isTop
        ? Math.max(first.price, second.price)
        : Math.min(first.price, second.price);

      // (2) Neither peak may be overtopped by the price action between them.
      const span = candles.slice(first.index, second.index + 1);
      const exceeded = isTop
        ? Math.max(...span.map((c) => c.high)) > peak * 1.003
        : Math.min(...span.map((c) => c.low)) < peak * 0.997;
      if (exceeded) continue;

      // The neckline is the counter-pivot trapped between the two extremes.
      const between = counters.filter(
        (c) => c.index > first.index && c.index < second.index,
      );
      if (between.length === 0) continue;

      const neckline = isTop
        ? between.reduce((a, b) => (b.price < a.price ? b : a))
        : between.reduce((a, b) => (b.price > a.price ? b : a));

      const height = isTop ? peak - neckline.price : neckline.price - peak;
      if (height <= 0) continue;

      const heightPct = height / neckline.price;
      if (heightPct < 0.025) continue;

      // (3) Still tradeable: price sits between the neckline and the peaks,
      // give or take an ATR on either side.
      const inPosition = isTop
        ? close > neckline.price - currentAtr && close < peak + currentAtr
        : close < neckline.price + currentAtr && close > peak - currentAtr;
      if (!inPosition) continue;

      // (4) A reversal needs something to reverse. Look back a pattern-width
      // before the first peak and require a move into it of similar scale.
      const runupStart = Math.max(0, first.index - separation);
      const priorSwing = isTop
        ? peak - lowest(candles, runupStart, first.index + 1)
        : highest(candles, runupStart, first.index + 1) - peak;
      if (priorSwing < height * 0.8) continue;

      const match = clamp01(1 - divergence / 0.02);
      const spacing = clamp01(separation / 30);
      const prominence = clamp01(heightPct / 0.08);
      const score = clamp01(0.4 * match + 0.2 * spacing + 0.4 * prominence);

      if (!best || score > best.score) {
        best = {
          name: isTop ? "DOUBLE TOP" : "DOUBLE BOTTOM",
          direction,
          score,
          breakout: neckline.price,
          invalidation: peak,
          measured: isTop ? neckline.price - height : neckline.price + height,
          startIndex: first.index,
          detail: `peaks ${(divergence * 100).toFixed(1)}% apart, ${separation} bars`,
        };
      }
    }
  }

  return best;
}

/**
 * Ascending / descending triangle.
 *
 * One flat boundary being tested repeatedly while the other converges on it.
 * The flat side is where the resting order sits; the converging side is the
 * side that keeps paying up (or down) to reach it, which is why the break
 * usually goes through the flat boundary.
 */
function triangle(
  ctx: PatternContext,
  direction: Direction,
): PatternMatch | null {
  const { candles, highs, lows } = ctx;
  const n = candles.length;
  if (n < 40) return null;

  const ascending = direction === "LONG";
  const flatSide = (ascending ? highs : lows).slice(-4);
  const slopedSide = (ascending ? lows : highs).slice(-4);
  if (flatSide.length < 2 || slopedSide.length < 2) return null;

  // The flat boundary: recent pivots clustered at one price.
  const flatPrices = flatSide.map((p) => p.price);
  const flatLevel = average(flatPrices);
  const flatSpread =
    (Math.max(...flatPrices) - Math.min(...flatPrices)) / flatLevel;
  if (flatSpread > 0.02) return null;

  // The sloped boundary must actually converge toward the flat one.
  const firstSloped = slopedSide[0];
  const lastSloped = slopedSide[slopedSide.length - 1];
  const drift = (lastSloped.price - firstSloped.price) / firstSloped.price;
  if (ascending ? drift <= 0.005 : drift >= -0.005) return null;

  const height = Math.abs(flatLevel - firstSloped.price);
  if (height / flatLevel < 0.02) return null;

  const startIndex = Math.min(flatSide[0].index, firstSloped.index);
  // Price should still be inside the triangle, approaching the apex.
  const currentClose = candles[n - 1].close;
  if (ascending && currentClose > flatLevel * 1.005) return null;
  if (!ascending && currentClose < flatLevel * 0.995) return null;

  const flatness = clamp01(1 - flatSpread / 0.02);
  const convergence = clamp01(Math.abs(drift) / 0.06);
  const tests = clamp01(flatSide.length / 4);
  const score = clamp01(0.4 * flatness + 0.35 * convergence + 0.25 * tests);

  return {
    name: ascending ? "ASC TRIANGLE" : "DESC TRIANGLE",
    direction,
    score,
    breakout: flatLevel,
    invalidation: lastSloped.price,
    measured: ascending ? flatLevel + height : flatLevel - height,
    startIndex,
    detail: `${flatSide.length} tests of ${flatLevel.toFixed(2)}, ${ascending ? "rising" : "falling"} base`,
  };
}

/**
 * Volume breakout: a close beyond a multi-week extreme on conviction volume.
 *
 * The volume requirement is the whole pattern. Price poking through a prior
 * high on thin trade is a liquidity event that usually reverses; the same
 * break on 2x average volume means real participation.
 */
function volumeBreakout(ctx: PatternContext): PatternMatch | null {
  const { candles } = ctx;
  const n = candles.length;
  const lookback = 20;
  if (n < lookback + 25) return null;

  const currentAtr = ctx.atr[n - 1];
  const rvol = ctx.relVolume[n - 1];
  if (!Number.isFinite(currentAtr) || !Number.isFinite(rvol)) return null;
  if (rvol < 1.8) return null;

  const bar = candles[n - 1];
  const priorHigh = highest(candles, n - 1 - lookback, n - 1);
  const priorLow = lowest(candles, n - 1 - lookback, n - 1);

  const conviction = clamp01((rvol - 1.8) / 2.2);

  if (bar.close > priorHigh) {
    // Reward closing near the bar's high — a strong close held the break.
    const closeStrength = clamp01(
      (bar.close - bar.low) / Math.max(bar.high - bar.low, 1e-9),
    );
    return {
      name: "VOL BREAKOUT",
      direction: "LONG",
      score: clamp01(0.6 * conviction + 0.4 * closeStrength),
      breakout: priorHigh,
      invalidation: Math.min(bar.low, priorHigh - currentAtr),
      measured: bar.close + currentAtr * 3,
      startIndex: n - 1 - lookback,
      detail: `${lookback}-bar high on ${rvol.toFixed(1)}× volume`,
    };
  }

  if (bar.close < priorLow) {
    const closeStrength = clamp01(
      (bar.high - bar.close) / Math.max(bar.high - bar.low, 1e-9),
    );
    return {
      name: "VOL BREAKDOWN",
      direction: "SHORT",
      score: clamp01(0.6 * conviction + 0.4 * closeStrength),
      breakout: priorLow,
      invalidation: Math.max(bar.high, priorLow + currentAtr),
      measured: bar.close - currentAtr * 3,
      startIndex: n - 1 - lookback,
      detail: `${lookback}-bar low on ${rvol.toFixed(1)}× volume`,
    };
  }

  return null;
}

/**
 * Engulfing reversal.
 *
 * A bar whose body swallows the previous one, at the end of a run in the
 * opposite direction. Context is what separates a reversal from a random
 * large bar, so this requires a preceding trend and rejects the pattern in
 * the middle of a range.
 */
function engulfing(ctx: PatternContext): PatternMatch | null {
  const { candles } = ctx;
  const n = candles.length;
  if (n < 30) return null;

  const currentAtr = ctx.atr[n - 1];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  const bar = candles[n - 1];
  const prev = candles[n - 2];
  const body = Math.abs(bar.close - bar.open);
  const prevBody = Math.abs(prev.close - prev.open);
  // The engulfing bar must be substantial in its own right.
  if (body < currentAtr * 0.8 || body <= prevBody) return null;

  const priorRun = candles.slice(n - 8, n - 1);
  const runHigh = Math.max(...priorRun.map((c) => c.high));
  const runLow = Math.min(...priorRun.map((c) => c.low));
  const rvol = ctx.relVolume[n - 1];
  const conviction = Number.isFinite(rvol) ? clamp01((rvol - 1) / 1.5) : 0;
  const dominance = clamp01(body / (prevBody * 2));

  const bearish =
    bar.close < bar.open &&
    prev.close > prev.open &&
    bar.open >= prev.close &&
    bar.close <= prev.open;

  if (bearish && prev.high >= runHigh * 0.999) {
    return {
      name: "BEAR ENGULF",
      direction: "SHORT",
      score: clamp01(0.45 * dominance + 0.3 * conviction + 0.25),
      breakout: bar.close,
      invalidation: bar.high,
      measured: bar.close - currentAtr * 2.5,
      startIndex: n - 8,
      detail: `engulfs ${(body / prevBody).toFixed(1)}× prior body at swing high`,
    };
  }

  const bullish =
    bar.close > bar.open &&
    prev.close < prev.open &&
    bar.open <= prev.close &&
    bar.close >= prev.open;

  if (bullish && prev.low <= runLow * 1.001) {
    return {
      name: "BULL ENGULF",
      direction: "LONG",
      score: clamp01(0.45 * dominance + 0.3 * conviction + 0.25),
      breakout: bar.close,
      invalidation: bar.low,
      measured: bar.close + currentAtr * 2.5,
      startIndex: n - 8,
      detail: `engulfs ${(body / prevBody).toFixed(1)}× prior body at swing low`,
    };
  }

  return null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const DETECTORS: Array<(ctx: PatternContext) => PatternMatch | null> = [
  bullFlag,
  bearFlag,
  cupAndHandle,
  (ctx) => doubleExtreme(ctx, "SHORT"),
  (ctx) => doubleExtreme(ctx, "LONG"),
  (ctx) => triangle(ctx, "LONG"),
  (ctx) => triangle(ctx, "SHORT"),
  volumeBreakout,
  engulfing,
];

/**
 * Detector responsible for each pattern name.
 *
 * Some detectors can emit either of a bullish/bearish pair, so several names
 * map to the same function; `detectPattern` filters the result by name.
 */
const BY_NAME: Record<
  string,
  (ctx: PatternContext) => PatternMatch | null
> = {
  "BULL FLAG": bullFlag,
  "BEAR FLAG": bearFlag,
  "CUP & HANDLE": cupAndHandle,
  "DOUBLE TOP": (ctx) => doubleExtreme(ctx, "SHORT"),
  "DOUBLE BOTTOM": (ctx) => doubleExtreme(ctx, "LONG"),
  "ASC TRIANGLE": (ctx) => triangle(ctx, "LONG"),
  "DESC TRIANGLE": (ctx) => triangle(ctx, "SHORT"),
  "VOL BREAKOUT": volumeBreakout,
  "VOL BREAKDOWN": volumeBreakout,
  "BULL ENGULF": engulfing,
  "BEAR ENGULF": engulfing,
};

export const PATTERN_NAMES = Object.keys(BY_NAME);

/** Runs every detector and returns the matches, best-scoring first. */
export function detectPatterns(candles: Candle[]): PatternMatch[] {
  const ctx = buildContext(candles);
  return DETECTORS.map((detect) => detect(ctx))
    .filter((m): m is PatternMatch => m !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * Runs a single named detector.
 *
 * The backtest needs this: replaying every detector across hundreds of
 * historical windows costs nine times more than replaying the one pattern
 * whose track record is actually being measured.
 */
export function detectPattern(
  candles: Candle[],
  name: string,
): PatternMatch | null {
  const detect = BY_NAME[name];
  if (!detect) return null;
  const match = detect(buildContext(candles));
  return match && match.name === name ? match : null;
}
