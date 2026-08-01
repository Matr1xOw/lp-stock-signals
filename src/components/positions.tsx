"use client";

import { dollars, money, percent, price, rMultiple } from "@/lib/format";
import {
  isOpen,
  openQuantity,
  progressToTarget,
  realisedPnl,
  rMultiple as rOf,
  unrealisedPnl,
} from "@/lib/journal/stats";
import type { Trade } from "@/lib/journal/types";
import { DeskButton, Panel } from "./panel";

/**
 * Open trades, marked to market.
 *
 * These are real positions the user reported taking, so nothing here is
 * simulated — the only thing the app contributes is the current price and the
 * arithmetic on top of it.
 */
export function Positions({
  trades,
  prices,
  openExposure,
  openRisk,
  buyingPower,
  onClose,
  onTrim,
  onAdd,
  onEdit,
}: {
  trades: Trade[];
  prices: Record<string, number>;
  openExposure: number;
  openRisk: number;
  buyingPower: number;
  onClose: (trade: Trade) => void;
  onTrim: (trade: Trade) => void;
  onAdd: () => void;
  onEdit: (trade: Trade) => void;
}) {
  const open = trades.filter(isOpen);
  const totalUnrealised = open.reduce(
    (sum, trade) => sum + unrealisedPnl(trade, prices[trade.symbol]),
    0,
  );

  return (
    <Panel
      title="MY POSITIONS"
      badge={
        <span className="font-mono text-[9px] text-muted-2">
          {open.length} OPEN
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[11px] font-semibold tnum ${
              totalUnrealised >= 0 ? "text-up" : "text-down"
            }`}
          >
            {money(totalUnrealised)}
          </span>
          <DeskButton onClick={onAdd} title="Log a trade you already took">
            + LOG
          </DeskButton>
        </div>
      }
      className="flex-[1_1_62%]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {open.map((trade) => {
          const mark = prices[trade.symbol];
          const qty = openQuantity(trade);
          const pnl =
            unrealisedPnl(trade, mark) + realisedPnl(trade);
          const long = trade.direction === "LONG";
          const pnlTone = pnl >= 0 ? "text-up" : "text-down";
          const pnlBar = pnl >= 0 ? "bg-up" : "bg-down";

          const pct =
            mark !== undefined
              ? ((mark - trade.entryPrice) / trade.entryPrice) *
                100 *
                (long ? 1 : -1)
              : null;
          const r = rOf(trade, mark);
          const progress = progressToTarget(trade, mark);

          // Where entry sits on the stop→target track, so the fill shows
          // travel from the entry rather than from the bottom of the bar.
          // Computed with the same function as the mark, so both ends of the
          // fill are measured on one scale.
          const entryProgress = progressToTarget(trade, trade.entryPrice);

          return (
            <div
              key={trade.id}
              className="flex flex-col gap-[7px] border-b border-hairline px-3 py-2.5"
            >
              <div className="flex items-center gap-[7px]">
                <button
                  type="button"
                  onClick={() => onEdit(trade)}
                  className="cursor-pointer font-mono text-[13px] font-semibold hover:text-accent"
                  title="Edit this trade"
                >
                  {trade.symbol}
                </button>
                <span
                  className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.1em] ${
                    long ? "bg-up-bg text-up" : "bg-down-bg text-down"
                  }`}
                >
                  {trade.direction}
                </span>
                <span className="font-mono text-[10px] text-muted-2 tnum">
                  {qty}
                  {qty !== trade.quantity && (
                    <span className="text-muted-4">/{trade.quantity}</span>
                  )}
                </span>

                <div className="flex-1" />

                <div className="flex flex-col items-end">
                  <span
                    className={`font-mono text-[13px] leading-tight font-semibold tnum ${pnlTone}`}
                  >
                    {mark === undefined ? "—" : money(pnl)}
                  </span>
                  <span className={`font-mono text-[10px] tnum ${pnlTone}`}>
                    {pct === null ? "—" : percent(pct)}
                    {r !== null && ` · ${rMultiple(r)}`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
                <span>
                  AVG <span className="text-ink-soft tnum">{price(trade.entryPrice)}</span>
                </span>
                <span>
                  LAST{" "}
                  <span className="text-ink-soft tnum">
                    {mark === undefined ? "—" : price(mark)}
                  </span>
                </span>
                <span>
                  STOP{" "}
                  <span className="text-down tnum">
                    {trade.stop === null ? "—" : price(trade.stop)}
                  </span>
                </span>
                <span>
                  TGT{" "}
                  <span className="text-up tnum">
                    {trade.target === null ? "—" : price(trade.target)}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative h-1 flex-1 overflow-hidden rounded-sm bg-track">
                  {progress !== null && entryProgress !== null && (
                    <div
                      className={`absolute top-0 bottom-0 rounded-sm ${pnlBar}`}
                      style={{
                        left: `${Math.min(entryProgress, progress) * 100}%`,
                        width: `${Math.abs(progress - entryProgress) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <span className="min-w-[62px] text-right font-mono text-[9px] text-muted-3 tnum">
                  {progress === null
                    ? "no levels"
                    : `${(progress * 100).toFixed(0)}% to tgt`}
                </span>
                <DeskButton
                  onClick={() => onTrim(trade)}
                  title="Record a partial exit"
                  disabled={qty < 2}
                >
                  TRIM ½
                </DeskButton>
                <DeskButton
                  variant="danger"
                  onClick={() => onClose(trade)}
                  title="Record the closing fill"
                >
                  CLOSE
                </DeskButton>
              </div>
            </div>
          );
        })}

        {open.length === 0 && (
          <div className="px-4 py-[30px] text-center font-mono text-[11px] text-muted-4">
            FLAT · NO OPEN RISK
            <br />
            <button
              type="button"
              onClick={onAdd}
              className="mt-3 cursor-pointer text-accent underline-offset-2 hover:underline"
            >
              LOG A TRADE
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-none items-center justify-between border-t border-edge bg-sunken px-3 py-2 font-mono text-[10px] text-muted">
        <span>
          EXPOSURE <span className="text-ink tnum">{dollars(openExposure)}</span>
        </span>
        <span>
          RISK ON <span className="text-down-bright tnum">{dollars(openRisk)}</span>
        </span>
        <span>
          AVAILABLE <span className="text-ink tnum">{dollars(buyingPower)}</span>
        </span>
      </div>
    </Panel>
  );
}
