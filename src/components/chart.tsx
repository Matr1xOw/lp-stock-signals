"use client";

import { axisLabels, percent, price } from "@/lib/format";
import { TIMEFRAMES, type Series, type Timeframe } from "@/lib/market/types";
import type { Signal } from "@/lib/signals/types";

/**
 * Candlestick chart with the signal's levels drawn on it.
 *
 * Rendered with positioned elements rather than a canvas or a charting
 * library: at this size the whole chart is a few hundred absolutely-placed
 * divs, it inherits the theme's colours for free, and it keeps the bundle to
 * the app's own code.
 *
 * The vertical scale is always widened to contain the entry, stop and target
 * lines. Those levels are the reason the chart is on screen — a scale that
 * cropped the stop out of view would be actively misleading.
 */

/** Bars shown. The series carries far more, for the indicators to chew on. */
const VISIBLE_BARS = 90;
const GRID_LINES = 5;
const AXIS_WIDTH = 62;

export function Chart({
  series,
  signal,
  timeframe,
  loading,
  onTimeframe,
}: {
  series: Series | null;
  signal: Signal | null;
  timeframe: Timeframe;
  loading: boolean;
  onTimeframe: (timeframe: Timeframe) => void;
}) {
  const candles = series?.candles.slice(-VISIBLE_BARS) ?? [];

  const change = series ? series.price - series.previousClose : 0;
  const changePct =
    series && series.previousClose > 0 ? (change / series.previousClose) * 100 : 0;
  const changeTone = change >= 0 ? "text-up" : "text-down";

  // Price range: every candle, plus every level line that must stay visible.
  let low = Infinity;
  let high = -Infinity;
  let maxVolume = 0;
  for (const candle of candles) {
    low = Math.min(low, candle.low);
    high = Math.max(high, candle.high);
    maxVolume = Math.max(maxVolume, candle.volume);
  }
  if (signal) {
    low = Math.min(low, signal.entry, signal.stop, signal.target);
    high = Math.max(high, signal.entry, signal.stop, signal.target);
  }

  const hasRange = Number.isFinite(low) && Number.isFinite(high) && high > low;
  if (hasRange) {
    const pad = (high - low) * 0.05;
    low -= pad;
    high += pad;
  }

  /** Vertical position of a price, as a CSS percentage from the top. */
  const topOf = (value: number) =>
    hasRange ? `${(((high - value) / (high - low)) * 100).toFixed(2)}%` : "50%";

  const slot = candles.length > 0 ? 100 / candles.length : 0;
  const daily = timeframe === "1D";

  const gridLines = Array.from({ length: GRID_LINES }, (_, i) => {
    const fraction = (i + 0.5) / GRID_LINES;
    return {
      top: `${(fraction * 100).toFixed(2)}%`,
      label: hasRange ? price(high - (high - low) * fraction) : "—",
    };
  });

  const levels = signal
    ? [
        {
          key: "entry",
          label: `ENTRY ${price(signal.entry)}`,
          value: signal.entry,
          line: "border-accent",
          chip: "bg-accent-bg text-accent",
        },
        {
          key: "stop",
          label: `STOP ${price(signal.stop)}`,
          value: signal.stop,
          line: "border-down",
          chip: "bg-down-bg text-down",
        },
        {
          key: "target",
          label: `TGT ${price(signal.target)}`,
          value: signal.target,
          line: "border-up",
          chip: "bg-up-bg text-up",
        },
      ]
    : [];

  // Six evenly spaced time labels, drawn from the bars themselves.
  const tickIndices =
    candles.length > 0
      ? Array.from({ length: 6 }, (_, i) =>
          Math.min(candles.length - 1, Math.round((i / 5) * (candles.length - 1))),
        )
      : [];
  const tickLabels = axisLabels(
    tickIndices.map((i) => candles[i].time),
    daily,
  );
  const axisTicks = tickIndices.map((index, i) => ({
    key: index,
    label: tickLabels[i],
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-edge bg-panel">
      <div className="flex h-[34px] flex-none items-center gap-3 border-b border-edge bg-bar px-3">
        <span className="flex-none font-mono text-sm font-semibold tracking-[0.04em]">
          {series?.symbol ?? "—"}
        </span>
        <span className={`flex-none font-mono text-[13px] tnum ${changeTone}`}>
          {series ? price(series.price) : "—"}
        </span>
        <span
          className={`flex-none font-mono text-[11px] whitespace-nowrap tnum ${changeTone}`}
        >
          {series ? percent(changePct) : ""}
        </span>
        <span className="hidden truncate text-[11px] text-muted-2 lg:block">
          {series?.name}
        </span>

        <span className="min-w-0 flex-1" />

        <div className="flex flex-none gap-px rounded-[3px] bg-edge">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframe(tf)}
              className={`cursor-pointer border-0 px-[5px] py-1 font-mono text-[9px] transition ${
                tf === timeframe
                  ? "bg-accent-bg text-accent-bright"
                  : "bg-bar text-muted hover:text-ink-soft"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden pt-3 pl-2.5">
          {gridLines.map((line) => (
            <div
              key={line.top}
              className="absolute right-0 left-0 h-0 border-t border-hairline"
              style={{ top: line.top }}
            />
          ))}

          {candles.map((candle, index) => {
            const up = candle.close >= candle.open;
            const bodyTop = Math.max(candle.open, candle.close);
            const bodyBottom = Math.min(candle.open, candle.close);
            const span = high - low;

            return (
              <div
                key={candle.time}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${(index * slot + slot * 0.16).toFixed(3)}%`,
                  width: `${(slot * 0.68).toFixed(3)}%`,
                }}
              >
                <div
                  className={`absolute left-1/2 w-px -translate-x-1/2 ${up ? "bg-up" : "bg-down"}`}
                  style={{
                    top: topOf(candle.high),
                    height: `${(((candle.high - candle.low) / span) * 100).toFixed(2)}%`,
                  }}
                />
                <div
                  className={`absolute right-0 left-0 ${up ? "bg-up" : "bg-down"}`}
                  style={{
                    top: topOf(bodyTop),
                    // A doji still needs to be visible, hence the floor.
                    height: `${Math.max(0.35, ((bodyTop - bodyBottom) / span) * 100).toFixed(2)}%`,
                  }}
                />
              </div>
            );
          })}

          {levels.map((level) => (
            <div
              key={level.key}
              className={`absolute right-0 left-0 h-0 border-t border-dashed ${level.line}`}
              style={{ top: topOf(level.value) }}
            >
              <span
                className={`absolute -top-2 right-1 rounded-[2px] px-[5px] py-px font-mono text-[9px] tracking-[0.1em] ${level.chip}`}
              >
                {level.label}
              </span>
            </div>
          ))}

          {signal && candles.length > 0 && (
            <div
              className={`absolute flex h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-bold text-desk ${
                signal.direction === "LONG" ? "bg-up" : "bg-down"
              }`}
              style={{
                left: `${((candles.length - 1) * slot + slot * 0.5).toFixed(2)}%`,
                top: topOf(signal.entry),
              }}
              title={`${signal.direction} entry ${price(signal.entry)}`}
            >
              {signal.direction === "LONG" ? "▲" : "▼"}
            </div>
          )}

          {candles.length === 0 && (
            <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-4">
              {loading ? "LOADING BARS…" : "NO CHART DATA"}
            </div>
          )}
        </div>

        <div
          className="relative flex-none border-l border-edge"
          style={{ width: AXIS_WIDTH }}
        >
          {gridLines.map((line) => (
            <span
              key={line.top}
              className="absolute left-[7px] -translate-y-1/2 font-mono text-[10px] text-muted-2 tnum"
              style={{ top: line.top }}
            >
              {line.label}
            </span>
          ))}

          {series && hasRange && (
            <span
              className={`absolute right-1 left-1 -translate-y-1/2 rounded-[2px] py-0.5 text-center font-mono text-[10px] font-semibold text-desk tnum ${
                change >= 0 ? "bg-up" : "bg-down"
              }`}
              style={{ top: topOf(series.price) }}
            >
              {price(series.price)}
            </span>
          )}
        </div>
      </div>

      <div className="flex h-[52px] flex-none border-t border-hairline">
        <div className="relative min-w-0 flex-1 pt-2 pl-2.5">
          {candles.map((candle, index) => (
            <div
              key={candle.time}
              className={`absolute bottom-0 ${
                candle.close >= candle.open ? "bg-up-vol" : "bg-down-vol"
              }`}
              style={{
                left: `${(index * slot + slot * 0.16).toFixed(3)}%`,
                width: `${(slot * 0.68).toFixed(3)}%`,
                height: `${maxVolume > 0 ? Math.max(6, (candle.volume / maxVolume) * 100).toFixed(1) : 0}%`,
              }}
            />
          ))}
        </div>
        <div
          className="flex-none border-l border-edge pt-1.5 pl-[7px]"
          style={{ width: AXIS_WIDTH }}
        >
          <span className="font-mono text-[9px] tracking-[0.1em] text-muted-3">
            VOL
          </span>
        </div>
      </div>

      <div
        className="flex h-6 flex-none items-center border-t border-edge bg-sunken pl-2.5"
        style={{ paddingRight: AXIS_WIDTH + 10 }}
      >
        {axisTicks.map((tick) => (
          <span
            key={tick.key}
            className="flex-1 font-mono text-[9px] text-muted-3"
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
