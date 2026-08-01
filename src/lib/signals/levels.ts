import type { PatternMatch } from "@/lib/analysis/patterns";

/**
 * Turns a pattern's geometry into an actual trade.
 *
 * This lives on its own because two callers must agree exactly: the live
 * engine that shows you a signal, and the backtest that reports how often
 * that signal has worked. If they built levels differently, the historical
 * win rate would describe a trade you are not being offered.
 */

export type Levels = {
  entry: number;
  stop: number;
  target: number;
  /** Reward-to-risk multiple. */
  rr: number;
  /** Distance from entry to stop, in price. */
  risk: number;
};

/** Widest stop we will accept, as a fraction of entry price. */
const MAX_RISK_FRACTION = 0.1;
/** Stops are placed this far beyond the level that invalidates the pattern. */
const INVALIDATION_BUFFER_ATR = 0.25;
/** Bounds on stop distance, in ATR, so levels stay sane on odd geometry. */
const MIN_RISK_ATR = 0.5;
const MAX_RISK_ATR = 3;

export function buildLevels(
  match: PatternMatch,
  atr: number,
  close: number,
): Levels | null {
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const long = match.direction === "LONG";

  // The trigger is the pattern's break level — unless price has already gone
  // through it, in which case the trade is at market.
  const entry = long
    ? Math.max(match.breakout, close)
    : Math.min(match.breakout, close);

  // The stop sits just beyond the level that proves the pattern wrong, not
  // exactly on it, so ordinary noise around the level does not eject you.
  const buffer = atr * INVALIDATION_BUFFER_ATR;
  let stop = long
    ? match.invalidation - buffer
    : match.invalidation + buffer;

  let risk = long ? entry - stop : stop - entry;
  if (!(risk > 0)) return null;

  // Clamp pathological geometry rather than emitting an absurd stop.
  const minRisk = atr * MIN_RISK_ATR;
  const maxRisk = atr * MAX_RISK_ATR;
  if (risk < minRisk) {
    risk = minRisk;
    stop = long ? entry - risk : entry + risk;
  } else if (risk > maxRisk) {
    risk = maxRisk;
    stop = long ? entry - risk : entry + risk;
  }

  // A stop this wide means the pattern is too large to trade at this size.
  if (risk / entry > MAX_RISK_FRACTION) return null;

  const target = match.measured;
  const reward = long ? target - entry : entry - target;
  // Price may have already run to the objective; there is no trade left.
  if (!(reward > 0)) return null;

  return { entry, stop, target, rr: reward / risk, risk };
}
