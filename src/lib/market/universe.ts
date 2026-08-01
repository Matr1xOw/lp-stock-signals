/**
 * The symbols the scanner sweeps.
 *
 * Deliberately a curated list rather than the whole market: every symbol is
 * one upstream request per scan, and Yahoo's public endpoints will throttle
 * long before a few thousand tickers finish. These are liquid US large caps
 * and sector ETFs — names with enough volume for intraday patterns to mean
 * something — plus the index ETFs used for market context.
 */

export const BENCHMARK = "SPY";

export const UNIVERSE = [
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "ORCL", "CRM",
  "AMD", "ADBE", "NFLX", "INTC", "QCOM", "TXN", "MU", "AMAT", "PANW", "NOW",
  "SMCI", "ARM", "PLTR", "SNOW", "CRWD", "DDOG", "SHOP", "UBER", "ABNB", "COIN",

  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "SCHW", "AXP", "BLK", "V", "MA",

  // Healthcare
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ISRG", "AMGN", "VRTX",

  // Consumer & industrial
  "WMT", "COST", "HD", "MCD", "NKE", "SBUX", "LULU", "TGT", "DIS", "PG",
  "CAT", "DE", "BA", "GE", "HON", "UPS", "LMT", "RTX", "F", "GM",

  // Energy & materials
  "XOM", "CVX", "COP", "SLB", "OXY", "FCX", "NEM", "LIN",

  // Sector and index ETFs
  "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLU",
  "SMH", "ARKK", "GLD", "TLT",
] as const;

export type UniverseSymbol = (typeof UNIVERSE)[number];

/**
 * How many symbols a single scan may touch.
 *
 * The full universe at once is ~100 upstream requests. The cache absorbs
 * repeat scans, but the first one is cold, so scans rotate through slices.
 */
export const SCAN_BATCH = 40;

/**
 * Returns the slice of the universe to scan on a given pass.
 *
 * Successive passes advance through the list, so a few scans cover everything
 * while each individual scan stays polite.
 */
export function scanSlice(pass: number, batch = SCAN_BATCH): string[] {
  const size = Math.min(batch, UNIVERSE.length);
  const start = (pass * size) % UNIVERSE.length;
  const slice = UNIVERSE.slice(start, start + size);
  // Wrap around the end of the list rather than returning a short batch.
  return slice.length < size
    ? [...slice, ...UNIVERSE.slice(0, size - slice.length)]
    : [...slice];
}
