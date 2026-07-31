export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function calcPnl(position) {
  const isOpen = position.status === "open";
  const isLong = position.direction === "LONG";
  const exitPrice = isOpen ? position.current : position.close;
  const pnl = isLong
    ? (exitPrice - position.entry) * position.shares
    : (position.entry - exitPrice) * position.shares;
  const pnlPct = isLong
    ? ((exitPrice - position.entry) / position.entry) * 100
    : ((position.entry - exitPrice) / position.entry) * 100;
  return { pnl, pnlPct };
}
