import type { ExecutionNotice } from "@/lib/signals/execution";

/**
 * The closed-market notifier, in its two sizes.
 *
 * Deliberately quiet. While the exchange is shut this appears on every signal
 * at once, so anything louder than a tinted line would turn the whole list
 * into a warning and stop being read by the second card.
 */

/** One line on a signal card. */
export function ClosedBadge({ notice }: { notice: ExecutionNotice }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-[3px] border border-amber/25 bg-amber/8 px-2 py-[3px]"
      title={notice.detail}
    >
      <span className="font-mono text-[9px] text-amber">◷</span>
      <span className="font-mono text-[9px] tracking-[0.08em] text-amber">
        {notice.badge}
      </span>
      {notice.atMarket && (
        <span className="truncate font-mono text-[9px] text-muted-3">
          fills on the open
        </span>
      )}
    </div>
  );
}

/** The fuller statement under the chart. */
export function ClosedNote({ notice }: { notice: ExecutionNotice }) {
  return (
    <div className="flex items-center gap-2 border-t border-hairline bg-amber/6 px-3.5 py-2">
      <span className="font-mono text-[10px] text-amber">◷</span>
      <span className="font-mono text-[9px] tracking-[0.14em] whitespace-nowrap text-amber">
        {notice.badge}
      </span>
      <span className="text-[11px] text-muted">{notice.detail}</span>
    </div>
  );
}
