"use client";

import { useRef, useState } from "react";
import type { Settings } from "@/lib/journal/types";
import { Dialog, DialogButton, Field, TextInput } from "./dialog";

/**
 * Account settings, plus export and import.
 *
 * Export is prominent here on purpose: the journal lives in this browser's
 * localStorage and nowhere else, so the exported file is the only backup that
 * exists. Clearing site data would otherwise take real trade history with it.
 */
export function SettingsDialog({
  settings,
  tradeCount,
  onSave,
  onExport,
  onImport,
  onClearAll,
  onClose,
}: {
  settings: Settings;
  tradeCount: number;
  onSave: (patch: Partial<Settings>) => void;
  onExport: () => string;
  onImport: (raw: string) => boolean;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [capital, setCapital] = useState(String(settings.startingCapital));
  const [risk, setRisk] = useState(String(settings.riskPerTrade));
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([onExport()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `signal-desk-journal-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Exported.");
  };

  const upload = async (file: File) => {
    const ok = onImport(await file.text());
    setStatus(ok ? "Journal imported." : "That file held no readable trades.");
  };

  const save = () => {
    const startingCapital = Number(capital);
    const riskPerTrade = Number(risk);
    onSave({
      ...(Number.isFinite(startingCapital) && startingCapital > 0
        ? { startingCapital }
        : {}),
      ...(Number.isFinite(riskPerTrade) && riskPerTrade > 0
        ? { riskPerTrade }
        : {}),
    });
    onClose();
  };

  return (
    <Dialog
      title="JOURNAL"
      subtitle={`${tradeCount} trade${tradeCount === 1 ? "" : "s"} recorded`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Field label="ACCOUNT SIZE" hint="used for equity and portfolio heat">
          <TextInput
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            inputMode="decimal"
          />
        </Field>

        <Field label="RISK PER TRADE" hint="sizes the suggestion on a signal">
          <TextInput
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            inputMode="decimal"
          />
        </Field>

        <div className="mt-1 border-t border-hairline pt-3">
          <p className="mb-2 font-mono text-[10px] leading-relaxed text-muted-3">
            Your journal is stored only in this browser. Export it to keep a
            backup or move it to another machine.
          </p>
          <div className="flex gap-2">
            <DialogButton variant="ghost" onClick={download}>
              EXPORT
            </DialogButton>
            <DialogButton
              variant="ghost"
              onClick={() => fileInput.current?.click()}
            >
              IMPORT
            </DialogButton>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>

        {status && (
          <div className="rounded-[3px] border border-edge bg-inset px-3 py-2 font-mono text-[10px] text-ink-dim">
            {status}
          </div>
        )}

        <div className="border-t border-hairline pt-3">
          {confirmingClear ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] text-down-bright">
                Delete all {tradeCount} trades? This cannot be undone.
              </span>
              <div className="flex gap-2">
                <DialogButton
                  variant="ghost"
                  onClick={() => setConfirmingClear(false)}
                >
                  KEEP
                </DialogButton>
                <DialogButton
                  variant="danger"
                  onClick={() => {
                    onClearAll();
                    setConfirmingClear(false);
                    setStatus("Journal cleared.");
                  }}
                >
                  DELETE ALL
                </DialogButton>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="cursor-pointer font-mono text-[10px] tracking-[0.1em] text-muted-4 transition hover:text-down"
            >
              CLEAR JOURNAL
            </button>
          )}
        </div>

        <div className="mt-1 flex gap-2">
          <DialogButton variant="ghost" onClick={onClose}>
            CANCEL
          </DialogButton>
          <DialogButton onClick={save}>SAVE</DialogButton>
        </div>
      </div>
    </Dialog>
  );
}
