import type { ScanResult, Signal } from "./types";

/**
 * The live book: every signal currently standing, across the whole universe.
 *
 * The desk used to render one scan response, which meant the list *was* the
 * last HTTP result — advancing to the next slice replaced what you were
 * reading rather than adding to it, and a poll loop pinned to one pass meant
 * most of the universe was never shown at all.
 *
 * A book instead accumulates. Scans sweep slices in rotation and merge into
 * it, so what you see is everything alive right now, not everything alive in
 * the 31 symbols that happened to be swept last.
 *
 * The rule that makes it self-cleaning: a signal is only ever expired when
 * its own symbol was swept and it did not come back. Absence from a scan of
 * other symbols means nothing.
 */

export type BookEntry = {
  signal: Signal;
  /** When this signal first appeared in the book. */
  firstSeenAt: number;
  /** When a scan of its symbol last confirmed it still stands. */
  lastConfirmedAt: number;
  /**
   * Consecutive sweeps of its own symbol that did not return it.
   *
   * A signal is not dropped on the first miss. Detectors sit right on their
   * thresholds — a pattern can fall out and back in on one bar of noise — and
   * a signal that flickers off the desk mid-analysis is worse than one that
   * lingers a sweep too long.
   */
  missed: number;
};

export type Book = {
  entries: BookEntry[];
  /** Distinct symbols the book has ever had data for. */
  covered: string[];
};

export const EMPTY_BOOK: Book = { entries: [], covered: [] };

/** Misses tolerated before a signal leaves the book. */
const GRACE = 2;

/**
 * Folds a scan into the book.
 *
 * Pure, and takes `now` rather than reading the clock, so the ageing rules
 * are testable without pinning a global.
 */
export function mergeScan(book: Book, result: ScanResult, now: number): Book {
  const swept = new Set(result.covered);
  const incoming = new Map(result.signals.map((s) => [s.id, s]));

  const entries: BookEntry[] = [];

  for (const entry of book.entries) {
    const fresh = incoming.get(entry.signal.id);
    if (fresh) {
      // Keep the original first-seen: how long a setup has been standing is
      // the interesting number, and re-detecting it does not restart that.
      entries.push({
        signal: fresh,
        firstSeenAt: entry.firstSeenAt,
        lastConfirmedAt: now,
        missed: 0,
      });
      incoming.delete(entry.signal.id);
      continue;
    }

    // Its symbol was not looked at, so this scan says nothing about it.
    if (!swept.has(entry.signal.symbol)) {
      entries.push(entry);
      continue;
    }

    const missed = entry.missed + 1;
    if (missed < GRACE) entries.push({ ...entry, missed });
  }

  for (const signal of incoming.values()) {
    entries.push({
      signal,
      firstSeenAt: now,
      lastConfirmedAt: now,
      missed: 0,
    });
  }

  const covered = new Set(book.covered);
  for (const symbol of result.covered) covered.add(symbol);

  return { entries, covered: [...covered] };
}

/**
 * How long a full sweep of the universe takes, in ms.
 *
 * Every symbol is looked at once per cycle, so this is also the longest a
 * standing signal should ever go unconfirmed.
 */
export function sweepPeriodMs(
  passes: number,
  rotateEveryMs: number,
): number {
  return Math.max(1, passes) * rotateEveryMs;
}

/**
 * Whether a signal is overdue for confirmation.
 *
 * Not merely "old" — a signal is expected to go unconfirmed for up to a full
 * sweep, and that is normal. Stale means the rotation should have come back
 * round to its symbol and did not, which happens when scans are failing or
 * being throttled. It is a statement about the desk, not about the setup.
 */
export function isStale(
  entry: BookEntry,
  now: number,
  sweepMs: number,
): boolean {
  return now - entry.lastConfirmedAt > sweepMs;
}
