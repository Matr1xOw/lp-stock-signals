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
  if (!Number.isFinite(rewardAtr)) return 20;
  return Math.max(20, Math.min(100, Math.round(rewardAtr * 10)));
}

/** Bars to skip after an occurrence, so one setup is not counted repeatedly. */
const COOLDOWN = 5;
/** Detectors need history; start the replay once they can actually fire. */
const WARMUP = 80;
/** Below this many resolved trades, a win rate is noise. */
const MIN_SAMPLE = 5;
/** Longest horizon any trade may use, reserved at the end of the series. */
const MAX_HORIZON = 100;

const EMPTY: BacktestResult = {
  wins: 0,
  losses: 0,
  unresolved: 0,
  winRate: null,
  expectancy: null,
  medianBarsToResolve: null,
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

export function backtestPattern(
  candles: Candle[],
  patternName: string,
): BacktestResult {
  if (candles.length < WARMUP + MAX_HORIZON + 10) return EMPTY;

  const atr = atrSeries(candles, 14);
  let wins = 0;
  let losses = 0;
  let unresolved = 0;
  let totalR = 0;
  const barsToResolve: number[] = [];

  for (let end = WARMUP; end < candles.length - MAX_HORIZON; end++) {
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
    let resolved = false;

    for (let i = end + 1; i <= end + horizon; i++) {
      const bar = candles[i];
      const hitStop = long ? bar.low <= levels.stop : bar.high >= levels.stop;
      const hitTarget = long
        ? bar.high >= levels.target
        : bar.low <= levels.target;

      // Pessimistic on ambiguity: a bar that spans both counts as a loss.
      if (hitStop) {
        losses++;
        totalR -= 1;
        barsToResolve.push(i - end);
        resolved = true;
        break;
      }
      if (hitTarget) {
        wins++;
        totalR += levels.rr;
        barsToResolve.push(i - end);
        resolved = true;
        break;
      }
    }

    if (!resolved) unresolved++;
    end += COOLDOWN;
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
  };
}
