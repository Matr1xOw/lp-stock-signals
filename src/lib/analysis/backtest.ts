import type { Candle } from "@/lib/market/types";
import { buildLevels } from "@/lib/signals/levels";
import { atr as atrSeries } from "./indicators";
import { detectPattern } from "./patterns";

/**
 * Historical track record for a pattern on one symbol.
 *
 * The "hist win %" on a signal card is only worth showing if it is measured
 * rather than asserted, so this replays the detector across the symbol's own
 * history and scores each occurrence against the same entry/stop/target the
 * live engine would have produced.
 *
 * Honesty constraints, in order of how easy they are to get wrong:
 *
 *  - Each historical window is a prefix of the series, so a detector can only
 *    ever see bars that had already printed. No lookahead.
 *  - Levels come from the shared `buildLevels`, not a simplified copy.
 *  - When a single bar's range spans both stop and target, the stop is
 *    assumed to have hit first. Intrabar order is unknowable from OHLC, and
 *    the pessimistic reading is the only defensible one.
 *  - Overlapping detections of the same setup are collapsed, so one pattern
 *    that persists for six bars counts once rather than six times.
 */

export type BacktestResult = {
  wins: number;
  losses: number;
  /** Occurrences that neither hit target nor stop within the horizon. */
  unresolved: number;
  /** Wins as a share of resolved trades, or `null` if too few to mean much. */
  winRate: number | null;
  /**
   * Average R per resolved trade — the number that actually decides whether
   * the pattern makes money. A 20% win rate at 6R is profitable; a 60% win
   * rate at 0.5R is not, and win rate alone cannot tell those apart.
   */
  expectancy: number | null;
  /**
   * Median bars a past occurrence took to reach target or stop.
   *
   * The median rather than the mean, because these distributions have long
   * right tails — one setup that ground on for seventy bars would drag an
   * average into telling you to expect something typical never does.
   */
  medianBarsToResolve: number | null;
  /**
   * Median maximum adverse excursion among *winning* trades, in R.
   *
   * How far a trade that eventually worked went against you first. Winners
   * only, because the losers all ran to −1R by definition and averaging them
   * in would just re-measure the stop.
   *
   * This is the empirical answer to a question the stop placement currently
   * guesses at: levels come from pattern geometry (`invalidation ± 0.25 ATR`,
   * then clamped), and nothing checks that against how much heat the setup
   * actually takes. A reading near 1 means the stop is barely surviving its
   * own winners.
   */
  typicalHeatR: number | null;
  /** Number of resolved trades behind `winRate`. */
  sample: number;
};

/**
 * Bars allowed for a trade to resolve, scaled to how far the target is.
 *
 * A fixed horizon systematically slanders wide-target patterns: a measured
 * move six ATR away simply cannot arrive within twenty bars, so it books as
 * unresolved or, worse, as a loss once the stop is grazed. Scaling the
 * horizon to the distance being asked for gives every pattern the same
 * *opportunity* to work, rather than the same number of bars.
 */
export function horizonFor(rewardAtr: number): number {
  if (!Number.isFinite(rewardAtr)) return MIN_HORIZON;
  return Math.max(MIN_HORIZON, Math.min(MAX_HORIZON, Math.round(rewardAtr * 10)));
}

/** Bars to skip after an occurrence, so one setup is not counted repeatedly. */
const COOLDOWN = 5;
/** Detectors need history; start the replay once they can actually fire. */
const WARMUP = 80;
/** Below this many resolved trades, a win rate is noise. */
const MIN_SAMPLE = 5;
/** Shortest and longest horizon `horizonFor` will hand out. */
const MIN_HORIZON = 20;
const MAX_HORIZON = 100;
/**
 * Winners needed before a heat figure means anything.
 *
 * Lower than `MIN_SAMPLE` because this is a median of a bounded quantity —
 * winner heat lies in [0, 1R) by construction, since a winner never touched
 * its stop — so it stabilises faster than an expectancy does.
 */
const MIN_HEAT_SAMPLE = 3;

const EMPTY: BacktestResult = {
  wins: 0,
  losses: 0,
  unresolved: 0,
  winRate: null,
  expectancy: null,
  medianBarsToResolve: null,
  typicalHeatR: null,
  sample: 0,
};

/** Middle value of a list, averaging the two middles when even. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One historical occurrence, scored.
 *
 * Exposed because the aggregates above cannot answer questions about the
 * *distribution* — split-half reliability, whether the record is stable over
 * time, whether it pools across symbols. Those all need the individual trades
 * in the order they happened.
 */
export type BacktestTrade = {
  /** Bar the pattern was detected on. Ascending across the returned list. */
  index: number;
  outcome: "WIN" | "LOSS" | "UNRESOLVED";
  /** Realised R. Zero for a trade that never resolved. */
  r: number;
  /** Bars to reach target or stop; `null` if it never did. */
  barsToResolve: number | null;
  /** Maximum excursion against the trade before it resolved, in R. */
  heatR: number;
  /** Reward-to-risk the levels offered. The engine declines below MIN_RR. */
  rr: number;
  /** Which way the trade pointed. */
  long: boolean;
  /**
   * Stop distance in ATR at the detection bar.
   *
   * Recorded in ATR rather than price so the same geometry can be rebuilt at
   * another bar, at that bar's volatility — which is what a matched placebo
   * needs to isolate the detector's timing from the market's drift.
   */
  riskAtr: number;
  /**
   * The resolving bar's range covered both stop and target, and the stop was
   * assumed to have come first.
   *
   * Intrabar order is genuinely unknowable from OHLC, so the assumption has to
   * be made somewhere. Recording where it was made is what makes its cost
   * measurable instead of a permanent article of faith.
   */
  ambiguous: boolean;
  /**
   * On an ambiguous bar, whether it opened nearer the target than the stop.
   *
   * A bar that opens two thirds of the way to the target and reaches both
   * probably touched the target first. Weak evidence, but strictly better than
   * a coin flip, and it costs nothing to record.
   */
  openedTowardTarget: boolean;
};


/**
 * Races a set of levels against the bars that followed, from a given start.
 *
 * Extracted so a placebo can be scored through exactly the same rules as a
 * real signal. A control trade resolved by a second implementation would
 * measure the difference between two implementations rather than the
 * difference between a detector and chance.
 *
 * `index` on the result is the start bar; callers scoring a detected pattern
 * overwrite it with the detection bar.
 */
export function resolveFrom(
  candles: Candle[],
  start: number,
  levels: {
    entry: number;
    stop: number;
    target: number;
    risk: number;
    rr: number;
    riskAtr: number;
  },
  long: boolean,
  horizon: number,
): BacktestTrade {
  // Worst excursion against the trade before it resolved, in price.
  let heat = 0;

  for (let i = start; i <= Math.min(start + horizon, candles.length - 1); i++) {
    const bar = candles[i];
    const adverse = long ? levels.entry - bar.low : bar.high - levels.entry;
    if (adverse > heat) heat = adverse;

    const hitStop = long ? bar.low <= levels.stop : bar.high >= levels.stop;
    const hitTarget = long
      ? bar.high >= levels.target
      : bar.low <= levels.target;

    // Pessimistic on ambiguity: a bar that spans both counts as a loss.
    if (hitStop) {
      const toStop = Math.abs(bar.open - levels.stop);
      const toTarget = Math.abs(bar.open - levels.target);
      return {
        index: start,
        outcome: "LOSS",
        r: -1,
        barsToResolve: i - start,
        heatR: heat / levels.risk,
        rr: levels.rr,
        long,
        riskAtr: levels.riskAtr,
        ambiguous: hitTarget,
        openedTowardTarget: hitTarget && toTarget < toStop,
      };
    }
    if (hitTarget) {
      return {
        index: start,
        outcome: "WIN",
        r: levels.rr,
        barsToResolve: i - start,
        heatR: heat / levels.risk,
        rr: levels.rr,
        long,
        riskAtr: levels.riskAtr,
        ambiguous: false,
        openedTowardTarget: false,
      };
    }
  }

  return {
    index: start,
    outcome: "UNRESOLVED",
    r: 0,
    barsToResolve: null,
    heatR: heat / levels.risk,
    rr: levels.rr,
    long,
    riskAtr: levels.riskAtr,
    ambiguous: false,
    openedTowardTarget: false,
  };
}

/**
 * Replays a detector over a symbol's history and scores every occurrence.
 *
 * The honesty constraints documented on {@link BacktestResult} all live here;
 * `backtestPattern` is a summary of what this returns.
 */
export type BacktestOptions = {
  /** Fraction of the measured move to target. Defaults to the engine's. */
  targetFraction?: number;
  /**
   * Take the other side: mirror the levels about the entry and trade against
   * the pattern.
   *
   * A pattern that loses reliably is a strong claim stated backwards, and
   * "delete or rewrite" is not answerable without knowing which. The mirror
   * keeps entry, risk distance and reward distance identical and only flips
   * the direction, so the fade is scored on the same geometry rather than on
   * a differently-shaped trade that happens to point the other way.
   */
  fade?: boolean;
  /**
   * Require price to actually reach the entry before the trade is live.
   *
   * `buildLevels` puts the trigger at the pattern's break level, which sits
   * beyond the last close unless price has already gone through it — a
   * resting stop order, not a fill. Scoring from the bar after detection
   * regardless books losses on trades that never opened: the next bar dips to
   * the stop, price never reaches the trigger, and a setup that would have sat
   * unfilled is recorded as −1R.
   *
   * Off only to reproduce the old numbers.
   */
  requireFill?: boolean;
};

/** Bars a resting entry gets to fill before the setup is abandoned. */
const ENTRY_WINDOW = 10;

export function backtestTrades(
  candles: Candle[],
  patternName: string,
  { targetFraction, fade = false, requireFill = true }: BacktestOptions = {},
): BacktestTrade[] {
  if (candles.length < WARMUP + MIN_HORIZON + 10) return [];

  const atr = atrSeries(candles, 14);
  const trades: BacktestTrade[] = [];

  // Bounded by the *shortest* horizon any trade could be given, not the
  // longest. Reserving MAX_HORIZON unconditionally threw away eighty bars of
  // usable history for every fast-resolving pattern; occurrences that turn
  // out to need more room are skipped individually below.
  for (let end = WARMUP; end < candles.length - MIN_HORIZON; end++) {
    // The detector sees exactly the bars available at the time.
    const history = candles.slice(0, end + 1);
    const match = detectPattern(history, patternName);
    if (!match) continue;

    const built = buildLevels(
      match,
      atr[end],
      candles[end].close,
      targetFraction,
    );
    if (!built) continue;

    // Mirroring about the entry preserves both distances, so the fade carries
    // the same risk and the same reward-to-risk as the trade it opposes.
    const reward = Math.abs(built.target - built.entry);
    const levels = fade
      ? {
          ...built,
          stop:
            match.direction === "LONG"
              ? built.entry + built.risk
              : built.entry - built.risk,
          target:
            match.direction === "LONG"
              ? built.entry - reward
              : built.entry + reward,
        }
      : built;

    const long = fade
      ? match.direction !== "LONG"
      : match.direction === "LONG";
    const horizon = horizonFor(
      Math.abs(levels.target - levels.entry) / atr[end],
    );

    // Where the trade actually starts. A trigger already through the last
    // close is live immediately; otherwise price has to come and get it, and
    // the fill test follows the pattern's direction rather than the trade's,
    // because the level sits where the pattern put it either way.
    let start = end + 1;
    if (requireFill && built.entry !== candles[end].close) {
      const reached = (bar: Candle) =>
        match.direction === "LONG"
          ? bar.high >= built.entry
          : bar.low <= built.entry;

      let filled = -1;
      for (let i = end + 1; i <= Math.min(end + ENTRY_WINDOW, candles.length - 1); i++) {
        if (reached(candles[i])) {
          filled = i;
          break;
        }
      }
      // Never filled: there was no trade, so there is nothing to score.
      if (filled < 0) continue;
      start = filled;
    }

    // Score only an occurrence whose full horizon is available. Truncating it
    // at the end of the series would book slow winners as unresolved and bias
    // the record toward whatever happens to resolve quickly.
    if (start + horizon >= candles.length) continue;

    const trade = resolveFrom(
      candles,
      start,
      {
        entry: levels.entry,
        stop: levels.stop,
        target: levels.target,
        risk: levels.risk,
        rr: levels.rr,
        riskAtr: levels.risk / atr[end],
      },
      long,
      horizon,
    );

    trades.push({ ...trade, index: end });
    end += COOLDOWN;
  }

  return trades;
}

export function backtestPattern(
  candles: Candle[],
  patternName: string,
): BacktestResult {
  const trades = backtestTrades(candles, patternName);
  if (trades.length === 0) return EMPTY;

  let wins = 0;
  let losses = 0;
  let unresolved = 0;
  let totalR = 0;
  const barsToResolve: number[] = [];
  const winnerHeat: number[] = [];

  for (const trade of trades) {
    if (trade.outcome === "UNRESOLVED") {
      unresolved++;
      continue;
    }
    totalR += trade.r;
    barsToResolve.push(trade.barsToResolve as number);
    if (trade.outcome === "WIN") {
      wins++;
      winnerHeat.push(trade.heatR);
    } else {
      losses++;
    }
  }

  const sample = wins + losses;
  const enough = sample >= MIN_SAMPLE;
  return {
    wins,
    losses,
    unresolved,
    sample,
    winRate: enough ? wins / sample : null,
    expectancy: enough ? totalR / sample : null,
    medianBarsToResolve: enough ? median(barsToResolve) : null,
    typicalHeatR:
      winnerHeat.length >= MIN_HEAT_SAMPLE ? median(winnerHeat) : null,
  };
}
