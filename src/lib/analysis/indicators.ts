import type { Candle } from "@/lib/market/types";

/**
 * Technical indicators.
 *
 * Every function returns an array the same length as its input, with `NaN`
 * for the warm-up bars where the indicator is not yet defined. Keeping the
 * arrays aligned means callers can index by bar without tracking offsets, and
 * `NaN` propagates through arithmetic so a half-warmed indicator can never
 * quietly masquerade as a real reading — callers gate on `Number.isFinite`.
 *
 * Smoothed indicators (RSI, ATR, ADX) use Wilder's smoothing, which is what
 * the standard definitions of those indicators specify.
 */

const nanArray = (length: number) => new Array<number>(length).fill(NaN);

export function sma(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  if (period <= 0) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, the conventional start.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing: an EMA with k = 1/period, seeded with a simple mean. */
function wilder(values: number[], period: number): number[] {
  const out = nanArray(values.length);
  if (period <= 0 || values.length < period) return out;

  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = nanArray(closes.length);
  if (closes.length <= period) return out;

  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }

  // Drop the synthetic zero at index 0 before smoothing, then realign.
  const avgGain = wilder(gains.slice(1), period);
  const avgLoss = wilder(losses.slice(1), period);

  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) continue;
    // No losses in the window means a maximal reading, not a divide-by-zero.
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export type Macd = { macd: number[]; signal: number[]; histogram: number[] };

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): Macd {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line = closes.map((_, i) => fastEma[i] - slowEma[i]);

  // The signal line is an EMA of the MACD line, which only exists from the
  // slow EMA onward — so it is computed over the defined tail and realigned.
  const start = slow - 1;
  const defined = line.slice(start).filter(Number.isFinite);
  const signalTail = ema(defined, signalPeriod);

  const signal = nanArray(closes.length);
  signalTail.forEach((v, i) => {
    signal[start + i] = v;
  });

  return {
    macd: line,
    signal,
    histogram: line.map((v, i) => v - signal[i]),
  };
}

/**
 * True range per bar.
 *
 * Index 0 is `NaN`: true range is defined against the previous close, and the
 * first bar has none. Substituting its high-low range there would contaminate
 * the seed average of every Wilder-smoothed indicator built on it.
 */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return NaN;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  });
}

export function atr(candles: Candle[], period = 14): number[] {
  const smoothed = wilder(trueRange(candles).slice(1), period);
  const out = nanArray(candles.length);
  smoothed.forEach((v, i) => {
    out[i + 1] = v;
  });
  return out;
}

export type Adx = { adx: number[]; plusDi: number[]; minusDi: number[] };

/**
 * Average Directional Index with its two directional indicators.
 *
 * ADX measures trend *strength* without regard to direction; +DI vs -DI gives
 * the direction. The engine uses ADX to separate genuine trends from chop,
 * which is where most false pattern signals come from.
 */
export function adx(candles: Candle[], period = 14): Adx {
  const n = candles.length;
  const result: Adx = {
    adx: nanArray(n),
    plusDi: nanArray(n),
    minusDi: nanArray(n),
  };
  if (n <= period * 2) return result;

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    // Only the larger move counts, and only when it is positive; an inside
    // bar contributes nothing to either side.
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const tr = trueRange(candles).slice(1);
  const smoothTr = wilder(tr, period);
  const smoothPlus = wilder(plusDm, period);
  const smoothMinus = wilder(minusDm, period);

  const dx: number[] = nanArray(tr.length);
  for (let i = 0; i < tr.length; i++) {
    const t = smoothTr[i];
    if (!Number.isFinite(t) || t === 0) continue;

    const pdi = (smoothPlus[i] / t) * 100;
    const mdi = (smoothMinus[i] / t) * 100;
    result.plusDi[i + 1] = pdi;
    result.minusDi[i + 1] = mdi;

    const sum = pdi + mdi;
    if (sum > 0) dx[i] = (Math.abs(pdi - mdi) / sum) * 100;
  }

  // ADX is Wilder's smoothing of DX, which itself only starts at `period`.
  const dxDefined = dx.slice(period - 1).filter(Number.isFinite);
  const adxTail = wilder(dxDefined, period);
  adxTail.forEach((v, i) => {
    result.adx[period + i] = v;
  });

  return result;
}

/** Current volume as a multiple of its own recent average. */
export function relativeVolume(candles: Candle[], period = 20): number[] {
  const volumes = candles.map((c) => c.volume);
  const average = sma(volumes, period);
  return volumes.map((v, i) => (average[i] > 0 ? v / average[i] : NaN));
}

/**
 * Least-squares slope of the last `period` values, normalised by their mean.
 *
 * Returned as a fractional change per bar so it is comparable across symbols
 * at different price levels — a $500 stock and a $5 stock trending equally
 * hard produce the same number.
 */
export function slope(values: number[], period: number): number {
  const window = values.slice(-period).filter(Number.isFinite);
  const n = window.length;
  if (n < 2) return NaN;

  const meanX = (n - 1) / 2;
  const meanY = window.reduce((a, b) => a + b, 0) / n;
  if (meanY === 0) return NaN;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (window[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  return denominator === 0 ? NaN : numerator / denominator / meanY;
}

/**
 * Pearson correlation between two equal-length return streams.
 *
 * Used to measure how much of a symbol's move is really just the market's
 * move — a "signal" that only tracks SPY is not an edge.
 */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;

  const x = a.slice(-n);
  const y = b.slice(-n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denominator = Math.sqrt(varX * varY);
  return denominator === 0 ? NaN : cov / denominator;
}

/** Bar-over-bar returns, one shorter than the input. */
export function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i - 1] === 0 ? 0 : closes[i] / closes[i - 1] - 1);
  }
  return out;
}

export type Pivot = { index: number; price: number };

/**
 * Confirmed swing highs and lows.
 *
 * A pivot needs `strength` bars on each side that fail to exceed it, so the
 * most recent `strength` bars can never form one. That lag is deliberate:
 * an unconfirmed pivot is just the current bar, and patterns built on those
 * repaint as new data arrives.
 */
export function pivots(
  candles: Candle[],
  strength = 3,
): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];

  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }

  return { highs, lows };
}

/** The last finite value in a series, or `NaN` if there is none. */
export function last(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return NaN;
}
