import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLevels } from "./levels";
import type { PatternMatch } from "@/lib/analysis/patterns";

/**
 * Level construction.
 *
 * The live engine and the backtest both go through `buildLevels`, so these
 * tests pin the behaviour they share. If the two ever diverged, the "hist
 * win %" on a signal card would describe a different trade than the one being
 * offered.
 */

function match(overrides: Partial<PatternMatch> = {}): PatternMatch {
  return {
    name: "BULL FLAG",
    direction: "LONG",
    score: 0.8,
    breakout: 100,
    invalidation: 96,
    measured: 112,
    startIndex: 0,
    detail: "",
    ...overrides,
  };
}

describe("buildLevels", () => {
  it("triggers at the breakout when price is still below it", () => {
    const levels = buildLevels(match(), 2, 98);
    assert.ok(levels);
    assert.equal(levels.entry, 100);
  });

  it("enters at market when price has already broken out", () => {
    // The trigger is behind us; the trade is at the current price.
    const levels = buildLevels(match(), 2, 103);
    assert.ok(levels);
    assert.equal(levels.entry, 103);
  });

  it("mirrors the entry rule for shorts", () => {
    const short = match({
      direction: "SHORT",
      breakout: 100,
      invalidation: 104,
      measured: 88,
    });
    assert.equal(buildLevels(short, 2, 102)?.entry, 100);
    assert.equal(buildLevels(short, 2, 97)?.entry, 97);
  });

  it("places the stop beyond the invalidation, not on it", () => {
    // Sitting exactly on the level would eject the trade on ordinary noise
    // around it.
    const levels = buildLevels(match(), 2, 98);
    assert.ok(levels);
    assert.ok(levels.stop < 96, `expected below 96, got ${levels.stop}`);
    assert.equal(levels.stop, 96 - 2 * 0.25);
  });

  it("computes reward-to-risk from the final levels", () => {
    const levels = buildLevels(match(), 2, 98);
    assert.ok(levels);
    const risk = levels.entry - levels.stop;
    const reward = levels.target - levels.entry;
    assert.ok(Math.abs(levels.rr - reward / risk) < 1e-9);
    assert.ok(Math.abs(levels.risk - risk) < 1e-9);
  });

  it("clamps a stop that would sit absurdly close to entry", () => {
    // Invalidation almost at entry would imply a near-infinite R:R.
    const levels = buildLevels(match({ invalidation: 99.99 }), 2, 100);
    assert.ok(levels);
    assert.ok(levels.risk >= 2 * 0.5 - 1e-9);
  });

  it("clamps a stop that would sit absurdly far from entry", () => {
    const levels = buildLevels(match({ invalidation: 50 }), 2, 100);
    assert.ok(levels);
    assert.ok(levels.risk <= 2 * 3 + 1e-9);
  });

  it("rejects a trade whose stop exceeds the risk ceiling", () => {
    // 3 ATR on a wide-ATR name can still be more than 10% of price, which is
    // too much to size sanely.
    assert.equal(buildLevels(match({ invalidation: 60 }), 20, 100), null);
  });

  it("rejects a target already reached", () => {
    // Price has run past the objective; there is no trade left to take.
    assert.equal(buildLevels(match({ measured: 99 }), 2, 100), null);
  });

  it("rejects an inverted stop", () => {
    // A "long" whose invalidation sits above entry is not a long.
    assert.equal(buildLevels(match({ invalidation: 105 }), 2, 100), null);
  });

  it("rejects a missing or zero ATR rather than dividing by it", () => {
    assert.equal(buildLevels(match(), NaN, 100), null);
    assert.equal(buildLevels(match(), 0, 100), null);
  });
});
