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
function horizonFor(rewardAtr: number): number {
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
};

/**
 * Replays a detector over a symbol's history and scores every occurrence.
 *
 * The honesty constraints documented on {@link BacktestResult} all live here;
 * `backtestPattern` is a summary of what this returns.
 */
export function backtestTrades(
  candles: Candle[],
  patternName: string,
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

    const levels = buildLevels(match, atr[end], candles[end].close);
    if (!levels) continue;

    const long = match.direction === "LONG";
    const horizon = horizonFor(
      Math.abs(levels.target - levels.entry) / atr[end],
    );

    // Score only an occurrence whose full horizon is available. Truncating it
    // at the end of the series would book slow winners as unresolved and bias
    // the record toward whatever happens to resolve quickly.
    if (end + horizon >= candles.length) continue;

    let trade: BacktestTrade | null = null;
    // Worst excursion against the trade before it resolved, in price.
    let heat = 0;

    for (let i = end + 1; i <= end + horizon; i++) {
      const bar = candles[i];
      const adverse = long ? levels.entry - bar.low : bar.high - levels.entry;
      if (adverse > heat) heat = adverse;

      const hitStop = long ? bar.low <= levels.stop : bar.high >= levels.stop;
      const hitTarget = long
        ? bar.high >= levels.target
        : bar.low <= levels.target;

      // Pessimistic on ambiguity: a bar that spans both counts as a loss.
      if (hitStop) {
        trade = {
          index: end,
          outcome: "LOSS",
          r: -1,
          barsToResolve: i - end,
          heatR: heat / levels.risk,
        };
        break;
      }
      if (hitTarget) {
        trade = {
          index: end,
          outcome: "WIN",
          r: levels.rr,
          barsToResolve: i - end,
          heatR: heat / levels.risk,
        };
        break;
      }
    }

    trades.push(
      trade ?? {
        index: end,
        outcome: "UNRESOLVED",
        r: 0,
        barsToResolve: null,
        heatR: heat / levels.risk,
      },
    );
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
