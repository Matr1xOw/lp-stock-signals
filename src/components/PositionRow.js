"use client";

export default function PositionRow({ pos }) {
  const isOpen = pos.status === "open";
  const isLong = pos.direction === "LONG";
  const exitPrice = isOpen ? pos.current : pos.close;
  const pnl = isLong ? (exitPrice - pos.entry) * pos.shares : (pos.entry - exitPrice) * pos.shares;
  const pnlPct = isLong ? ((exitPrice - pos.entry) / pos.entry) * 100 : ((pos.entry - exitPrice) / pos.entry) * 100;
  const positive = pnl >= 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "80px 50px 70px 70px 90px 70px",
      alignItems: "center",
      padding: "10px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#f0f0f0" }}>{pos.ticker}</span>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: isLong ? "#4ade80" : "#f87171" }}>
        {pos.direction}
      </span>
      <span style={{ fontFamily: "monospace", color: "#9ca3af" }}>${pos.entry.toFixed(2)}</span>
      <span style={{ fontFamily: "monospace", color: "#d1d5db" }}>${exitPrice.toFixed(2)}</span>
      <span style={{ fontFamily: "monospace", fontWeight: 600, color: positive ? "#4ade80" : "#f87171" }}>
        {positive ? "+" : ""}${pnl.toFixed(2)} ({positive ? "+" : ""}{pnlPct.toFixed(1)}%)
      </span>
      <span style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 3,
        background: isOpen ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.05)",
        color: isOpen ? "#60a5fa" : "#6b7280",
        textAlign: "center",
      }}>{isOpen ? "OPEN" : "CLOSED"}</span>
    </div>
  );
}
