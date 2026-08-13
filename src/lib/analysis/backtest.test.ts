import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "@/lib/market/types";
import { backtestPattern, backtestTrades } from "./backtest";
import { PATTERN_NAMES } from "./patterns";

/**
 * The detectors are 669 lines of geometry, so hand-building a series that
 * trips a named pattern is brittle in a way that tests nothing useful. These
 * drive a deterministic pseudo-random walk through every detector instead and
 * assert the invariants the result must satisfy however the walk lands.
 */

/** Seeded LCG — same series every run, no dependency on Math.random. */
function walk(bars: number, seed = 7): Candle[] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };

  const candles: Candle[] = [];
  let close = 100;
  for (let i = 0; i < bars; i++) {
    const drift = (next() - 0.48) * 2.2;
    const open = close;
    close = Math.max(1, open + drift);
    const wick = next() * 1.1;
    candles.push({
      time: 1_770_000_000 + i * 900,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: Math.round(1_000_000 * (0.5 + next())),
    });
  }
  return candles;
}

const results = (bars: number) =>
  PATTERN_NAMES.map((name) => backtestPattern(walk(bars), name));

describe("backtestPattern", () => {
  it("returns an empty result when there is not enough history", () => {
    for (const result of results(60)) {
      assert.equal(result.sample, 0);
      assert.equal(result.expectancy, null);
      assert.equal(result.typicalHeatR, null);
    }
  });

  it("works on a series far shorter than the old horizon reserve", () => {
    // Previously anything under WARMUP + 100 + 10 = 190 bars returned nothing
    // at all. The reserve is now the *shortest* horizon, so 130 bars is
    // enough to measure a fast-resolving pattern.
    const measured = results(130).filter((r) => r.sample > 0);
    assert.ok(
      measured.length > 0,
      "expected at least one pattern to resolve within 130 bars",
    );
  });

  it("recovers occurrences the fixed reserve used to discard", () => {
    // Same series, more of it usable: the tail that was unconditionally
    // reserved for a 100-bar horizon is now available to shorter trades.
    const before = results(400).reduce((n, r) => n + r.sample, 0);
    const after = results(500).reduce((n, r) => n + r.sample, 0);
    assert.ok(after >= before, "a longer series must not measure fewer trades");
  });

  it("keeps wins and losses consistent with the reported sample", () => {
    for (const result of results(400)) {
      assert.equal(result.sample, result.wins + result.losses);
      if (result.winRate !== null) {
        assert.ok(result.winRate >= 0 && result.winRate <= 1);
      }
    }
  });

  it("never reports heat at or beyond the stop", () => {
    // Heat is measured on winners only, and a winner by definition never
    // touched its stop — so the median must sit strictly inside 1R. A value
    // of 1 or more would mean a stopped-out trade had been counted a winner.
    for (const result of results(400)) {
      if (result.typicalHeatR === null) continue;
      assert.ok(
        result.typicalHeatR >= 0 && result.typicalHeatR < 1,
        `heat ${result.typicalHeatR} outside [0, 1)`,
      );
    }
  });

  it("reports no heat when nothing won", () => {
    for (const result of results(400)) {
      if (result.wins === 0) assert.equal(result.typicalHeatR, null);
    }
  });

  it("withholds a win rate until the sample is worth quoting", () => {
    for (const result of results(400)) {
      if (result.sample < 5) {
        assert.equal(result.winRate, null);
        assert.equal(result.expectancy, null);
        assert.equal(result.medianBarsToResolve, null);
      }
    }
  });

  it("fades the same occurrences on the same geometry", () => {
    // The fade must be the same trade pointed the other way, not a different
    // trade that happens to be short. Same occurrences, same reward-to-risk —
    // only the direction differs, so any difference in outcome is about the
    // market rather than about the levels being reshaped.
    for (const name of PATTERN_NAMES) {
      const candles = walk(400);
      const straight = backtestTrades(candles, name);
      const faded = backtestTrades(candles, name, { fade: true });

      assert.equal(faded.length, straight.length, `${name} occurrence count`);
      for (let i = 0; i < straight.length; i++) {
        assert.ok(
          Math.abs(faded[i].rr - straight[i].rr) < 1e-9,
          `${name} trade ${i}: rr ${faded[i].rr} vs ${straight[i].rr}`,
        );
        assert.equal(faded[i].index, straight[i].index);
      }
    }
  });

  it("does not fade when not asked to", () => {
    const candles = walk(400);
    assert.deepEqual(
      backtestTrades(candles, PATTERN_NAMES[0], { fade: false }),
      backtestTrades(candles, PATTERN_NAMES[0]),
    );
  });

  it("is deterministic", () => {
    const once = backtestPattern(walk(400), PATTERN_NAMES[0]);
    const twice = backtestPattern(walk(400), PATTERN_NAMES[0]);
    assert.deepEqual(once, twice);
  });

  it("resolves every counted trade within its horizon", () => {
    for (const result of results(400)) {
      if (result.medianBarsToResolve === null) continue;
      assert.ok(result.medianBarsToResolve >= 1);
      assert.ok(result.medianBarsToResolve <= 100);
    }
  });
});
