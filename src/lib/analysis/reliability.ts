import { correlation } from "./indicators";

/**
 * Does the measured edge measure anything?
 *
 * `EDGE` is worth 18 of the 100 confidence points and gates the negative-edge
 * veto, and nothing has ever checked that a pattern's expectancy on a symbol
 * is a property of that pair rather than an artefact of five coin flips. The
 * median resolved sample is six trades, so the null hypothesis — that it is
 * noise — is entirely live.
 *
 * Reliability is the standard way to ask. Split each unit's trades into two
 * halves, compute expectancy on each, and correlate across units. A factor
 * measuring something real agrees with itself; noise does not.
 *
 * Two splits, because they answer different questions:
 *
 *  - **Alternating** (odd/even trades) interleaves the halves in time, so
 *    both span the same period. This is internal consistency, and it is the
 *    ceiling: a factor that cannot pass this cannot pass anything.
 *  - **Chronological** (first half/second half) asks whether the past
 *    predicts the future, which is the only thing the live engine actually
 *    does. A factor can pass the first and fail this one, and that would mean
 *    the edge is real but non-stationary — still useless for scoring.
 */

export type Split = (values: number[]) => [number[], number[]];

/** Deals alternately, so both halves cover the same span of time. */
export const alternating: Split = (values) => [
  values.filter((_, i) => i % 2 === 0),
  values.filter((_, i) => i % 2 === 1),
];

/** Cuts in the middle, so the first half precedes the second entirely. */
export const chronological: Split = (values) => {
  const cut = Math.floor(values.length / 2);
  return [values.slice(0, cut), values.slice(cut)];
};

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Spearman-Brown: what the correlation would be at full length.
 *
 * A split-half correlation is computed on halves, so it understates the
 * reliability of the whole record — this is the standard correction for that.
 * Only meaningful for the alternating split; applying it to a chronological
 * one would claim a prediction the test did not make.
 */
export function spearmanBrown(r: number): number {
  return (2 * r) / (1 + r);
}

export type Reliability = {
  /** Units with enough trades on both sides of the split. */
  n: number;
  /** Correlation between the two halves' expectancies. */
  r: number | null;
  /** Length-corrected estimate. Null unless the split was alternating. */
  corrected: number | null;
};

/**
 * Correlates each unit's two half-expectancies across all units.
 *
 * `samples` is one entry per unit — a symbol/pattern pair — holding its
 * realised R values in the order they occurred.
 */
export function splitHalfReliability(
  samples: number[][],
  split: Split,
  minPerHalf: number,
  correct = false,
): Reliability {
  const first: number[] = [];
  const second: number[] = [];

  for (const rs of samples) {
    const [a, b] = split(rs);
    if (a.length < minPerHalf || b.length < minPerHalf) continue;
    first.push(mean(a));
    second.push(mean(b));
  }

  if (first.length < 3) return { n: first.length, r: null, corrected: null };

  const r = correlation(first, second);
  if (!Number.isFinite(r)) return { n: first.length, r: null, corrected: null };

  return {
    n: first.length,
    r,
    corrected: correct ? spearmanBrown(r) : null,
  };
}

export type PoolingComparison = {
  n: number;
  /** How well a pair's own past predicts its own future. */
  specific: number | null;
  /**
   * How well the *pattern's* past across every other symbol predicts this
   * pair's future.
   *
   * If this beats `specific`, the symbol-specific detail is noise and the
   * engine should be scoring the pattern rather than the pairing — which is
   * the entire premise of pooling in phase 2c, tested rather than assumed.
   */
  pooled: number | null;
};

/**
 * Compares symbol-specific history against pooled pattern history as
 * predictors of the same future.
 *
 * The pooled estimate deliberately excludes the unit being predicted. Leaving
 * it in would let each pair help predict itself, which inflates the pooled
 * number for free and is exactly the leak this test exists to avoid.
 */
export function poolingComparison(
  units: Array<{ group: string; rs: number[] }>,
  minPerHalf: number,
): PoolingComparison {
  type Row = { group: string; past: number[]; future: number };

  const rows: Row[] = [];
  for (const unit of units) {
    const [past, future] = chronological(unit.rs);
    if (past.length < minPerHalf || future.length < minPerHalf) continue;
    rows.push({ group: unit.group, past, future: mean(future) });
  }

  if (rows.length < 3) return { n: rows.length, specific: null, pooled: null };

  const specificX: number[] = [];
  const pooledX: number[] = [];
  const y: number[] = [];

  for (const row of rows) {
    // Every other unit of the same pattern, pooled.
    const others = rows.filter((o) => o !== row && o.group === row.group);
    const pool = others.flatMap((o) => o.past);
    if (pool.length === 0) continue;

    specificX.push(mean(row.past));
    pooledX.push(mean(pool));
    y.push(row.future);
  }

  if (y.length < 3) return { n: y.length, specific: null, pooled: null };

  const specific = correlation(specificX, y);
  const pooled = correlation(pooledX, y);

  return {
    n: y.length,
    specific: Number.isFinite(specific) ? specific : null,
    pooled: Number.isFinite(pooled) ? pooled : null,
  };
}
