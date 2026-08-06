import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_BOOK, isStale, mergeScan, sweepPeriodMs } from "./book";
import type { Book } from "./book";
import type { ScanResult, Signal } from "./types";

function signal(symbol: string, pattern = "BULL FLAG"): Signal {
  return {
    id: `${symbol}-15m-${pattern}`.replace(/[^A-Za-z0-9-]+/g, "-"),
    symbol,
    name: `${symbol} Inc.`,
    direction: "LONG",
    timeframe: "15m",
    entry: 100,
    stop: 98,
    target: 106,
    rr: 3,
    price: 100,
    previousClose: 99,
    pattern,
    patternDetail: "detail",
    detectedAt: 1_770_000_000,
    confidence: 70,
    factors: [],
    context: {
      adx: 25, plusDi: 25, minusDi: 15, rsi: 55,
      macdHistogram: 0.2, relativeVolume: 1.5,
      benchmarkCorrelation: 0.3, atr: 2,
    },
    historicalWinRate: null,
    historicalExpectancy: null,
    typicalHoldBars: null,
    typicalHeatR: null,
    historicalSample: 0,
  };
}

function scan(covered: string[], signals: Signal[], pass = 0): ScanResult {
  return {
    signals,
    covered,
    pass,
    passes: 3,
    scanned: covered.length,
    failed: [],
    universeSize: 92,
    durationMs: 10,
    marketOpen: true,
    scannedAt: 0,
  };
}

const ids = (book: Book) => book.entries.map((e) => e.signal.id).sort();

describe("mergeScan", () => {
  it("adds signals from a scan of an empty book", () => {
    const book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    assert.deepEqual(ids(book), ["AAPL-15m-BULL-FLAG"]);
    assert.equal(book.entries[0].firstSeenAt, 1_000);
    assert.equal(book.entries[0].lastConfirmedAt, 1_000);
  });

  it("accumulates across passes instead of replacing", () => {
    // The bug this whole module exists to fix: a second slice must add to the
    // book, not become it.
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    book = mergeScan(book, scan(["JPM"], [signal("JPM")], 1), 2_000);
    assert.deepEqual(ids(book), ["AAPL-15m-BULL-FLAG", "JPM-15m-BULL-FLAG"]);
  });

  it("leaves a signal alone when its symbol was not swept", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    book = mergeScan(book, scan(["JPM"], [], 1), 2_000);
    assert.deepEqual(ids(book), ["AAPL-15m-BULL-FLAG"]);
    // Untouched, so still confirmed at its original time.
    assert.equal(book.entries[0].lastConfirmedAt, 1_000);
    assert.equal(book.entries[0].missed, 0);
  });

  it("expires a signal only after its symbol comes back without it", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);

    // First miss: kept, because detectors flicker on threshold noise.
    book = mergeScan(book, scan(["AAPL"], []), 2_000);
    assert.deepEqual(ids(book), ["AAPL-15m-BULL-FLAG"]);
    assert.equal(book.entries[0].missed, 1);

    // Second consecutive miss: gone.
    book = mergeScan(book, scan(["AAPL"], []), 3_000);
    assert.deepEqual(ids(book), []);
  });

  it("forgives a miss when the signal comes back", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    book = mergeScan(book, scan(["AAPL"], []), 2_000);
    book = mergeScan(book, scan(["AAPL"], [signal("AAPL")]), 3_000);
    assert.equal(book.entries[0].missed, 0);
    assert.equal(book.entries[0].lastConfirmedAt, 3_000);
  });

  it("never expires a signal whose symbol only ever failed to fetch", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    // `covered` reports what came back; a throttled symbol is not in it.
    for (let t = 2; t < 10; t++) {
      book = mergeScan(book, { ...scan([], []), failed: ["AAPL"] }, t * 1_000);
    }
    assert.deepEqual(ids(book), ["AAPL-15m-BULL-FLAG"]);
  });

  it("refreshes the signal but keeps how long it has been standing", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 1_000);
    const moved = { ...signal("AAPL"), entry: 101, confidence: 82 };
    book = mergeScan(book, scan(["AAPL"], [moved]), 5_000);

    assert.equal(book.entries[0].signal.confidence, 82);
    assert.equal(book.entries[0].signal.entry, 101);
    assert.equal(book.entries[0].firstSeenAt, 1_000);
    assert.equal(book.entries[0].lastConfirmedAt, 5_000);
  });

  it("keeps two patterns on one symbol apart", () => {
    const book = mergeScan(
      EMPTY_BOOK,
      scan(["AAPL"], [signal("AAPL"), signal("AAPL", "CUP & HANDLE")]),
      1_000,
    );
    assert.equal(book.entries.length, 2);
  });

  it("tracks coverage as the sweep progresses", () => {
    let book = mergeScan(EMPTY_BOOK, scan(["AAPL", "MSFT"], []), 1_000);
    assert.equal(book.covered.length, 2);
    book = mergeScan(book, scan(["MSFT", "JPM"], [], 1), 2_000);
    // MSFT was already counted; coverage is distinct symbols, not scans.
    assert.deepEqual([...book.covered].sort(), ["AAPL", "JPM", "MSFT"]);
  });
});

describe("isStale", () => {
  const sweep = sweepPeriodMs(3, 120_000);

  it("computes a sweep as one rotation through every pass", () => {
    assert.equal(sweep, 360_000);
  });

  it("is not stale merely for going unconfirmed within a sweep", () => {
    const book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 0);
    assert.equal(isStale(book.entries[0], 300_000, sweep), false);
  });

  it("is stale once the rotation should have returned and did not", () => {
    const book = mergeScan(EMPTY_BOOK, scan(["AAPL"], [signal("AAPL")]), 0);
    assert.equal(isStale(book.entries[0], 400_000, sweep), true);
  });
});
