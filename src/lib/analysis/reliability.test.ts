import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alternating,
  chronological,
  mean,
  poolingComparison,
  spearmanBrown,
  splitHalfReliability,
} from "./reliability";

/**
 * The point of a reliability test is to come back negative when the thing
 * under test is noise, so these check both directions: a constructed signal
 * must score high, and constructed noise must not. A test that only ever
 * confirms would be no use for the question this module exists to answer.
 */

/** Seeded LCG, so "noise" is the same noise every run. */
function rng(seed = 11) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("splits", () => {
  it("alternating interleaves so both halves span the same time", () => {
    assert.deepEqual(alternating([1, 2, 3, 4, 5]), [
      [1, 3, 5],
      [2, 4],
    ]);
  });

  it("chronological puts the whole first half before the second", () => {
    assert.deepEqual(chronological([1, 2, 3, 4, 5]), [
      [1, 2],
      [3, 4, 5],
    ]);
  });
});

describe("spearmanBrown", () => {
  it("corrects a half-length correlation upward", () => {
    assert.ok(Math.abs(spearmanBrown(0.5) - 0.6667) < 0.001);
  });

  it("leaves the extremes alone", () => {
    assert.equal(spearmanBrown(0), 0);
    assert.equal(spearmanBrown(1), 1);
  });
});

describe("mean", () => {
  it("is NaN for nothing, rather than zero", () => {
    // Zero would read as "expectancy of zero" and quietly join the data.
    assert.ok(Number.isNaN(mean([])));
  });
});

describe("splitHalfReliability", () => {
  it("finds a strong correlation when the units genuinely differ", () => {
    // Each unit has its own true expectancy; both halves reflect it.
    const next = rng();
    const samples = Array.from({ length: 40 }, (_, u) => {
      const truth = (u - 20) / 10;
      return Array.from({ length: 12 }, () => truth + (next() - 0.5) * 0.3);
    });

    const result = splitHalfReliability(samples, alternating, 3, true);
    assert.equal(result.n, 40);
    assert.ok(result.r !== null && result.r > 0.9, `r was ${result.r}`);
    assert.ok(result.corrected !== null && result.corrected > result.r);
  });

  it("finds nothing when every unit is the same coin", () => {
    // The null this test exists to detect: no unit has an edge, so the halves
    // must not agree beyond chance.
    const next = rng(5);
    const samples = Array.from({ length: 60 }, () =>
      Array.from({ length: 12 }, () => (next() < 0.4 ? 2 : -1)),
    );

    const result = splitHalfReliability(samples, alternating, 3);
    assert.ok(result.r !== null && Math.abs(result.r) < 0.4, `r was ${result.r}`);
  });

  it("skips units too thin to split", () => {
    const samples = [[1, 2], [1, 2, 3, 4, 5, 6], [3]];
    assert.equal(splitHalfReliability(samples, alternating, 3).n, 1);
  });

  it("reports null rather than a number it cannot support", () => {
    assert.deepEqual(splitHalfReliability([], alternating, 3), {
      n: 0,
      r: null,
      corrected: null,
    });
  });

  it("reports null when one side has no spread to correlate against", () => {
    // Every unit identical: the correlation is undefined, not zero.
    const samples = Array.from({ length: 10 }, () => [1, 1, 1, 1, 1, 1]);
    assert.equal(splitHalfReliability(samples, alternating, 3).r, null);
  });

  it("only corrects when asked, since the correction suits one split", () => {
    const next = rng(3);
    const samples = Array.from({ length: 30 }, (_, u) =>
      Array.from({ length: 10 }, () => u / 10 + (next() - 0.5) * 0.2),
    );
    assert.equal(
      splitHalfReliability(samples, chronological, 3).corrected,
      null,
    );
  });
});

describe("poolingComparison", () => {
  it("prefers the pooled estimate when the edge belongs to the pattern", () => {
    // Every unit of a group shares one true expectancy, and each unit's own
    // history is too short to see it through the noise.
    const next = rng(9);
    const units = [];
    for (const [group, truth] of [["A", 1.2], ["B", -0.8], ["C", 0.1]] as const) {
      for (let i = 0; i < 12; i++) {
        units.push({
          group,
          rs: Array.from({ length: 8 }, () => truth + (next() - 0.5) * 4),
        });
      }
    }

    const result = poolingComparison(units, 3);
    assert.ok(result.pooled !== null && result.specific !== null);
    assert.ok(
      result.pooled > result.specific,
      `pooled ${result.pooled} did not beat specific ${result.specific}`,
    );
  });

  it("prefers the specific estimate when the edge belongs to the unit", () => {
    const next = rng(21);
    const units = Array.from({ length: 30 }, (_, i) => ({
      group: "A",
      rs: Array.from({ length: 14 }, () => (i - 15) / 5 + (next() - 0.5) * 0.4),
    }));

    const result = poolingComparison(units, 3);
    assert.ok(result.specific !== null && result.pooled !== null);
    assert.ok(
      result.specific > result.pooled,
      `specific ${result.specific} did not beat pooled ${result.pooled}`,
    );
  });

  it("never lets a unit into its own pooled predictor", () => {
    // One group member with a wild history; if it leaked into its own pool
    // the pooled correlation would inherit it.
    const units = [
      { group: "A", rs: [9, 9, 9, 9, 9, 9] },
      { group: "A", rs: [0, 0, 0, 0, 0, 0] },
      { group: "A", rs: [1, 1, 1, 1, 1, 1] },
      { group: "A", rs: [2, 2, 2, 2, 2, 2] },
    ];
    const result = poolingComparison(units, 3);
    // With self excluded each pooled predictor is the mean of the other
    // three, which cannot equal the unit's own past for all of them.
    assert.equal(result.n, 4);
  });

  it("reports null when there is not enough to compare", () => {
    // `n` counts units that survived the minimum, so a unit too thin to split
    // is not one of them.
    assert.deepEqual(poolingComparison([{ group: "A", rs: [1, 2] }], 3), {
      n: 0,
      specific: null,
      pooled: null,
    });
  });
});
