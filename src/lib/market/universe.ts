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
 * The most symbols a single scan may touch.
 *
 * The full universe at once is ~100 upstream requests. The cache absorbs
 * repeat scans, but the first one is cold, so scans rotate through slices.
 */
export const SCAN_BATCH = 40;

/**
 * How many passes it takes to cover the universe once.
 *
 * The desk rotates through these continuously, so this is also the length of
 * a full sweep — every symbol is looked at once per `passCount()` scans.
 */
export function passCount(batch = SCAN_BATCH): number {
  return Math.ceil(UNIVERSE.length / Math.max(1, batch));
}

/**
 * Returns the slice of the universe to scan on a given pass.
 *
 * The passes partition the universe: every symbol belongs to exactly one, and
 * `passCount()` consecutive passes cover all of it with nothing repeated.
 *
 * That property is the whole point, and an earlier stride-based version did
 * not have it — advancing by a fixed 40 through 92 symbols made pass 2 re-scan
 * 28 names from pass 0 while pass 3 started mid-list. The desk now expires a
 * signal when its symbol was swept and it did not come back, which is only
 * sound if "swept" is something the rotation actually guarantees.
 *
 * Slices are evenly sized rather than packed to `batch`, so each scan carries
 * the same upstream load instead of ending the cycle on a stub.
 *
 * They interleave rather than taking contiguous blocks, because the universe
 * is written in sector order. Contiguous slices would make pass 0 entirely
 * mega-cap tech, which matters for more than variety: the engine pools each
 * scan's symbols into the pattern priors that phase 2c shrinks toward, and a
 * prior estimated from one sector is a sector's prior wearing the universe's
 * name. Taking every Nth symbol gives each pass a cross-section.
 */
export function scanSlice(pass: number, batch = SCAN_BATCH): string[] {
  const passes = passCount(batch);
  // Negative passes are not expected, but modulo them into range rather than
  // returning an empty slice that would silently expire the whole book.
  const index = ((Math.trunc(pass) % passes) + passes) % passes;
  return UNIVERSE.filter((_, i) => i % passes === index);
}
