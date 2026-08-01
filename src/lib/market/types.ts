/** A single OHLCV bar. `time` is a unix timestamp in seconds. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Chart timeframes the desk supports, in the order they appear in the UI. */
export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

export type Series = {
  symbol: string;
  name: string;
  timeframe: Timeframe;
  /** Latest traded price, which may be newer than the last closed bar. */
  price: number;
  previousClose: number;
  currency: string;
  exchange: string;
  /** True while the exchange is in its regular session. */
  marketOpen: boolean;
  candles: Candle[];
};

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  marketOpen: boolean;
};
