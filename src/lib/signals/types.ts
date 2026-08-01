import type { Direction } from "@/lib/analysis/patterns";
import type { Timeframe } from "@/lib/market/types";

export type { Direction };

/** The indicator readings that justified — or vetoed — a signal. */
export type SignalContext = {
  adx: number;
  plusDi: number;
  minusDi: number;
  rsi: number;
  macdHistogram: number;
  relativeVolume: number;
  /** Correlation of this symbol's returns with the benchmark's. */
  benchmarkCorrelation: number;
  atr: number;
};

export type Signal = {
  id: string;
  symbol: string;
  name: string;
  direction: Direction;
  timeframe: Timeframe;

  /** Trigger price for the trade. */
  entry: number;
  /** Where the idea is wrong. */
  stop: number;
  /** Measured-move objective. */
  target: number;
  /** Reward-to-risk multiple. */
  rr: number;

  /** Last traded price. */
  price: number;
  previousClose: number;

  pattern: string;
  patternDetail: string;
  /** Bar timestamp the pattern completed on, in unix seconds. */
  detectedAt: number;

  /** 0–100 blended conviction. */
  confidence: number;
  /** How the confidence was arrived at, for the UI to show its work. */
  factors: SignalFactor[];
  context: SignalContext;

  /**
   * Share of historical occurrences of this pattern on this symbol that
   * reached target before stop. `null` when there were too few to measure.
   */
  historicalWinRate: number | null;
  /** Average R per historical occurrence — win rate alone can mislead. */
  historicalExpectancy: number | null;
  /**
   * Median bars past occurrences took to hit target or stop — how long this
   * setup usually needs before it has answered one way or the other.
   */
  typicalHoldBars: number | null;
  historicalSample: number;
};

export type SignalFactor = {
  label: string;
  /** Contribution to the confidence score, in points. */
  points: number;
  /** Points this factor could have contributed. */
  max: number;
  detail: string;
};

export type ScanResult = {
  signals: Signal[];
  /** Symbols examined on this pass. */
  scanned: number;
  /** Symbols that failed to fetch. */
  failed: string[];
  /** Total size of the configured universe. */
  universeSize: number;
  /** Wall-clock duration of the scan, in milliseconds. */
  durationMs: number;
  /** Whether the US equity session was open when the scan ran. */
  marketOpen: boolean;
  scannedAt: number;
};
