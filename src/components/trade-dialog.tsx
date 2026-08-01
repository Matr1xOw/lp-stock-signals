"use client";

import { useState } from "react";
import { dollars } from "@/lib/format";
import { suggestedSize } from "@/lib/journal/stats";
import type { Trade, TradeDirection } from "@/lib/journal/types";
import type { Signal } from "@/lib/signals/types";
import { Dialog, DialogButton, Field, Select, TextInput } from "./dialog";

/**
 * Records a trade that was actually taken.
 *
 * When opened from a signal the fields are pre-filled from it, but every one
 * of them stays editable — the price you actually got is rarely the price the
 * engine suggested, and a journal that records the plan instead of the fill
 * would quietly corrupt every statistic built on it.
 */

export type TradeDraft = {
  trade?: Trade;
  signal?: Signal;
};

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `datetime-local` wants local wall-clock, not an ISO instant. */
function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 16);
}

export function TradeDialog({
  draft,
  riskPerTrade,
  accountSize,
  onSave,
  onDelete,
  onClose,
}: {
  draft: TradeDraft;
  riskPerTrade: number;
  accountSize: number;
  onSave: (trade: Omit<Trade, "id" | "exits">, id?: string) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const { trade, signal } = draft;
  const editing = trade !== undefined;

  const [symbol, setSymbol] = useState(
    trade?.symbol ?? signal?.symbol ?? "",
  );
  const [direction, setDirection] = useState<TradeDirection>(
    trade?.direction ?? signal?.direction ?? "LONG",
  );
  const [quantity, setQuantity] = useState(
    String(
      trade?.quantity ??
        (signal
          ? suggestedSize(signal.entry, signal.stop, riskPerTrade, accountSize)
          : ""),
    ),
  );
  const [entryPrice, setEntryPrice] = useState(
    String(trade?.entryPrice ?? signal?.entry.toFixed(2) ?? ""),
  );
  // Lazy initialiser: `Date.now()` must not be called during render.
  const [entryAt, setEntryAt] = useState(() =>
    toLocalInput(trade?.entryAt ?? Date.now()),
  );
  const [stop, setStop] = useState(
    trade?.stop !== undefined && trade.stop !== null
      ? String(trade.stop)
      : (signal?.stop.toFixed(2) ?? ""),
  );
  const [target, setTarget] = useState(
    trade?.target !== undefined && trade.target !== null
      ? String(trade.target)
      : (signal?.target.toFixed(2) ?? ""),
  );
  const [fees, setFees] = useState(String(trade?.fees ?? 0));
  const [note, setNote] = useState(trade?.note ?? "");

  const qty = toNumber(quantity);
  const entry = toNumber(entryPrice);
  const stopValue = toNumber(stop);

  const valid =
    symbol.trim().length > 0 &&
    qty !== null &&
    qty > 0 &&
    entry !== null &&
    entry > 0;

  const riskDollars =
    entry !== null && stopValue !== null && qty !== null
      ? Math.abs(entry - stopValue) * qty
      : null;

  const submit = () => {
    if (!valid) return;
    onSave(
      {
        symbol: symbol.trim().toUpperCase(),
        name: trade?.name ?? signal?.name,
        direction,
        quantity: qty,
        entryPrice: entry,
        entryAt: new Date(entryAt).getTime() || Date.now(),
        stop: stopValue,
        target: toNumber(target),
        fees: toNumber(fees) ?? 0,
        note,
        source:
          trade?.source ??
          (signal
            ? {
                signalId: signal.id,
                pattern: signal.pattern,
                timeframe: signal.timeframe,
                confidence: signal.confidence,
              }
            : undefined),
      },
      trade?.id,
    );
    onClose();
  };

  return (
    <Dialog
      title={editing ? "EDIT TRADE" : "LOG TRADE"}
      subtitle={
        signal
          ? `from ${signal.pattern} · ${signal.timeframe} · confidence ${signal.confidence}`
          : "a trade you actually took"
      }
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="SYMBOL">
            <TextInput
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="NVDA"
              autoFocus={!editing}
            />
          </Field>
          <Field label="DIRECTION">
            <Select
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as TradeDirection)
              }
            >
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="QUANTITY">
            <TextInput
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="100"
            />
          </Field>
          <Field label="FILL PRICE" hint="the price you actually got">
            <TextInput
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              inputMode="decimal"
              placeholder="178.42"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="STOP" hint="needed for R multiples">
            <TextInput
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </Field>
          <Field label="TARGET">
            <TextInput
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ENTERED AT">
            <TextInput
              type="datetime-local"
              value={entryAt}
              onChange={(e) => setEntryAt(e.target.value)}
            />
          </Field>
          <Field label="FEES">
            <TextInput
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="NOTE">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why you took it"
          />
        </Field>

        {riskDollars !== null && (
          <div className="rounded-[3px] border border-edge bg-inset px-3 py-2 font-mono text-[10px] text-muted">
            RISK AT STOP{" "}
            <span className="text-down-bright tnum">
              {dollars(riskDollars)}
            </span>
          </div>
        )}

        <div className="mt-1 flex gap-2">
          {editing && onDelete && (
            <DialogButton
              variant="danger"
              onClick={() => {
                onDelete(trade.id);
                onClose();
              }}
            >
              DELETE
            </DialogButton>
          )}
          <DialogButton variant="ghost" onClick={onClose}>
            CANCEL
          </DialogButton>
          <DialogButton type="submit" disabled={!valid}>
            {editing ? "SAVE" : "LOG TRADE"}
          </DialogButton>
        </div>
      </form>
    </Dialog>
  );
}
