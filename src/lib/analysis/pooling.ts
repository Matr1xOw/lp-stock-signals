import { mean } from "./reliability";

/**
 * Pooling a thin per-symbol record toward what the pattern does everywhere.
 *
 * Phase 2a measured the problem this solves. A symbol/pattern's own expectancy
 * correlates 0.03 with its future at 15m — it describes the window it was
 * measured in — while the same pattern's record across *other* symbols
 * correlates 0.227. Intraday, the symbol-specific detail is noise and the
 * pattern-level signal is what carries forward. Daily reverses it, so the
 * blend has to be a dial rather than a decision.
 *
 * Shrinkage is that dial. An estimate built on four trades gets pulled most of
 * the way to the pattern prior; one built on thirty barely moves. It also
 * dissolves a wart in the current scoring: `scoreEdge` hands every pair below
 * the sample floor an identical 7.2 points, so an eighteen-point factor is
 * constant for half the signals on the desk. A shrunk estimate is defined for
 * every pair — it just leans on the prior when there is nothing else.
 */

/**
 * Shrinkage constant per timeframe: the sample size at which a pair's own
 * record and the pattern prior carry equal weight.
 *
 * Measured, not chosen. `npm run reliability` sweeps k against out-of-sample
 * future R — priors built from past halves only, each unit excluded from its
 * own prior — and every timeframe improved on `k = 0`, which is what the
 * engine did before:
 *
 *   | tf  | k = 0 | chosen k | at chosen k | best k seen |
 *   | 5m  | 0.364 |    16    |    0.419    |  16 (0.419) |
 *   | 15m | 0.029 |    64    |    0.188    |  ∞  (0.222) |
 *   | 1h  | 0.141 |    64    |    0.263    | 128 (0.265) |
 *   | 4h  | 0.074 |    64    |    0.185    | 128 (0.191) |
 *   | 1D  | 0.267 |     8    |    0.286    |   8 (0.286) |
 *
 * Two of these sit off the measured argmax on purpose. The optimum is itself
 * an estimate from ~300-500 non-independent pairs, and the curves are flat
 * near the top, so chasing the exact peak fits noise — the thing this whole
 * phase exists to avoid. 15m and 1h are pulled back from infinity because
 * discarding a symbol's record permanently is a strong claim to make from one
 * afternoon's data, and the cost of not doing so is 0.03 of correlation.
 *
 * The ordering is not monotonic in timeframe and should not be forced to be.
 * 5m persists best because 400 five-minute bars span about a week, so both
 * halves sit in one regime; 1D persists because 400 daily bars span 1.6 years
 * and there is real per-symbol history. The middle is where a measured record
 * is both short-lived and thin.
 */
export const EDGE_SHRINKAGE: Record<string, number> = {
  "5m": 16,
  "15m": 64,
  "1h": 64,
  "4h": 64,
  "1D": 8,
};

/** Fallback for a timeframe with no measured constant. */
export const DEFAULT_SHRINKAGE = 32;

export type Prior = {
  expectancy: number;
  /** Trades behind the prior, across every symbol that contributed. */
  sample: number;
};

export type Unit = {
  /** What the pooling is over — the pattern name. */
  group: string;
  /** Something identifying the unit, so it can be excluded from its own prior. */
  key: string;
  /** Realised R per resolved trade. */
  rs: number[];
};

/**
 * Pattern-level expectancy, one prior per group.
 *
 * Pooled over trades rather than over units, so a symbol with thirty
 * occurrences counts for more than one with four. The alternative — averaging
 * each unit's mean — gives a four-trade estimate the same vote as a
 * thirty-trade one, which is the error this whole module exists to correct.
 */
export function poolPriors(units: Unit[]): Map<string, Prior> {
  const byGroup = new Map<string, number[]>();
  for (const unit of units) {
    const bucket = byGroup.get(unit.group);
    if (bucket) bucket.push(...unit.rs);
    else byGroup.set(unit.group, [...unit.rs]);
  }

  const priors = new Map<string, Prior>();
  for (const [group, rs] of byGroup) {
    if (rs.length > 0) priors.set(group, { expectancy: mean(rs), sample: rs.length });
  }
  return priors;
}

/**
 * The same, with one unit held out of its own prior.
 *
 * Anything that scores a unit against a prior it helped build is measuring
 * itself. Cheap to get wrong and impossible to see in the output, so it is a
 * separate function rather than a flag.
 */
export function poolPriorsExcluding(
  units: Unit[],
  key: string,
): Map<string, Prior> {
  return poolPriors(units.filter((u) => u.key !== key));
}

/**
 * Blends a unit's own expectancy toward its group prior.
 *
 * `weight = n / (n + k)`, the standard empirical-Bayes form: `k` is the number
 * of observations at which the estimate is trusted half as much as the prior,
 * so it has a readable meaning rather than being a knob. `k = 0` is the
 * current engine — pure symbol-specific. Large `k` is pure prior.
 *
 * Returns `null` only when there is nothing at all to go on.
 */
export function shrink(
  specific: number | null,
  sample: number,
  prior: Prior | null,
  k: number,
): number | null {
  if (prior === null) return specific;
  if (specific === null || sample <= 0) return prior.expectancy;
  if (!Number.isFinite(k)) return prior.expectancy;

  const weight = sample / (sample + Math.max(0, k));
  return weight * specific + (1 - weight) * prior.expectancy;
}
