"use client";

import { useState } from "react";
import { money, price as fmtPrice } from "@/lib/format";
import { openQuantity } from "@/lib/journal/stats";
import type { Trade } from "@/lib/journal/types";
import { Dialog, DialogButton, Field, TextInput } from "./dialog";

/**
 * Records a closing or partial fill.
 *
 * The exit price defaults to the last trade but is editable, for the same
 * reason entries are: the journal must hold what happened, not what the
 * screen said at the time.
 */
export function ExitDialog({
  trade,
  mark,
  half,
  onConfirm,
  onClose,
}: {
  trade: Trade;
  mark: number | undefined;
  /** Pre-fill half the open quantity, for the TRIM action. */
  half: boolean;
  onConfirm: (price: number, quantity: number, note: string) => void;
  onClose: () => void;
}) {
  const open = openQuantity(trade);
  const defaultQty = half ? Math.max(1, Math.floor(open / 2)) : open;

  // `null` means "not typed in yet", so the field follows the live price
  // until the user overrides it. Seeding state from `mark` directly would
  // freeze an empty field whenever the dialog opens before quotes arrive.
  const [typedPrice, setTypedPrice] = useState<string | null>(null);
  const exitPrice = typedPrice ?? (mark !== undefined ? mark.toFixed(2) : "");

  const [quantity, setQuantity] = useState(String(defaultQty));
  const [note, setNote] = useState("");

  const priceValue = Number(exitPrice);
  const qtyValue = Number(quantity);

  const valid =
    Number.isFinite(priceValue) &&
    priceValue > 0 &&
    Number.isFinite(qtyValue) &&
    qtyValue > 0 &&
    qtyValue <= open;

  const sign = trade.direction === "LONG" ? 1 : -1;
  const pnl = valid
    ? (priceValue - trade.entryPrice) * qtyValue * sign
    : null;

  return (
    <Dialog
      title={half ? "TRIM POSITION" : "CLOSE POSITION"}
      subtitle={`${trade.symbol} ${trade.direction} · ${open} open at ${fmtPrice(trade.entryPrice)}`}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onConfirm(priceValue, qtyValue, note);
            onClose();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="EXIT PRICE"
            hint={
              mark === undefined
                ? "no live quote — enter your fill"
                : "the fill you got"
            }
          >
            <TextInput
              value={exitPrice}
              onChange={(e) => setTypedPrice(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0.00"
            />
          </Field>
          <Field label="QUANTITY" hint={`${open} available`}>
            <TextInput
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>

        <Field label="NOTE">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why you exited"
          />
        </Field>

        {pnl !== null && (
          <div className="rounded-[3px] border border-edge bg-inset px-3 py-2 font-mono text-[10px] text-muted">
            REALISED ON THIS FILL{" "}
            <span className={`tnum ${pnl >= 0 ? "text-up" : "text-down"}`}>
              {money(pnl)}
            </span>
            <span className="text-muted-4"> · before fees</span>
          </div>
        )}

        {qtyValue > open && (
          <div className="rounded-[3px] border border-down-edge bg-down-bg/40 px-3 py-2 font-mono text-[10px] text-down-bright">
            Only {open} still open.
          </div>
        )}

        <div className="mt-1 flex gap-2">
          <DialogButton variant="ghost" onClick={onClose}>
            CANCEL
          </DialogButton>
          <DialogButton type="submit" disabled={!valid}>
            RECORD EXIT
          </DialogButton>
        </div>
      </form>
    </Dialog>
  );
}
