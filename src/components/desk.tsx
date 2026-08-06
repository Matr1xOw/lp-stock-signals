"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityLog, type LogEntry, type LogTag } from "./activity-log";
import { Chart } from "./chart";
import { ExitDialog } from "./exit-dialog";
import { Header } from "./header";
import { Metrics } from "./metrics";
import { Positions } from "./positions";
import { SettingsDialog } from "./settings-dialog";
import { SignalDetail } from "./signal-detail";
import { SignalList, type SignalSort } from "./signal-list";
import { TradeDialog, type TradeDraft } from "./trade-dialog";
import { money, price as fmtPrice } from "@/lib/format";
import {
  useCandles,
  useQuotes,
  useRotatingPass,
  useScan,
  useSession,
} from "@/lib/hooks";
import {
  type Book,
  EMPTY_BOOK,
  mergeScan,
  sweepPeriodMs,
} from "@/lib/signals/book";
import { isOpen, performance as summarise } from "@/lib/journal/stats";
import { useJournal } from "@/lib/journal/store";
import type { Trade } from "@/lib/journal/types";
import type { Timeframe } from "@/lib/market/types";
import type { ScanResult, Signal } from "@/lib/signals/types";

/**
 * The desk: signals on the left, chart in the middle, journal on the right.
 *
 * All cross-panel state lives here — which signal is selected, which
 * timeframe is showing, what the journal holds — while the panels below stay
 * presentational. There is not enough state to justify a store, and keeping
 * it in one component makes the data flow readable top to bottom.
 */

const SCAN_INTERVAL_MS = 60_000;
/**
 * Polls spent on a slice before moving to the next.
 *
 * Every symbol gets looked at without anyone clicking anything, which is the
 * point — but rotating on every poll would mean each scan is mostly cache
 * misses, roughly 2.5× the upstream request rate. Yahoo's endpoints are free
 * but throttle hard, and a 429'd scan helps nobody. Two polls per slice keeps
 * the traffic near where it already was.
 */
const POLLS_PER_SLICE = 2;
const MAX_LOG_ENTRIES = 60;

export function Desk() {
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>("15m");
  const [sort, setSort] = useState<SignalSort>("confidence");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);

  const [tradeDraft, setTradeDraft] = useState<TradeDraft | null>(null);
  const [exiting, setExiting] = useState<{ trade: Trade; half: boolean } | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The scan sweeps one slice at a time and the book accumulates across them,
  // so the list is everything standing in the whole universe rather than
  // whatever happened to be in the last response.
  const { pass, advance } = useRotatingPass(SCAN_INTERVAL_MS * POLLS_PER_SLICE);
  const [book, setBook] = useState<Book>(EMPTY_BOOK);

  const journal = useJournal();

  // The header's light and the per-signal notifiers have to come from the
  // same clock. Reading it from the scan would let the two disagree for up to
  // a minute either side of the bell.
  const { session } = useSession();

  const addLog = useCallback((tag: LogTag, text: string) => {
    setLog((entries) =>
      [
        { id: `${Date.now()}-${Math.random()}`, at: Date.now(), tag, text },
        ...entries,
      ].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  // Logged from the fetch callback rather than an effect on the result, so
  // one completed scan produces one log burst instead of a second render
  // pass reacting to the first.
  // Signals already announced, so a slice being re-polled does not re-log the
  // same three every minute. Cleared with the book on a timeframe change.
  const announced = useRef<Set<string>>(new Set());

  const onScanned = useCallback(
    (result: ScanResult) => {
      setBook((current) => mergeScan(current, result, Date.now()));

      addLog(
        "SCAN",
        `slice ${(result.pass % result.passes) + 1}/${result.passes} · ${result.scanned} symbols · ${result.signals.length} signal${
          result.signals.length === 1 ? "" : "s"
        } · ${result.durationMs}ms`,
      );

      // Only what is actually new is worth a line.
      const fresh = result.signals.filter((s) => !announced.current.has(s.id));
      for (const signal of result.signals) announced.current.add(signal.id);
      for (const signal of fresh.slice(0, 3)) {
        addLog(
          "SIGNAL",
          `${signal.symbol} ${signal.pattern.toLowerCase()} — ${signal.direction.toLowerCase()} at ${fmtPrice(signal.entry)}, ${signal.rr.toFixed(1)}R`,
        );
      }
    },
    [addLog],
  );

  const scan = useScan(timeframe, pass, SCAN_INTERVAL_MS, onScanned);

  const entries = useMemo(
    () => book.entries.filter((e) => !dismissed.has(e.signal.id)),
    [book, dismissed],
  );

  const sweepMs = sweepPeriodMs(
    scan.data?.passes ?? 1,
    SCAN_INTERVAL_MS * POLLS_PER_SLICE,
  );

  // Keeps a selection alive across rescans and falls back to the best signal.
  // Derived rather than synced into state: writing the fallback back into
  // `selectedId` would be a render triggering a render for no added meaning.
  const selected = useMemo(
    () =>
      entries.find((e) => e.signal.id === selectedId)?.signal ??
      entries[0]?.signal ??
      null,
    [entries, selectedId],
  );

  // The chart follows the scan's timeframe until the user picks another.
  const chartSymbol = selected?.symbol ?? null;
  const candles = useCandles(chartSymbol, chartTimeframe);

  // Open trades are marked against live quotes.
  const openSymbols = useMemo(
    () => journal.state.trades.filter(isOpen).map((t) => t.symbol),
    [journal.state.trades],
  );
  const { prices } = useQuotes(openSymbols);

  const stats = useMemo(
    () => summarise(journal.state.trades, prices),
    [journal.state.trades, prices],
  );

  // Surface a newly-appeared fetch error in the log, once per occurrence.
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (scan.error === lastError.current) return;
    const previous = lastError.current;
    lastError.current = scan.error;
    if (scan.error && scan.error !== previous) addLog("ERROR", scan.error);
  }, [scan.error, addLog]);

  const onTimeframe = (next: Timeframe) => {
    setChartTimeframe(next);
    setTimeframe(next);
    // A book of 15m signals says nothing about the 1h chart, and its entries
    // would otherwise linger until each symbol had been swept twice.
    setBook(EMPTY_BOOK);
    announced.current = new Set();
  };

  const onDismiss = (id: string) => {
    const signal = entries.find((e) => e.signal.id === id)?.signal;
    setDismissed((current) => new Set(current).add(id));
    if (signal) addLog("RISK", `${signal.symbol} signal dismissed`);
  };

  const onSaveTrade = (
    draft: Omit<Trade, "id" | "exits">,
    id?: string,
  ) => {
    if (id) {
      journal.updateTrade(id, draft);
      addLog("ENTRY", `${draft.symbol} trade updated`);
      return;
    }
    journal.addTrade(draft);
    addLog(
      "ENTRY",
      `${draft.symbol} ${draft.direction.toLowerCase()} ${draft.quantity} at ${fmtPrice(draft.entryPrice)}`,
    );
    // A signal that has been acted on should leave the live list.
    if (draft.source) {
      setDismissed((current) => new Set(current).add(draft.source!.signalId));
    }
  };

  const onRecordExit = (
    trade: Trade,
    exitPrice: number,
    quantity: number,
    note: string,
  ) => {
    journal.closeTrade(trade.id, exitPrice, quantity, note);
    const sign = trade.direction === "LONG" ? 1 : -1;
    const pnl = (exitPrice - trade.entryPrice) * quantity * sign;
    addLog(
      "EXIT",
      `${trade.symbol} ${quantity} at ${fmtPrice(exitPrice)} · ${money(pnl)}`,
    );
  };

  const equity = journal.state.settings.startingCapital + stats.total;
  const buyingPower = Math.max(0, equity - stats.openExposure);

  return (
    // A trading desk is a fixed viewport whose panels scroll inside it, not a
    // page that scrolls as a whole. Below xl the three columns stack, so the
    // page scrolls normally at those widths instead.
    <div className="flex min-h-screen w-full flex-col gap-2.5 px-3 pt-2.5 pb-3 xl:h-screen xl:min-h-0 xl:overflow-hidden">
      <Header
        marketOpen={session?.open ?? scan.data?.marketOpen ?? false}
        scannedAt={scan.data?.scannedAt ?? null}
        scanned={book.covered.length}
        universeSize={scan.data?.universeSize ?? 0}
        equity={equity}
        dayPnl={stats.unrealised}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Metrics
        performance={stats}
        startingCapital={journal.state.settings.startingCapital}
      />

      <div className="grid min-h-[620px] flex-1 grid-cols-1 gap-2.5 xl:min-h-0 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,1.32fr)_minmax(0,0.92fr)]">
        <SignalList
          entries={entries}
          selectedId={selected?.id ?? null}
          sort={sort}
          sweepMs={sweepMs}
          loading={scan.loading && book.entries.length === 0}
          error={scan.error}
          riskPerTrade={journal.state.settings.riskPerTrade}
          accountSize={equity}
          onSelect={setSelectedId}
          onSort={setSort}
          onTake={(signal: Signal) => setTradeDraft({ signal })}
          onDismiss={onDismiss}
          onRescan={advance}
        />

        <section className="flex min-h-0 flex-col gap-2.5">
          <Chart
            series={candles.data}
            signal={selected}
            timeframe={chartTimeframe}
            loading={candles.loading && !candles.data}
            onTimeframe={onTimeframe}
          />
          <SignalDetail
            signal={selected}
            riskPerTrade={journal.state.settings.riskPerTrade}
            accountSize={equity}
            onTake={(signal) => setTradeDraft({ signal })}
            onDismiss={onDismiss}
          />
        </section>

        <section className="flex min-h-0 flex-col gap-2.5">
          <Positions
            trades={journal.state.trades}
            prices={prices}
            openExposure={stats.openExposure}
            openRisk={stats.openRisk}
            buyingPower={buyingPower}
            onAdd={() => setTradeDraft({})}
            onEdit={(trade) => setTradeDraft({ trade })}
            onClose={(trade) => setExiting({ trade, half: false })}
            onTrim={(trade) => setExiting({ trade, half: true })}
          />
          <ActivityLog entries={log} />
        </section>
      </div>

      {tradeDraft && (
        <TradeDialog
          draft={tradeDraft}
          riskPerTrade={journal.state.settings.riskPerTrade}
          accountSize={equity}
          onSave={onSaveTrade}
          onDelete={journal.removeTrade}
          onClose={() => setTradeDraft(null)}
        />
      )}

      {exiting && (
        <ExitDialog
          trade={exiting.trade}
          mark={prices[exiting.trade.symbol]}
          half={exiting.half}
          onConfirm={(exitPrice, quantity, note) =>
            onRecordExit(exiting.trade, exitPrice, quantity, note)
          }
          onClose={() => setExiting(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={journal.state.settings}
          tradeCount={journal.state.trades.length}
          onSave={journal.updateSettings}
          onExport={journal.exportJson}
          onImport={journal.importJson}
          onClearAll={journal.clear}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
