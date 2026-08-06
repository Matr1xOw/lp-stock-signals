"use client";

import { dollars, holdDuration, timeAgo } from "@/lib/format";
import { useMounted, useSession, useTicker } from "@/lib/hooks";
import { suggestedSize } from "@/lib/journal/stats";
import { closedMarketNotice } from "@/lib/signals/execution";
import { signalTicket } from "@/lib/signals/ticket";
import type { Signal } from "@/lib/signals/types";
import { CopyButton } from "./copy-button";
import { DeskButton } from "./panel";
import { ClosedNote } from "./session-notice";

/**
 * The strip beneath the chart: what was detected, and why it scored what it
 * scored.
 *
 * The confidence breakdown is shown rather than just the number. A score with
 * no visible derivation is something you either trust blindly or ignore; the
 * per-factor points make it possible to disagree with the engine on a
 * specific point — "I don't care that it correlates with SPY" — which is the
 * only way a discretionary trader can use a score like this well.
 */
export function SignalDetail({
  signal,
  riskPerTrade,
  accountSize,
  onTake,
  onDismiss,
}: {
  signal: Signal | null;
  riskPerTrade: number;
  accountSize: number;
  onTake: (signal: Signal) => void;
  onDismiss: (id: string) => void;
}) {
  const now = useTicker(15_000);
  const mounted = useMounted();
  const { session } = useSession();

  if (!signal) {
    return (
      <div className="flex-none rounded-[5px] border border-edge bg-panel px-3.5 py-4 text-center font-mono text-[11px] text-muted-4">
        SELECT A SIGNAL TO SEE ITS BREAKDOWN
      </div>
    );
  }

  const long = signal.direction === "LONG";
  const size = suggestedSize(signal.entry, signal.stop, riskPerTrade, accountSize);
  const closed = session ? closedMarketNotice(signal, session, now) : null;

  const stats = [
    {
      label: "DIRECTION",
      value: signal.direction,
      tone: long ? "text-up" : "text-down",
      sub: `${signal.timeframe} bars`,
    },
    {
      label: "CONFIDENCE",
      value: `${signal.confidence}`,
      tone:
        signal.confidence >= 75
          ? "text-up"
          : signal.confidence >= 62
            ? "text-amber"
            : "text-ink",
      sub: "of 100",
    },
    {
      label: "R:R",
      value: `${signal.rr.toFixed(2)}R`,
      tone: "text-ink",
      sub: `risk ${dollars(riskPerTrade)}`,
    },
    {
      label: "HIST WIN",
      value:
        signal.historicalWinRate === null
          ? "—"
          : `${(signal.historicalWinRate * 100).toFixed(0)}%`,
      tone: "text-ink",
      sub:
        signal.historicalSample === 0
          ? "no prior setups"
          : `${signal.historicalSample} prior setups`,
    },
    {
      label: "EXPECTANCY",
      value:
        signal.historicalExpectancy === null
          ? "—"
          : `${signal.historicalExpectancy >= 0 ? "+" : "−"}${Math.abs(signal.historicalExpectancy).toFixed(2)}R`,
      tone:
        signal.historicalExpectancy === null
          ? "text-ink"
          : signal.historicalExpectancy >= 0
            ? "text-up"
            : "text-down",
      sub: "per prior setup",
    },
    {
      label: "TYPICAL HOLD",
      value:
        signal.typicalHoldBars === null
          ? "—"
          : holdDuration(signal.typicalHoldBars, signal.timeframe),
      tone: "text-ink",
      sub:
        signal.typicalHoldBars === null
          ? "too few to measure"
          : `median of ${signal.historicalSample}`,
    },
    {
      label: "TYPICAL HEAT",
      value:
        signal.typicalHeatR === null
          ? "—"
          : `${signal.typicalHeatR.toFixed(2)}R`,
      tone:
        signal.typicalHeatR === null
          ? "text-ink"
          : signal.typicalHeatR >= 0.75
            ? "text-amber"
            : "text-ink",
      sub:
        signal.typicalHeatR === null
          ? "too few winners"
          : "against you first",
    },
    {
      label: "SUGG SIZE",
      value: `${size}`,
      tone: "text-ink",
      sub: "shares at 1R",
    },
  ];

  return (
    <div className="flex flex-none flex-col overflow-hidden rounded-[5px] border border-edge bg-panel">
      <div className="flex flex-wrap items-stretch">
        <div className="flex min-w-0 flex-1 basis-[168px] flex-col gap-1 border-r border-edge px-3.5 py-2.5">
          <span className="font-mono text-[9px] tracking-[0.14em] text-muted-2">
            PATTERN DETECTED
          </span>
          <span className="font-mono text-[13px] text-ink-soft">
            {signal.pattern}
          </span>
          <span className="font-mono text-[10px] text-muted-3">
            {mounted ? timeAgo(signal.detectedAt * 1000, now) : "—"} ·{" "}
            {signal.patternDetail}
          </span>
        </div>

        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex min-w-0 flex-1 basis-24 flex-col gap-1 border-r border-hairline px-3.5 py-2.5"
          >
            <span className="truncate font-mono text-[9px] tracking-[0.14em] text-muted-2">
              {stat.label}
            </span>
            <span
              className={`font-mono text-[15px] font-medium tnum ${stat.tone}`}
            >
              {stat.value}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-3">
              {stat.sub}
            </span>
          </div>
        ))}

        <div className="ml-auto flex flex-none items-center gap-2 px-3.5 py-2.5">
          <CopyButton
            label="COPY TICKET"
            text={() =>
              signalTicket(signal, {
                riskPerTrade,
                accountSize,
                notice: closed,
              })
            }
          />
          <DeskButton onClick={() => onDismiss(signal.id)}>DISMISS</DeskButton>
          <DeskButton variant="primary" onClick={() => onTake(signal)}>
            LOG TRADE
          </DeskButton>
        </div>
      </div>

      {closed && <ClosedNote notice={closed} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline bg-sunken px-3.5 py-2">
        <span className="font-mono text-[9px] tracking-[0.14em] text-muted-3">
          SCORE
        </span>
        {signal.factors.map((factor) => (
          <div
            key={factor.label}
            className="flex items-center gap-1.5"
            title={factor.detail}
          >
            <span className="font-mono text-[9px] tracking-[0.08em] text-muted-2">
              {factor.label}
            </span>
            <div className="h-1 w-8 overflow-hidden rounded-sm bg-track">
              <div
                className="h-full bg-accent"
                style={{ width: `${(factor.points / factor.max) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-ink-dim tnum">
              {factor.points}/{factor.max}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
