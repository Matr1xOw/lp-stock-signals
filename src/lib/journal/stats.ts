import type { Trade } from "./types";

/**
 * Performance statistics derived from the journal.
 *
 * Everything here is computed from trades the user actually took — none of it
 * is simulated. That is the whole point of the panel: the win rate on screen
 * is *your* win rate, not the engine's backtest.
 *
 * All functions are pure so they can be tested without a browser or a market.
 */

const sign = (trade: Trade) => (trade.direction === "LONG" ? 1 : -1);

/** Quantity still open, after any partial exits. */
export function openQuantity(trade: Trade): number {
  const closed = trade.exits.reduce((sum, exit) => sum + exit.quantity, 0);
  return Math.max(0, trade.quantity - closed);
}

export function isOpen(trade: Trade): boolean {
  return openQuantity(trade) > 0;
}

export function isClosed(trade: Trade): boolean {
  return !isOpen(trade);
}

/**
 * Fees attributable to the portion of a trade that has been closed.
 *
 * Fees are recorded for the trade as a whole, so charging all of them against
 * the first partial exit would make an early scale-out look worse than it was
 * and the remainder look better. Prorating by quantity keeps each slice
 * honest.
 */
function feesForClosed(trade: Trade): number {
  if (trade.quantity === 0) return 0;
  const closedQty = trade.quantity - openQuantity(trade);
  return trade.fees * (closedQty / trade.quantity);
}

/** Cash realised so far, net of prorated fees. */
export function realisedPnl(trade: Trade): number {
  const gross = trade.exits.reduce(
    (sum, exit) =>
      sum + (exit.price - trade.entryPrice) * exit.quantity * sign(trade),
    0,
  );
  return gross - feesForClosed(trade);
}

/** Paper gain on the still-open portion at `price`. */
export function unrealisedPnl(trade: Trade, price: number | undefined): number {
  const qty = openQuantity(trade);
  if (qty === 0 || price === undefined || !Number.isFinite(price)) return 0;
  return (price - trade.entryPrice) * qty * sign(trade);
}

/** Dollars at risk when the trade was opened, or `null` without a stop. */
export function initialRisk(trade: Trade): number | null {
  if (trade.stop === null) return null;
  const perShare = Math.abs(trade.entryPrice - trade.stop);
  if (perShare <= 0) return null;
  return perShare * trade.quantity;
}

/**
 * Trade result in R — profit as a multiple of what was risked.
 *
 * R is the only way to compare a $200 win on a tight stop with a $200 win on
 * a wide one. Returns `null` when no stop was recorded, because without one
 * there is no risk denominator and any number would be invented.
 */
export function rMultiple(
  trade: Trade,
  price: number | undefined,
): number | null {
  const risk = initialRisk(trade);
  if (risk === null) return null;
  return (realisedPnl(trade) + unrealisedPnl(trade, price)) / risk;
}

/** Average price paid across all exits, weighted by quantity. */
export function averageExitPrice(trade: Trade): number | null {
  const qty = trade.exits.reduce((sum, exit) => sum + exit.quantity, 0);
  if (qty === 0) return null;
  return (
    trade.exits.reduce((sum, exit) => sum + exit.price * exit.quantity, 0) / qty
  );
}

/** Current market value of the open portion. */
export function exposure(trade: Trade, price: number | undefined): number {
  const qty = openQuantity(trade);
  const mark = price ?? trade.entryPrice;
  return qty * mark;
}

/**
 * How far the open portion has travelled from stop toward target, 0–1.
 *
 * Measured as a *signed* fraction of the stop→target span rather than an
 * absolute distance from the stop. The distinction matters: on a long stopped
 * at 95 with a target of 115, an absolute distance would score a collapse to
 * 10 as further from the stop than the target is, and paint the bar full —
 * showing a disaster as a trade about to pay out. Dividing by the signed span
 * handles shorts too, where the target sits below the stop.
 */
export function progressToTarget(
  trade: Trade,
  price: number | undefined,
): number | null {
  if (trade.stop === null || trade.target === null) return null;
  const span = trade.target - trade.stop;
  if (span === 0) return null;
  const mark = price ?? trade.entryPrice;
  return Math.max(0, Math.min(1, (mark - trade.stop) / span));
}

export type Performance = {
  /** Closed trades counted in these figures. */
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  /** Share of closed trades that made money, or `null` with none closed. */
  winRate: number | null;
  realised: number;
  unrealised: number;
  total: number;
  /** Gross profit divided by gross loss, or `null` when nothing has lost. */
  profitFactor: number | null;
  /** Mean R across closed trades that had a stop recorded. */
  averageR: number | null;
  /** Largest single winner and loser, in dollars. */
  bestTrade: number | null;
  worstTrade: number | null;
  /** Market value of everything still open. */
  openExposure: number;
  /** Dollars still at risk across open trades with stops. */
  openRisk: number;
};

/**
 * Rolls the whole journal up into the figures shown across the top of the
 * dashboard.
 *
 * `prices` maps symbol to last price; symbols missing from it simply do not
 * contribute unrealised P&L, so a failed quote fetch understates the day
 * rather than corrupting the totals.
 */
export function performance(
  trades: Trade[],
  prices: Record<string, number>,
): Performance {
  const closed = trades.filter(isClosed);
  const open = trades.filter(isOpen);

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let bestTrade: number | null = null;
  let worstTrade: number | null = null;

  const rMultiples: number[] = [];

  for (const trade of closed) {
    const pnl = realisedPnl(trade);
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses++;
      grossLoss += Math.abs(pnl);
    }

    bestTrade = bestTrade === null ? pnl : Math.max(bestTrade, pnl);
    worstTrade = worstTrade === null ? pnl : Math.min(worstTrade, pnl);

    const r = rMultiple(trade, undefined);
    if (r !== null) rMultiples.push(r);
  }

  // Realised P&L includes partial exits on trades that are still open.
  const realised = trades.reduce((sum, t) => sum + realisedPnl(t), 0);
  const unrealised = open.reduce(
    (sum, t) => sum + unrealisedPnl(t, prices[t.symbol]),
    0,
  );

  const openRisk = open.reduce((sum, t) => {
    const risk = initialRisk(t);
    if (risk === null) return sum;
    // Only the portion still on is still at risk.
    return sum + risk * (openQuantity(t) / t.quantity);
  }, 0);

  return {
    closedCount: closed.length,
    openCount: open.length,
    wins,
    losses,
    winRate: closed.length > 0 ? wins / closed.length : null,
    realised,
    unrealised,
    total: realised + unrealised,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageR:
      rMultiples.length > 0
        ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
        : null,
    bestTrade,
    worstTrade,
    openExposure: open.reduce((sum, t) => sum + exposure(t, prices[t.symbol]), 0),
    openRisk,
  };
}

/** Largest share of the account one position may occupy, by market value. */
export const MAX_POSITION_FRACTION = 0.25;

/**
 * Suggested position size for a signal.
 *
 * Two limits apply and the smaller wins.
 *
 * The first is risk: size so that being stopped out costs `riskPerTrade`.
 * That is the rule that makes different setups comparable — a tight stop
 * earns more shares because each one can lose less.
 *
 * The second is capital, and it is the one a pure risk rule forgets. A stop
 * ten cents under a $350 stock implies thousands of shares to risk $1,000,
 * which is a million dollars of stock nobody has. Capping notional at a
 * fraction of the account keeps the suggestion to a trade that can actually
 * be placed.
 */
export function suggestedSize(
  entry: number,
  stop: number,
  riskPerTrade: number,
  accountSize: number,
): number {
  if (entry <= 0) return 0;

  const perShare = Math.abs(entry - stop);
  const byRisk = perShare > 0 ? riskPerTrade / perShare : Infinity;
  const byCapital = (accountSize * MAX_POSITION_FRACTION) / entry;

  return Math.max(0, Math.floor(Math.min(byRisk, byCapital)));
}
