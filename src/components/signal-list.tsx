"use client";

import { price, timeAgo } from "@/lib/format";
import { useMounted, useTicker } from "@/lib/hooks";
import { suggestedSize } from "@/lib/journal/stats";
import type { Signal } from "@/lib/signals/types";
import { DeskButton, Panel, Pill } from "./panel";

export type SignalSort = "confidence" | "recent" | "rr";

export const SORT_LABELS: Record<SignalSort, string> = {
  confidence: "CONFIDENCE",
  recent: "MOST RECENT",
  rr: "REWARD:RISK",
};

function sortSignals(signals: Signal[], sort: SignalSort): Signal[] {
  const sorted = [...signals];
  if (sort === "rr") return sorted.sort((a, b) => b.rr - a.rr);
  if (sort === "recent") return sorted.sort((a, b) => b.detectedAt - a.detectedAt);
  return sorted.sort((a, b) => b.confidence - a.confidence);
}

/** Confidence colour, matching the thresholds used in the stat bar. */
function confidenceTone(confidence: number) {
  if (confidence >= 75) return { text: "text-up", bar: "bg-up" };
  if (confidence >= 62) return { text: "text-amber", bar: "bg-amber" };
  return { text: "text-muted", bar: "bg-muted" };
}

export function SignalList({
  signals,
  selectedId,
  sort,
  loading,
  error,
  riskPerTrade,
  accountSize,
  onSelect,
  onSort,
  onTake,
  onDismiss,
  onRescan,
}: {
  signals: Signal[];
  selectedId: string | null;
  sort: SignalSort;
  loading: boolean;
  error: string | null;
  riskPerTrade: number;
  accountSize: number;
  onSelect: (id: string) => void;
  onSort: (sort: SignalSort) => void;
  onTake: (signal: Signal) => void;
  onDismiss: (id: string) => void;
  onRescan: () => void;
}) {
  const now = useTicker(15_000);
  const mounted = useMounted();
  const ordered = sortSignals(signals, sort);

  const cycleSort = () => {
    const order: SignalSort[] = ["confidence", "recent", "rr"];
    onSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

  return (
    <Panel
      title="ALGO SIGNALS"
      badge={
        <Pill tone={signals.length > 0 ? "accent" : "neutral"}>
          {signals.length} LIVE
        </Pill>
      }
      actions={
        <div className="flex items-center gap-2">
          {error && (
            <span
              className="font-mono text-[9px] tracking-[0.1em] text-down"
              title={error}
            >
              STALE
            </span>
          )}
          <button
            type="button"
            onClick={cycleSort}
            className="cursor-pointer font-mono text-[9px] tracking-[0.1em] text-muted-2 transition hover:text-ink-soft"
            title="Change sort order"
          >
            SORT · {SORT_LABELS[sort]}
          </button>
        </div>
      }
      className="flex-1"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto p-2">
        {ordered.map((signal) => {
          const selected = signal.id === selectedId;
          const long = signal.direction === "LONG";
          const tone = confidenceTone(signal.confidence);
          const size = suggestedSize(signal.entry, signal.stop, riskPerTrade, accountSize);

          return (
            <div
              key={signal.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(signal.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(signal.id);
                }
              }}
              className={`flex cursor-pointer flex-col gap-2 rounded-[4px] border px-2.5 pt-2.5 pb-2 transition ${
                selected
                  ? "border-accent-edge bg-selected"
                  : "border-track bg-raised hover:border-edge-hover"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-[26px] w-[3px] flex-none rounded-sm ${long ? "bg-up" : "bg-down"}`}
                />

                <div className="flex min-w-0 flex-col gap-px">
                  <div className="flex items-baseline gap-[7px]">
                    <span className="font-mono text-[15px] font-semibold tracking-[0.02em]">
                      {signal.symbol}
                    </span>
                    <span
                      className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.12em] ${
                        long ? "bg-up-bg text-up" : "bg-down-bg text-down"
                      }`}
                    >
                      {signal.direction}
                    </span>
                    <span className="font-mono text-[10px] text-muted tnum">
                      {price(signal.price)}
                    </span>
                  </div>
                  <span className="truncate text-[11px] text-muted-2">
                    {signal.name}
                  </span>
                </div>

                <div className="flex-1" />

                <div className="flex flex-col items-end gap-[3px]">
                  <span className="font-mono text-[9px] tracking-[0.1em] text-muted-3">
                    CONF
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 w-[46px] overflow-hidden rounded-sm bg-track">
                      <div
                        className={`h-full ${tone.bar}`}
                        style={{ width: `${signal.confidence}%` }}
                      />
                    </div>
                    <span
                      className={`font-mono text-xs font-semibold tnum ${tone.text}`}
                    >
                      {signal.confidence}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-[3px] bg-track">
                <Cell label="ENTRY" value={price(signal.entry)} />
                <Cell label="STOP" value={price(signal.stop)} tone="text-down" />
                <Cell label="TARGET" value={price(signal.target)} tone="text-up" />
                <Cell label="R:R" value={`${signal.rr.toFixed(2)}R`} />
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-[2px] border border-edge-strong px-1.5 py-[3px] font-mono text-[9px] tracking-[0.06em] text-ink-dim">
                  {signal.pattern} · {signal.timeframe}
                </span>
                <span className="font-mono text-[10px] text-muted-3">
                  {mounted ? timeAgo(signal.detectedAt * 1000, now) : "—"}
                </span>
                <span className="font-mono text-[10px] text-muted-3 tnum">
                  {size} sh
                </span>

                <div className="flex-1" />

                <DeskButton
                  onClick={() => onDismiss(signal.id)}
                  title="Hide this signal for the rest of the session"
                >
                  DISMISS
                </DeskButton>
                <DeskButton
                  variant="primary"
                  onClick={() => onTake(signal)}
                  title="Log a trade from this signal"
                >
                  LOG TRADE
                </DeskButton>
              </div>
            </div>
          );
        })}

        {ordered.length === 0 && (
          <div className="px-4 py-[34px] text-center font-mono text-[11px] leading-[1.7] text-muted-4">
            {loading ? (
              <>SCANNING…</>
            ) : (
              <>
                NO SIGNALS CLEARED THE FILTERS
                <br />
                <button
                  type="button"
                  onClick={onRescan}
                  className="mt-3 cursor-pointer text-accent underline-offset-2 hover:underline"
                >
                  SCAN NEXT BATCH
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Cell({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-inset px-[7px] py-[5px]">
      <span className="font-mono text-[8px] tracking-[0.12em] text-muted-3">
        {label}
      </span>
      <span className={`font-mono text-xs tnum ${tone}`}>{value}</span>
    </div>
  );
}
