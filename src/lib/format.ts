import type { Timeframe } from "@/lib/market/types";

/** Display formatting shared across the desk. */

/** Minutes of trading each timeframe's bar covers. */
const BAR_MINUTES: Record<Timeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1D": 390,
};

/** A US equity session is 6.5 hours, not 24. */
const SESSION_MINUTES = 390;

/**
 * Turns a bar count into wall-clock trading time: "45m", "2.8h", "1.3 days".
 *
 * Deliberately measures *trading* time rather than calendar time. Nine
 * 15-minute bars is 2.3 hours of market, but if they straddle an overnight
 * it is eighteen hours of clock — and the useful reading is how long the
 * market has to work, not how long the user waits.
 */
export function holdDuration(bars: number, timeframe: Timeframe): string {
  if (timeframe === "1D") {
    return `${bars.toFixed(bars % 1 === 0 ? 0 : 1)} days`;
  }
  const minutes = bars * BAR_MINUTES[timeframe];
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < SESSION_MINUTES) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / SESSION_MINUTES).toFixed(1)} days`;
}

/** Signed dollar amount, whole dollars: `+$3,840` / `−$212`. */
export function money(value: number): string {
  const amount = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  // U+2212 minus, not a hyphen — it aligns with digits in a monospace font.
  return `${value < 0 ? "−" : "+"}$${amount}`;
}

/** Unsigned dollar amount, whole dollars. */
export function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Compact dollars for tiles: `$261k`. */
export function compactDollars(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function price(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function percent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

export function rMultiple(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}R`;
}

/** Short relative time: `2m ago`, `3h ago`, `4d ago`. */
export function timeAgo(timestampMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Wall clock in the exchange's timezone, which is the one that matters. */
export function marketClock(date = new Date()): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    timeZone: "America/New_York",
  });
}

/** Bar timestamp as an axis label, in exchange time. */
export function barLabel(unixSeconds: number, daily: boolean): string {
  const date = new Date(unixSeconds * 1000);
  return daily
    ? date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      })
    : date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      });
}

export function dateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
}
