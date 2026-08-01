/** Display formatting shared across the desk. */

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
