import type { Timeframe } from "@/lib/market/types";
import type { Direction as SignalDirection } from "@/lib/signals/types";

export type TradeDirection = SignalDirection;

/**
 * One exit out of a position.
 *
 * Exits are a list rather than a single price because real trades are scaled
 * out of — taking half off at the first target and letting the rest run is a
 * normal thing to do, and a journal that cannot record it will misstate both
 * the realised P&L and the average R of every trade managed that way.
 */
export type TradeExit = {
  id: string;
  quantity: number;
  price: number;
  /** Unix milliseconds. */
  at: number;
  note?: string;
};

/** A trade actually taken, recorded by hand or opened from a signal. */
export type Trade = {
  id: string;
  symbol: string;
  /** Company name, cached at entry so closed trades still read well. */
  name?: string;
  direction: TradeDirection;

  /** Shares or contracts opened. */
  quantity: number;
  entryPrice: number;
  /** Unix milliseconds. */
  entryAt: number;

  /** Planned stop, used to compute R multiples. */
  stop: number | null;
  /** Planned target. */
  target: number | null;

  /** Total commissions and fees for the whole trade. */
  fees: number;
  note: string;

  exits: TradeExit[];

  /** Set when the trade was opened from a signal, for later review. */
  source?: {
    signalId: string;
    pattern: string;
    timeframe: Timeframe;
    confidence: number;
  };
};

export type Settings = {
  /** Account size, used for the equity readout and position sizing. */
  startingCapital: number;
  /** Dollars risked per trade, used to suggest a size on a signal. */
  riskPerTrade: number;
};

export type JournalState = {
  version: number;
  trades: Trade[];
  settings: Settings;
};

export const DEFAULT_SETTINGS: Settings = {
  startingCapital: 100_000,
  riskPerTrade: 1_000,
};
