import type { SignalFactor } from "./types";

/**
 * Turning a pattern and its market context into a confidence score.
 *
 * Separated from the engine because the engine is `server-only` — it fetches —
 * while scoring is a pure function of numbers. The confidence harness has to
 * recompute these at historical bars to ask whether a signal scoring 80
 * actually beats one scoring 60, and it cannot import a module that reaches
 * for the network.
 */

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


export type ScoreInputs = {
  /** Pattern geometry quality, 0-1. */
  patternQuality: number;
  /** Measured edge, already shrunk toward the pattern prior. */
  edge: number | null;
  /** This symbol's own resolved trades behind `edge`. */
  edgeSample: number;
  /** Whether `edge` had a prior to blend with. */
  edgePooled: boolean;
  adx: number;
  plusDi: number;
  minusDi: number;
  rsi: number;
  macdHistogram: number;
  relativeVolume: number;
  benchmarkCorrelation: number;
  long: boolean;
};

/** The six factors and the score they add up to. */
export function scoreSignal(inputs: ScoreInputs): {
  confidence: number;
  factors: SignalFactor[];
} {
  const weighted: Array<[string, Weighted]> = [
    ["PATTERN", scorePattern(inputs.patternQuality)],
    ["EDGE", scoreEdge(inputs.edge, inputs.edgeSample, inputs.edgePooled)],
    [
      "TREND",
      scoreTrend(inputs.adx, inputs.plusDi, inputs.minusDi, inputs.long),
    ],
    [
      "MOMENTUM",
      scoreMomentum(inputs.macdHistogram, inputs.rsi, inputs.long),
    ],
    ["VOLUME", scoreVolume(inputs.relativeVolume)],
    ["INDEPENDENCE", scoreIndependence(inputs.benchmarkCorrelation)],
  ];

  return {
    confidence: Math.round(weighted.reduce((sum, [, w]) => sum + w.points, 0)),
    factors: weighted.map(([label, w]) => ({
      label,
      points: Math.round(w.points),
      max: w.max,
      detail: w.detail,
    })),
  };
}
