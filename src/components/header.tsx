"use client";

import { marketClock, money, timeAgo } from "@/lib/format";
import { useMounted, useTicker } from "@/lib/hooks";

/**
 * The status strip across the top: what the engine is doing, and what the
 * account is worth.
 */
export function Header({
  marketOpen,
  scannedAt,
  scanned,
  universeSize,
  equity,
  dayPnl,
  onOpenSettings,
}: {
  marketOpen: boolean;
  scannedAt: number | null;
  scanned: number;
  universeSize: number;
  equity: number;
  dayPnl: number;
  onOpenSettings: () => void;
}) {
  const now = useTicker(1_000);
  // The clock and "scan Ns ago" are time-dependent, so they cannot be
  // rendered on the server without a hydration mismatch.
  const mounted = useMounted();

  return (
    <header className="flex h-11 flex-none items-center gap-[22px] rounded-[5px] border border-edge bg-panel px-3.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-semibold tracking-[0.14em]">
          SIGNAL DESK
        </span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-muted-3">
          v1.0
        </span>
      </div>

      <div
        className={`flex items-center gap-[7px] rounded-[3px] border px-2.5 py-[3px] ${
          marketOpen
            ? "border-up-edge bg-up-bg/60"
            : "border-edge bg-track/40"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            marketOpen ? "bg-up pulse-dot" : "bg-muted-4"
          }`}
        />
        <span
          className={`font-mono text-[10px] tracking-[0.12em] ${
            marketOpen ? "text-up-dim" : "text-muted-3"
          }`}
        >
          {marketOpen ? "MARKET OPEN" : "MARKET CLOSED"}
        </span>
      </div>

      <div className="flex items-center gap-[18px] font-mono text-[11px] text-muted">
        <span className="tnum">{mounted ? marketClock(new Date(now)) : "--:--:--"} ET</span>
        <span>
          SCAN{" "}
          <span className="text-ink">
            {mounted && scannedAt ? timeAgo(scannedAt, now) : "—"}
          </span>
        </span>
        <span>
          UNIVERSE{" "}
          <span className="text-ink tnum">
            {scanned}/{universeSize}
          </span>
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-5">
        <div className="flex flex-col items-end gap-px">
          <span className="font-mono text-[9px] tracking-[0.14em] text-muted-3">
            EQUITY
          </span>
          <span className="font-mono text-sm font-semibold tnum">
            ${Math.round(equity).toLocaleString("en-US")}
          </span>
        </div>

        <div className="flex flex-col items-end gap-px">
          <span className="font-mono text-[9px] tracking-[0.14em] text-muted-3">
            OPEN P&L
          </span>
          <span
            className={`font-mono text-sm font-semibold tnum ${
              dayPnl >= 0 ? "text-up" : "text-down"
            }`}
          >
            {money(dayPnl)}
          </span>
        </div>

        <div className="h-6 w-px bg-edge" />

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex cursor-pointer items-center gap-2 rounded-[3px] border border-edge py-1 pr-1 pl-2.5 transition hover:border-edge-hover"
          title="Journal settings, export and import"
        >
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted">
            JOURNAL
          </span>
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[2px] bg-track font-mono text-[10px] font-semibold text-ink-soft">
            ⚙
          </span>
        </button>
      </div>
    </header>
  );
}
