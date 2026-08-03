/**
 * The US equity session calendar.
 *
 * `Series.marketOpen` already reports whether the exchange was open when a
 * scan ran, which is enough for a status light but not for a notifier: a
 * signal you cannot act on should say when you *will* be able to, and that
 * answer is a calendar question — weekends, ten full closures a year, a
 * couple of 13:00 half-days, and a timezone that shifts relative to the
 * user's twice a year.
 *
 * Everything here is computed in exchange time from an absolute instant, so
 * it gives the same answer on the server, in a browser in Lisbon, and in a
 * test that pins the clock.
 */

const ZONE = "America/New_York";

const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;
const EARLY_CLOSE_MINUTE = 13 * 60;

/**
 * Full closures, as exchange-local dates.
 *
 * Hard-coded rather than derived: the observance rules are simple enough
 * until they aren't — Good Friday moves with Easter, and a holiday landing on
 * a weekend shifts to the adjacent weekday in a direction that depends on
 * which weekend day it hit. A table is wrong loudly rather than subtly.
 *
 * Extend this each year. Past the last date covered, the functions below fall
 * back to plain weekday rules, which is the right way to degrade: the worst
 * case is a notifier that promises an open on a future Thanksgiving.
 */
const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed — the 4th is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26", // Good Friday
  "2027-05-31",
  "2027-06-18", // Juneteenth (observed — the 19th is a Saturday)
  "2027-07-05", // Independence Day (observed — the 4th is a Sunday)
  "2027-09-06",
  "2027-11-25",
  "2027-12-24", // Christmas (observed — the 25th is a Saturday)
]);

/**
 * Half-days closing at 13:00 ET.
 *
 * Note what is *not* here: there is no early close before a holiday that has
 * itself been shifted onto a Friday or Monday, which is why neither July 2026
 * nor July 2027 appears.
 */
const EARLY_CLOSES = new Set([
  "2026-11-27", // day after Thanksgiving
  "2026-12-24", // Christmas Eve
  "2027-11-26", // day after Thanksgiving
]);

/** A wall-clock reading in exchange time. */
type ExchangeTime = {
  year: number;
  month: number;
  day: number;
  /** Minutes since exchange-local midnight. */
  minute: number;
};

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Reads an absolute instant as exchange wall-clock time. */
function exchangeTime(at: number): ExchangeTime {
  const parts: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(at))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** How far exchange time runs behind UTC at a given instant, in ms. */
function offsetAt(at: number): number {
  const minute = Math.floor(at / 60_000) * 60_000;
  const wall = exchangeTime(minute);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, 0, wall.minute) - minute
  );
}

/**
 * The inverse of {@link exchangeTime}: the instant at which the exchange
 * clock reads this date and minute.
 *
 * Resolved in two passes because the offset has to be sampled at some instant
 * before it is known, and the first sample can land the wrong side of a DST
 * change. The second pass samples from within the corrected day.
 */
function instantAt(
  year: number,
  month: number,
  day: number,
  minute: number,
): number {
  const naive = Date.UTC(year, month - 1, day, 0, minute);
  let instant = naive;
  for (let pass = 0; pass < 2; pass++) instant = naive - offsetAt(instant);
  return instant;
}

function isoDate({ year, month, day }: ExchangeTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(date: ExchangeTime, days: number): ExchangeTime {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    minute: 0,
  };
}

/** The minute a date's session ends, or `null` if the exchange is shut. */
function closeMinuteOn(date: ExchangeTime): number | null {
  const weekday = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  if (weekday === 0 || weekday === 6) return null;

  const key = isoDate(date);
  if (HOLIDAYS.has(key)) return null;
  return EARLY_CLOSES.has(key) ? EARLY_CLOSE_MINUTE : CLOSE_MINUTE;
}

function nextOpenAfter(from: ExchangeTime): number {
  let date = from;
  // Today counts only if it trades and its bell has not rung yet. Otherwise
  // walk forward — ten days clears the longest weekend-plus-holiday run.
  if (closeMinuteOn(date) === null || from.minute >= OPEN_MINUTE) {
    date = addDays(date, 1);
    for (let i = 0; i < 10 && closeMinuteOn(date) === null; i++) {
      date = addDays(date, 1);
    }
  }
  return instantAt(date.year, date.month, date.day, OPEN_MINUTE);
}

export type SessionStatus = {
  /** True during the regular session. Pre- and post-market do not count. */
  open: boolean;
  /** Instant the next regular session opens. `null` only while open. */
  nextOpen: number | null;
  /** Instant this session closes. `null` while shut. */
  closesAt: number | null;
  /** Whether the current or next session ends early, at 13:00 ET. */
  earlyClose: boolean;
};

/** Where the exchange stands at a given instant. */
export function sessionStatus(at: number = Date.now()): SessionStatus {
  const now = exchangeTime(at);
  const close = closeMinuteOn(now);

  if (close !== null && now.minute >= OPEN_MINUTE && now.minute < close) {
    return {
      open: true,
      nextOpen: null,
      closesAt: instantAt(now.year, now.month, now.day, close),
      earlyClose: close === EARLY_CLOSE_MINUTE,
    };
  }

  const nextOpen = nextOpenAfter(now);
  return {
    open: false,
    nextOpen,
    closesAt: null,
    earlyClose: EARLY_CLOSES.has(isoDate(exchangeTime(nextOpen))),
  };
}

/**
 * Coarse countdown for a notifier: `4m`, `2h 14m`, `3d 4h`.
 *
 * Rounds up, so it never reads `0m` while there is still time to wait, and
 * drops to a single unit past a day — the difference between 62 and 63 hours
 * is not a thing anyone acts on.
 */
export function untilOpen(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}
