import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adx,
  atr,
  correlation,
  ema,
  last,
  macd,
  pivots,
  relativeVolume,
  rsi,
  sma,
  slope,
  trueRange,
} from "./indicators";
import type { Candle } from "@/lib/market/types";

/**
 * Indicator tests.
 *
 * These check three things that matter more than exact values: that warm-up
 * periods start on the right bar, that Wilder-smoothed indicators match their
 * standard definitions, and that degenerate inputs produce `NaN` rather than
 * a plausible-looking wrong number.
 *
 * The expected values were cross-checked against the `technicalindicators`
 * reference implementation on live market data during development.
 */

/** Builds candles from closes, with a fixed range around each close. */
function candlesFrom(closes: number[], range = 1, volume = 1_000): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 900,
    open: i === 0 ? close : closes[i - 1],
    high: Math.max(close, i === 0 ? close : closes[i - 1]) + range / 2,
    low: Math.min(close, i === 0 ? close : closes[i - 1]) - range / 2,
    close,
    volume,
  }));
}

const ramp = (n: number, start = 100, step = 1) =>
  Array.from({ length: n }, (_, i) => start + i * step);

describe("sma", () => {
  it("is undefined until the window is full, then averages it", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    assert.ok(Number.isNaN(result[0]));
    assert.ok(Number.isNaN(result[1]));
    assert.equal(result[2], 2); // (1+2+3)/3
    assert.equal(result[3], 3);
    assert.equal(result[4], 4);
  });

  it("returns all NaN when the period exceeds the data", () => {
    assert.ok(sma([1, 2], 5).every(Number.isNaN));
  });
});

describe("ema", () => {
  it("seeds with the SMA of the first period", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const result = ema(values, 3);
    assert.ok(Number.isNaN(result[1]));
    assert.equal(result[2], 2); // seed = (1+2+3)/3
    // k = 2/(3+1) = 0.5, so next = 4*0.5 + 2*0.5 = 3
    assert.equal(result[3], 3);
  });

  it("tracks a constant series exactly", () => {
    const flat = new Array(20).fill(7);
    assert.equal(last(ema(flat, 5)), 7);
  });
});

describe("rsi", () => {
  it("reads 100 when every bar advances", () => {
    // With no down closes the average loss is zero, which must saturate
    // rather than divide by zero.
    assert.equal(last(rsi(ramp(40), 14)), 100);
  });

  it("reads 0 when every bar declines", () => {
    assert.equal(last(rsi(ramp(40, 100, -1), 14)), 0);
  });

  it("sits near 50 for a symmetric zigzag", () => {
    const zigzag = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
    const value = last(rsi(zigzag, 14));
    assert.ok(value > 40 && value < 60, `expected ~50, got ${value}`);
  });

  it("starts one bar after the period", () => {
    const result = rsi(ramp(30), 14);
    assert.ok(Number.isNaN(result[13]));
    assert.ok(Number.isFinite(result[14]));
  });
});

describe("trueRange / atr", () => {
  it("leaves the first bar undefined, having no prior close", () => {
    // True range is defined against the previous close; bar 0 has none, and
    // substituting its high-low would contaminate every Wilder seed built
    // on it.
    assert.ok(Number.isNaN(trueRange(candlesFrom([10, 11, 12]))[0]));
  });

  it("starts ATR at the period, matching the standard definition", () => {
    const result = atr(candlesFrom(ramp(40)), 14);
    assert.ok(Number.isNaN(result[13]));
    assert.ok(Number.isFinite(result[14]));
  });

  it("equals the constant range of a uniform series", () => {
    // Each bar advances 1 with a range of 1 around it, so true range is
    // consistently 2: from the prior close to this bar's high.
    const value = last(atr(candlesFrom(ramp(50), 1), 14));
    assert.ok(Math.abs(value - 2) < 1e-9, `expected 2, got ${value}`);
  });
});

describe("adx", () => {
  it("reports a strong uptrend with +DI above −DI", () => {
    const { adx: strength, plusDi, minusDi } = adx(candlesFrom(ramp(80)), 14);
    assert.ok(last(strength) > 40, `expected a strong trend, got ${last(strength)}`);
    assert.ok(last(plusDi) > last(minusDi));
  });

  it("reports a strong downtrend with −DI above +DI", () => {
    const { adx: strength, plusDi, minusDi } = adx(
      candlesFrom(ramp(80, 200, -1)),
      14,
    );
    assert.ok(last(strength) > 40);
    assert.ok(last(minusDi) > last(plusDi));
  });

  it("returns NaN when there are too few bars to smooth twice", () => {
    assert.ok(adx(candlesFrom(ramp(20)), 14).adx.every(Number.isNaN));
  });
});

describe("macd", () => {
  it("puts the line above the signal in an accelerating advance", () => {
    // Deliberately not a straight line: on a perfectly linear ramp the MACD
    // line settles to a constant and the signal EMA converges onto it, so
    // the histogram tends to zero. Separation requires acceleration.
    const accelerating = Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i);
    const { macd: line, signal, histogram } = macd(accelerating);
    assert.ok(last(line) > 0);
    assert.ok(last(line) > last(signal));
    assert.ok(last(histogram) > 0);
  });

  it("starts the signal line after both EMAs exist", () => {
    const { signal } = macd(ramp(120), 12, 26, 9);
    // Slow EMA defines from bar 25; the 9-period signal needs 9 of those.
    assert.ok(Number.isNaN(signal[32]));
    assert.ok(Number.isFinite(signal[33]));
  });
});

describe("relativeVolume", () => {
  it("reports the ratio of current volume to its average", () => {
    const candles = candlesFrom(ramp(30));
    candles[candles.length - 1].volume = 3_000;
    // The average includes the current bar, so a 3,000 print against
    // nineteen 1,000s averages 1,100 and reads 2.73x rather than 3x.
    const expected = 3_000 / ((19 * 1_000 + 3_000) / 20);
    assert.ok(Math.abs(last(relativeVolume(candles, 20)) - expected) < 1e-9);
  });
});

describe("slope", () => {
  it("is positive when rising and negative when falling", () => {
    assert.ok(slope(ramp(20), 10) > 0);
    assert.ok(slope(ramp(20, 100, -1), 10) < 0);
  });

  it("is scale-free, so equal percentage trends score equally", () => {
    // A $500 stock and a $5 stock trending at the same rate must produce the
    // same number, or the score would just rank stocks by price.
    const expensive = Array.from({ length: 20 }, (_, i) => 500 * 1.01 ** i);
    const cheap = Array.from({ length: 20 }, (_, i) => 5 * 1.01 ** i);
    assert.ok(Math.abs(slope(expensive, 20) - slope(cheap, 20)) < 1e-6);
  });

  it("is NaN without enough points", () => {
    assert.ok(Number.isNaN(slope([1], 5)));
  });
});

describe("correlation", () => {
  it("is 1 for identical series and −1 for inverted ones", () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.02];
    assert.ok(Math.abs(correlation(a, a) - 1) < 1e-9);
    assert.ok(Math.abs(correlation(a, a.map((v) => -v)) + 1) < 1e-9);
  });

  it("is NaN when a series has no variance", () => {
    // A flat series has zero standard deviation, so correlation is undefined
    // rather than zero.
    assert.ok(Number.isNaN(correlation([1, 1, 1, 1], [1, 2, 3, 4])));
  });
});

describe("pivots", () => {
  it("finds a swing high with enough bars either side", () => {
    // Highs given explicitly: the shared helper derives a bar's high from the
    // previous close, which would make the bar after a spike tie with it.
    const highs = [10, 11, 12, 13, 20, 13, 12, 11, 10];
    const candles = highs.map((high, i) => ({
      time: i,
      open: high,
      high,
      low: high - 1,
      close: high,
      volume: 1_000,
    }));
    const found = pivots(candles, 3).highs;
    assert.equal(found.length, 1);
    assert.equal(found[0].index, 4);
  });

  it("never reports a pivot inside the confirmation window", () => {
    // The last `strength` bars cannot be confirmed yet; reporting them would
    // let patterns repaint as new bars arrive.
    const closes = ramp(20).concat([100]);
    const { highs } = pivots(candlesFrom(closes, 0), 3);
    assert.ok(highs.every((p) => p.index < closes.length - 3));
  });
});

describe("last", () => {
  it("skips trailing NaN and returns NaN when nothing is finite", () => {
    assert.equal(last([1, 2, NaN]), 2);
    assert.ok(Number.isNaN(last([NaN, NaN])));
    assert.ok(Number.isNaN(last([])));
  });
});
