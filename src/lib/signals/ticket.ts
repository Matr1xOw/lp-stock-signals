import { suggestedSize } from "@/lib/journal/stats";
import type { ExecutionNotice } from "./execution";
import type { Signal } from "./types";

/**
 * A signal as plain text you can paste somewhere else.
 *
 * The desk shows a signal across four surfaces — card, stat strip, chart,
 * score bar — and none of that survives a selection drag. What a trader
 * actually wants to move is the ticket: the four numbers you need to place
 * the order, and just enough context to remember why, an hour later, in a
 * broker's note field or a chat window.
 *
 * Deliberately ASCII: this text lands in order tickets and spreadsheets that
 * still mangle anything else. The one exception is the interpunct, which is
 * safe everywhere and does real work separating clauses.
 */

/**
 * Folds the typographic characters the engine writes into free text back to
 * ASCII — `4.9× volume` becomes `4.9x volume`.
 *
 * They are there because they read better in a monospace column on screen,
 * which is not an argument that survives the trip to a broker's note field.
 */
function asciiFold(text: string): string {
  return text
    .replace(/×/g, "x")
    .replace(/[−–—]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Percentage move from entry to a level, signed: `+3.2%`, `-1.6%`. */
function fromEntry(level: number, entry: number): string {
  const move = ((level - entry) / entry) * 100;
  return `${move >= 0 ? "+" : "-"}${Math.abs(move).toFixed(1)}%`;
}

function row(label: string, value: string, note?: string): string {
  return `${label.padEnd(8)}${value}${note ? `  (${note})` : ""}`;
}

export function signalTicket(
  signal: Signal,
  {
    riskPerTrade,
    accountSize,
    notice = null,
  }: {
    riskPerTrade: number;
    accountSize: number;
    /** Appended as a last line when the signal cannot be traded yet. */
    notice?: ExecutionNotice | null;
  },
): string {
  const size = suggestedSize(
    signal.entry,
    signal.stop,
    riskPerTrade,
    accountSize,
  );

  const lines = [
    `${signal.symbol} ${signal.direction} · ${signal.timeframe}`,
    row("Entry", signal.entry.toFixed(2)),
    row("Stop", signal.stop.toFixed(2), fromEntry(signal.stop, signal.entry)),
    row(
      "Target",
      signal.target.toFixed(2),
      fromEntry(signal.target, signal.entry),
    ),
    row("R:R", `${signal.rr.toFixed(2)}R · ${size} shares at 1R`),
    "",
    asciiFold(`${signal.pattern}, ${signal.patternDetail}`),
  ];

  // The sample size travels with the win rate. A bare "61%" invites a
  // confidence the number has not earned when it came from nine setups.
  let confidence = `Confidence ${signal.confidence}/100`;
  if (signal.historicalWinRate !== null) {
    confidence += ` · hist win ${(signal.historicalWinRate * 100).toFixed(0)}% (${signal.historicalSample} setups)`;
  }
  lines.push(confidence);

  if (notice) lines.push(`MARKET CLOSED - opens in ${notice.wait}`);

  return lines.join("\n");
}
