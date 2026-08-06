import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { poolPriors, poolPriorsExcluding, shrink, type Unit } from "./pooling";

const unit = (key: string, group: string, rs: number[]): Unit => ({
  key,
  group,
  rs,
});

describe("poolPriors", () => {
  it("pools trades, not unit averages", () => {
    // One unit with many trades near 0, one with few near 3. Averaging the
    // units gives 1.5; pooling the trades gives something near 0.3, which is
    // the honest reading — almost every trade in evidence lost.
    const priors = poolPriors([
      unit("a", "FLAG", Array(18).fill(0)),
      unit("b", "FLAG", [3, 3]),
    ]);
    const flag = priors.get("FLAG");
    assert.equal(flag?.sample, 20);
    assert.ok(Math.abs((flag?.expectancy ?? 0) - 0.3) < 1e-9);
  });

  it("keeps groups apart", () => {
    const priors = poolPriors([
      unit("a", "FLAG", [1, 1]),
      unit("b", "CUP", [-1, -1]),
    ]);
    assert.equal(priors.get("FLAG")?.expectancy, 1);
    assert.equal(priors.get("CUP")?.expectancy, -1);
  });

  it("omits a group with no trades rather than inventing a zero", () => {
    assert.equal(poolPriors([unit("a", "FLAG", [])]).size, 0);
  });
});

describe("poolPriorsExcluding", () => {
  it("leaves the held-out unit entirely out of its prior", () => {
    const units = [
      unit("a", "FLAG", [10, 10, 10]),
      unit("b", "FLAG", [0, 0, 0]),
    ];
    assert.equal(poolPriorsExcluding(units, "a").get("FLAG")?.expectancy, 0);
    assert.equal(poolPriorsExcluding(units, "b").get("FLAG")?.expectancy, 10);
  });

  it("drops the group when the held-out unit was the only member", () => {
    const units = [unit("a", "FLAG", [1, 2, 3])];
    assert.equal(poolPriorsExcluding(units, "a").has("FLAG"), false);
  });
});

describe("shrink", () => {
  const prior = { expectancy: 0.2, sample: 400 };

  it("is the current engine at k = 0", () => {
    assert.equal(shrink(1.5, 6, prior, 0), 1.5);
  });

  it("is the prior alone at k = infinity", () => {
    assert.equal(shrink(1.5, 6, prior, Infinity), 0.2);
  });

  it("splits the difference when the sample equals k", () => {
    // k is the sample size at which own history and prior weigh the same,
    // which is what makes it a readable number rather than a knob.
    const blended = shrink(1.0, 8, prior, 8);
    assert.ok(Math.abs((blended ?? 0) - 0.6) < 1e-9);
  });

  it("pulls a thin sample most of the way to the prior", () => {
    const thin = shrink(2.0, 2, prior, 16) ?? 0;
    const thick = shrink(2.0, 40, prior, 16) ?? 0;
    assert.ok(thin < thick, "a thinner sample must move further");
    assert.ok(Math.abs(thin - prior.expectancy) < Math.abs(thin - 2.0));
  });

  it("falls back to the prior when there is no own history", () => {
    // This is the case that currently receives a flat 7.2 of 18 points.
    assert.equal(shrink(null, 0, prior, 8), 0.2);
    assert.equal(shrink(0.9, 0, prior, 8), 0.2);
  });

  it("falls back to own history when the group has no prior", () => {
    assert.equal(shrink(0.9, 5, null, 8), 0.9);
  });

  it("has nothing to say when it has neither", () => {
    assert.equal(shrink(null, 0, null, 8), null);
  });

  it("never leaves the interval between the two estimates", () => {
    for (const k of [0, 1, 4, 16, 64]) {
      for (const n of [1, 3, 9, 30]) {
        const value = shrink(2.0, n, prior, k) ?? 0;
        assert.ok(
          value >= prior.expectancy - 1e-9 && value <= 2.0 + 1e-9,
          `k=${k} n=${n} produced ${value}`,
        );
      }
    }
  });
});
