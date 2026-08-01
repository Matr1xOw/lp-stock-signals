"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SETTINGS,
  type JournalState,
  type Settings,
  type Trade,
  type TradeExit,
} from "./types";
import { openQuantity } from "./stats";

/**
 * Journal persistence.
 *
 * The journal holds trades the user actually took, so losing it is a real
 * loss — unlike a paper-trading toy, it cannot be regenerated. It lives in
 * localStorage (no account, no server, nothing to leak), which makes export
 * and import first-class rather than a nicety: they are the only backup and
 * the only way to move the journal between machines.
 *
 * It is modelled as an external store rather than component state, because
 * that is what it actually is — durable state owned by the browser, which
 * React subscribes to. Three things fall out of that framing for free:
 * `useSyncExternalStore` handles the server/client snapshot split without a
 * hydration mismatch, two tabs open on the desk stay in sync through the
 * `storage` event, and any component can read the journal without prop
 * drilling.
 */

const STORAGE_KEY = "signal-desk.journal";
const VERSION = 1;

const EMPTY: JournalState = {
  version: VERSION,
  trades: [],
  settings: DEFAULT_SETTINGS,
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Validates and normalises whatever was in storage.
 *
 * Anything unreadable falls back to an empty journal rather than throwing —
 * a corrupt entry should not leave the user staring at a broken page with no
 * way to reach the export button.
 */
export function parseJournal(raw: string): JournalState {
  try {
    const data = JSON.parse(raw) as Partial<JournalState>;
    if (!data || !Array.isArray(data.trades)) return EMPTY;

    const trades = data.trades.filter(
      (t): t is Trade =>
        typeof t?.id === "string" &&
        typeof t.symbol === "string" &&
        (t.direction === "LONG" || t.direction === "SHORT") &&
        Number.isFinite(t.quantity) &&
        Number.isFinite(t.entryPrice),
    );

    return {
      version: VERSION,
      trades: trades.map((t) => ({ ...t, exits: t.exits ?? [] })),
      settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
    };
  } catch {
    return EMPTY;
  }
}

// --- Store ----------------------------------------------------------------

let snapshot: JournalState | null = null;
const listeners = new Set<() => void>();

function read(): JournalState {
  if (snapshot !== null) return snapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    snapshot = raw ? parseJournal(raw) : EMPTY;
  } catch {
    // Storage can be disabled entirely; fall back to an in-memory journal.
    snapshot = EMPTY;
  }
  return snapshot;
}

function write(next: JournalState) {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exhausted or storage disabled. The session keeps working from
    // memory, and export is still available to rescue the data.
  }
  for (const listener of listeners) listener();
}

function update(change: (state: JournalState) => JournalState) {
  write(change(read()));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab writing the journal invalidates our cached snapshot.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = event.newValue ? parseJournal(event.newValue) : EMPTY;
    for (const l of listeners) l();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The server has no localStorage, so it always renders an empty journal. */
const serverSnapshot = () => EMPTY;

// --- Hook -----------------------------------------------------------------

export type Journal = {
  state: JournalState;
  addTrade: (trade: Omit<Trade, "id" | "exits">) => void;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  removeTrade: (id: string) => void;
  /** Records an exit; omitting `quantity` closes the whole open position. */
  closeTrade: (
    id: string,
    price: number,
    quantity?: number,
    note?: string,
  ) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Serialised journal, for download. */
  exportJson: () => string;
  /** Replaces the journal from a previously exported file. */
  importJson: (raw: string) => boolean;
  clear: () => void;
};

export function useJournal(): Journal {
  const state = useSyncExternalStore(subscribe, read, serverSnapshot);

  const addTrade = useCallback((trade: Omit<Trade, "id" | "exits">) => {
    update((s) => ({
      ...s,
      trades: [{ ...trade, id: newId(), exits: [] }, ...s.trades],
    }));
  }, []);

  const updateTrade = useCallback((id: string, patch: Partial<Trade>) => {
    update((s) => ({
      ...s,
      trades: s.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const removeTrade = useCallback((id: string) => {
    update((s) => ({ ...s, trades: s.trades.filter((t) => t.id !== id) }));
  }, []);

  const closeTrade = useCallback(
    (id: string, price: number, quantity?: number, note?: string) => {
      update((s) => ({
        ...s,
        trades: s.trades.map((trade) => {
          if (trade.id !== id) return trade;

          const open = openQuantity(trade);
          // Never let an exit close more than is actually open — that would
          // silently invent a position and corrupt every downstream stat.
          const qty = Math.min(quantity ?? open, open);
          if (qty <= 0) return trade;

          const exit: TradeExit = {
            id: newId(),
            quantity: qty,
            price,
            at: Date.now(),
            note,
          };
          return { ...trade, exits: [...trade.exits, exit] };
        }),
      }));
    },
    [],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const exportJson = useCallback(() => JSON.stringify(read(), null, 2), []);

  const importJson = useCallback((raw: string) => {
    const parsed = parseJournal(raw);
    // An import that yields nothing is almost certainly a wrong or damaged
    // file; refuse it rather than wiping a working journal.
    if (parsed.trades.length === 0) return false;
    write(parsed);
    return true;
  }, []);

  const clear = useCallback(() => write(EMPTY), []);

  return {
    state,
    addTrade,
    updateTrade,
    removeTrade,
    closeTrade,
    updateSettings,
    exportJson,
    importJson,
    clear,
  };
}
