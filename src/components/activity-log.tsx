"use client";

import { useMounted } from "@/lib/hooks";
import { Panel } from "./panel";

/**
 * A running record of what the engine and the journal have done this session.
 *
 * Entries are not persisted: this is a view of the current session, not a
 * second copy of the journal. The journal is the durable record.
 */

export type LogTag = "SCAN" | "SIGNAL" | "ENTRY" | "EXIT" | "RISK" | "ERROR";

export type LogEntry = {
  id: string;
  at: number;
  tag: LogTag;
  text: string;
};

const TAG_STYLES: Record<LogTag, string> = {
  SCAN: "bg-track text-ink-dim",
  SIGNAL: "bg-accent-bg text-accent",
  ENTRY: "bg-accent-bg text-accent",
  EXIT: "bg-up-bg text-up",
  RISK: "bg-track text-amber",
  ERROR: "bg-down-bg text-down",
};

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const mounted = useMounted();

  return (
    <Panel
      title="ENGINE LOG"
      actions={
        <span className="font-mono text-[9px] tracking-[0.1em] text-up-dim">
          LIVE
        </span>
      }
      className="flex-[1_1_38%]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-baseline gap-2.5 px-3 py-[5px] font-mono text-[10.5px]"
          >
            <span className="flex-none text-muted-4 tnum">
              {mounted
                ? new Date(entry.at).toLocaleTimeString("en-US", {
                    hour12: false,
                    timeZone: "America/New_York",
                  })
                : "--:--:--"}
            </span>
            <span
              className={`flex-none rounded-[2px] px-[5px] py-px text-[9px] tracking-[0.08em] ${TAG_STYLES[entry.tag]}`}
            >
              {entry.tag}
            </span>
            <span className="leading-[1.45] text-ink-log">{entry.text}</span>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="px-4 py-6 text-center font-mono text-[11px] text-muted-4">
            WAITING FOR FIRST SCAN
          </div>
        )}
      </div>
    </Panel>
  );
}
