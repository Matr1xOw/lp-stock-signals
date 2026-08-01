"use client";

import { compactDollars, money } from "@/lib/format";
import type { Performance } from "@/lib/journal/stats";

/**
 * The five tiles across the top.
 *
 * Every figure comes from closed trades in the journal, so an empty journal
 * shows em-dashes rather than zeros — "0.0% win rate" reads like a terrible
 * track record when it actually means "no trades yet".
 */

type Tile = {
  label: string;
  window: string;
  value: string;
  delta: string;
  tone: "neutral" | "up" | "down" | "amber";
  /** Bar fill, 0–1, or null to leave the track empty. */
  fill: number | null;
};

const TONE_TEXT = {
  neutral: "text-ink",
  up: "text-up",
  down: "text-down",
  amber: "text-amber",
} as const;

const TONE_BAR = {
  neutral: "bg-muted",
  up: "bg-up",
  down: "bg-down",
  amber: "bg-amber",
} as const;

export function Metrics({
  performance,
  startingCapital,
}: {
  performance: Performance;
  startingCapital: number;
}) {
  const {
    winRate,
    closedCount,
    wins,
    losses,
    total,
    unrealised,
    profitFactor,
    averageR,
    openExposure,
    openRisk,
  } = performance;

  const heat = startingCapital > 0 ? openRisk / startingCapital : 0;

  const tiles: Tile[] = [
    {
      label: "WIN RATE",
      window: `${closedCount} CLOSED`,
      value: winRate === null ? "—" : `${(winRate * 100).toFixed(1)}%`,
      delta: closedCount === 0 ? "no closed trades" : `${wins}W / ${losses}L`,
      tone: winRate === null ? "neutral" : winRate >= 0.5 ? "up" : "down",
      fill: winRate,
    },
    {
      label: "TOTAL P&L",
      window: "JOURNAL",
      value: total === 0 && closedCount === 0 ? "—" : compactDollars(total),
      delta: `${money(unrealised)} open`,
      tone: total > 0 ? "up" : total < 0 ? "down" : "neutral",
      // Scaled against the account, so the bar means something absolute.
      fill:
        startingCapital > 0
          ? Math.min(1, Math.abs(total) / (startingCapital * 0.25))
          : null,
    },
    {
      label: "PROFIT FACTOR",
      window: "JOURNAL",
      value:
        profitFactor === null
          ? closedCount > 0
            ? "∞"
            : "—"
          : profitFactor.toFixed(2),
      delta:
        profitFactor === null
          ? closedCount > 0
            ? "no losing trades"
            : "—"
          : profitFactor >= 1
            ? "profitable"
            : "unprofitable",
      tone:
        profitFactor === null
          ? closedCount > 0
            ? "up"
            : "neutral"
          : profitFactor >= 1
            ? "up"
            : "down",
      // 2.0 is a strong profit factor; treat it as a full bar.
      fill: profitFactor === null ? null : Math.min(1, profitFactor / 2),
    },
    {
      label: "AVG R",
      window: "WITH STOPS",
      value: averageR === null ? "—" : `${averageR.toFixed(2)}R`,
      delta: averageR === null ? "no stops recorded" : "per closed trade",
      tone: averageR === null ? "neutral" : averageR >= 0 ? "up" : "down",
      fill: averageR === null ? null : Math.min(1, Math.abs(averageR) / 2),
    },
    {
      label: "OPEN EXPOSURE",
      window: "NOW",
      value: openExposure === 0 ? "—" : compactDollars(openExposure),
      delta: `${(heat * 100).toFixed(1)}% heat`,
      tone: heat > 0.06 ? "down" : "amber",
      fill:
        startingCapital > 0
          ? Math.min(1, openExposure / startingCapital)
          : null,
    },
  ];

  return (
    <div className="grid flex-none grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col gap-1.5 rounded-[5px] border border-edge bg-panel px-3 pt-2.5 pb-[11px]"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] tracking-[0.15em] text-muted-2">
              {tile.label}
            </span>
            <span className="font-mono text-[9px] text-muted-5">
              {tile.window}
            </span>
          </div>

          <div className="flex items-end gap-2">
            <span
              className={`font-mono text-[25px] leading-none font-semibold tracking-[-0.01em] tnum ${TONE_TEXT[tile.tone]}`}
            >
              {tile.value}
            </span>
            <span className="pb-0.5 font-mono text-[10px] text-muted-3">
              {tile.delta}
            </span>
          </div>

          <div className="h-[3px] overflow-hidden rounded-sm bg-track">
            <div
              className={`h-full rounded-sm ${TONE_BAR[tile.tone]}`}
              style={{ width: `${(tile.fill ?? 0) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
