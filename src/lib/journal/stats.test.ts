import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialRisk,
  isClosed,
  isOpen,
  openQuantity,
  performance,
  progressToTarget,
  realisedPnl,
  rMultiple,
  suggestedSize,
  unrealisedPnl,
} from "./stats";
import type { Trade } from "./types";

/**
 * Journal maths.
 *
 * These figures are the ones the user judges their own trading by, so the
 * cases that matter most are the ones easy to get subtly wrong: shorts,
 * partial exits, fee attribution, and trades with no stop recorded.
 */

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "NVDA",
    direction: "LONG",
    quantity: 100,
    entryPrice: 100,
    entryAt: 1_700_000_000_000,
    stop: 95,
    target: 115,
    fees: 0,
    note: "",
    exits: [],
    ...overrides,
  };
}

const exit = (quantity: number, price: number, id = "e1") => ({
  id,
  quantity,
  price,
  at: 1_700_000_100_000,
});

describe("openQuantity", () => {
  it("subtracts partial exits and never goes negative", () => {
    assert.equal(openQuantity(trade()), 100);
    assert.equal(openQuantity(trade({ exits: [exit(40, 110)] })), 60);
    assert.equal(openQuantity(trade({ exits: [exit(100, 110)] })), 0);
    // A quantity edit after an exit must not produce a negative position.
    assert.equal(
      openQuantity(trade({ quantity: 50, exits: [exit(100, 110)] })),
      0,
    );
  });

  it("treats a fully exited trade as closed", () => {
    const partial = trade({ exits: [exit(40, 110)] });
    assert.ok(isOpen(partial));
    assert.ok(!isClosed(partial));

    const done = trade({ exits: [exit(100, 110)] });
    assert.ok(isClosed(done));
  });
});

describe("realisedPnl", () => {
  it("computes a long win and a long loss", () => {
    assert.equal(realisedPnl(trade({ exits: [exit(100, 110)] })), 1_000);
    assert.equal(realisedPnl(trade({ exits: [exit(100, 90)] })), -1_000);
  });

  it("inverts the sign for shorts", () => {
    // A short that covers lower has made money.
    const short = trade({ direction: "SHORT", exits: [exit(100, 90)] });
    assert.equal(realisedPnl(short), 1_000);
    const bad = trade({ direction: "SHORT", exits: [exit(100, 110)] });
    assert.equal(realisedPnl(bad), -1_000);
  });

  it("sums multiple partial exits", () => {
    const scaled = trade({
      exits: [exit(50, 110, "a"), exit(50, 120, "b")],
    });
    assert.equal(realisedPnl(scaled), 50 * 10 + 50 * 20);
  });

  it("charges fees in proportion to the quantity closed", () => {
    // Charging the whole $100 against the first half would make an early
    // scale-out look worse than it was and the remainder better.
    const half = trade({ fees: 100, exits: [exit(50, 110)] });
    assert.equal(realisedPnl(half), 500 - 50);

    const full = trade({
      fees: 100,
      exits: [exit(50, 110, "a"), exit(50, 110, "b")],
    });
    assert.equal(realisedPnl(full), 1_000 - 100);
  });
});

describe("unrealisedPnl", () => {
  it("marks only the open portion", () => {
    const partial = trade({ exits: [exit(40, 110)] });
    assert.equal(unrealisedPnl(partial, 105), 60 * 5);
  });

  it("is zero without a price, rather than guessing", () => {
    assert.equal(unrealisedPnl(trade(), undefined), 0);
    assert.equal(unrealisedPnl(trade(), NaN), 0);
  });

  it("is zero once nothing is open", () => {
    assert.equal(unrealisedPnl(trade({ exits: [exit(100, 110)] }), 200), 0);
  });
});

describe("initialRisk and rMultiple", () => {
  it("measures risk from entry to stop across the whole position", () => {
    assert.equal(initialRisk(trade()), 5 * 100);
  });

  it("is null without a stop, so no R is invented", () => {
    // Without a stop there is no risk denominator; any R would be fiction.
    assert.equal(initialRisk(trade({ stop: null })), null);
    assert.equal(rMultiple(trade({ stop: null }), 110), null);
  });

  it("is null when the stop sits exactly at entry", () => {
    assert.equal(initialRisk(trade({ stop: 100 })), null);
  });

  it("scores a win at target as the reward-to-risk multiple", () => {
    // Risked 5 points, made 15.
    assert.equal(rMultiple(trade({ exits: [exit(100, 115)] }), undefined), 3);
  });

  it("scores a stop-out as −1R", () => {
    assert.equal(rMultiple(trade({ exits: [exit(100, 95)] }), undefined), -1);
  });
});

describe("progressToTarget", () => {
  it("runs 0 at the stop and 1 at the target", () => {
    assert.equal(progressToTarget(trade(), 95), 0);
    assert.equal(progressToTarget(trade(), 115), 1);
    assert.equal(progressToTarget(trade(), 105), 0.5);
  });

  it("clamps beyond the levels and is null without them", () => {
    assert.equal(progressToTarget(trade(), 200), 1);
    assert.equal(progressToTarget(trade(), 10), 0);
    assert.equal(progressToTarget(trade({ target: null }), 105), null);
  });
});

describe("performance", () => {
  it("reports nulls rather than zeros for an empty journal", () => {
    // "0.0% win rate" reads as a terrible record; it should read "no data".
    const stats = performance([], {});
    assert.equal(stats.winRate, null);
    assert.equal(stats.profitFactor, null);
    assert.equal(stats.averageR, null);
    assert.equal(stats.closedCount, 0);
  });

  it("summarises a mixed set of closed trades", () => {
    const trades = [
      trade({ id: "a", exits: [exit(100, 110, "x")] }), // +1000
      trade({ id: "b", exits: [exit(100, 95, "y")] }), // −500
      trade({ id: "c", exits: [exit(100, 120, "z")] }), // +2000
    ];
    const stats = performance(trades, {});

    assert.equal(stats.closedCount, 3);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 1);
    assert.equal(stats.winRate, 2 / 3);
    assert.equal(stats.realised, 2_500);
    assert.equal(stats.profitFactor, 3_000 / 500);
    assert.equal(stats.bestTrade, 2_000);
    assert.equal(stats.worstTrade, -500);
    // R multiples: +2, −1, +4 on a 5-point stop.
    assert.equal(stats.averageR, (2 - 1 + 4) / 3);
  });

  it("counts realised P&L from partial exits on still-open trades", () => {
    const trades = [trade({ exits: [exit(50, 110)] })];
    const stats = performance(trades, { NVDA: 120 });

    assert.equal(stats.openCount, 1);
    assert.equal(stats.closedCount, 0);
    assert.equal(stats.realised, 500); // the half already sold
    assert.equal(stats.unrealised, 50 * 20); // the half still held
    assert.equal(stats.total, 1_500);
  });

  it("reports profit factor as null when nothing has lost", () => {
    // Dividing by zero gross loss is meaningless; the UI shows ∞ instead.
    const stats = performance([trade({ exits: [exit(100, 110)] })], {});
    assert.equal(stats.profitFactor, null);
  });

  it("only counts the still-open portion as risk", () => {
    const trades = [trade({ exits: [exit(50, 110)] })];
    assert.equal(performance(trades, { NVDA: 105 }).openRisk, 250); // half of $500
  });

  it("omits unrealised P&L for symbols with no quote", () => {
    // A failed quote fetch should understate the day, not corrupt the totals.
    const stats = performance([trade()], {});
    assert.equal(stats.unrealised, 0);
    assert.equal(stats.openCount, 1);
  });
});

describe("suggestedSize", () => {
  it("sizes so that a stop-out costs the configured risk", () => {
    // $1,000 risk over a $5 stop is 200 shares.
    assert.equal(suggestedSize(100, 95, 1_000, 1_000_000), 200);
  });

  it("caps notional so the suggestion is actually affordable", () => {
    // A 10-cent stop implies 10,000 shares to risk $1,000 — $3.5m of stock.
    // The capital cap must win: 25% of a $100k account at $350 is 71 shares.
    assert.equal(suggestedSize(350, 349.9, 1_000, 100_000), 71);
  });

  it("returns 0 rather than a bogus size for degenerate input", () => {
    assert.equal(suggestedSize(0, 0, 1_000, 100_000), 0);
    assert.equal(suggestedSize(100, 100, 1_000, 0), 0);
  });
});
