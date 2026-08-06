import type { SessionStatus } from "@/lib/market/session";
import { untilOpen } from "@/lib/market/session";
import type { Signal } from "./types";

/**
 * Whether a signal can actually be acted on right now.
 *
 * The engine has no clock in it — it scores geometry, and a pattern that
 * completed on the last bar of the day looks exactly like one that completed
 * at 10:00. But a signal you cannot take is a different object from one you
 * can, and the desk should say so rather than leaving you to notice the
 * closed-market light in the corner and do the arithmetic yourself.
 */

export type ExecutionNotice = {
  /** Compact form, for the badge on a signal card. */
  badge: string;
  /** The consequence, spelled out under the chart. */
  detail: string;
  /**
   * How long until the bell, as `11h 8m`. Carried separately from `badge` so
   * other renderings — a copied ticket, say — can phrase it their own way
   * rather than picking the display string apart.
   */
  wait: string;
  /**
   * True when price has already reached the trigger, so there is no resting
   * order to leave — the trade is a fill on the open, at whatever the open is.
   */
  atMarket: boolean;
};

/**
 * The notice for a signal that cannot be traded until the bell, or `null`
 * while the session is running.
 */
export function closedMarketNotice(
  signal: Signal,
  session: SessionStatus,
  now: number = Date.now(),
): ExecutionNotice | null {
  if (session.open || session.nextOpen === null) return null;

  const wait = untilOpen(session.nextOpen - now);

  // `buildLevels` puts the trigger at the break level unless price has gone
  // through it, in which case entry *is* the last price. Both are untradeable
  // right now, but they fail differently overnight, and the difference is the
  // whole reason to read the notice.
  const atMarket =
    signal.direction === "LONG"
      ? signal.price >= signal.entry
      : signal.price <= signal.entry;

  const gap = Math.abs(signal.entry - signal.price) / signal.price;
  const side = signal.direction === "LONG" ? "above" : "below";

  return {
    badge: `MARKET CLOSED · OPENS IN ${wait}`,
    detail: atMarket
      ? `Cannot be taken for ${wait}. Price is already at the trigger, so this is a fill on the open — the gap decides your entry, not the level.`
      : `Cannot be taken for ${wait}. The trigger sits ${(gap * 100).toFixed(1)}% ${side} the last price, so a resting order placed now works through the next session.`,
    wait,
    atMarket,
  };
}
