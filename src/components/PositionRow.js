"use client";

export default function PositionRow({ pos }) {
  const isOpen = pos.status === "open";
  const isLong = pos.direction === "LONG";
  const exitPrice = isOpen ? pos.current : pos.close;
  const pnl = isLong ? (exitPrice - pos.entry) * pos.shares : (pos.entry - exitPrice) * pos.shares;
  const pnlPct = isLong ? ((exitPrice - pos.entry) / pos.entry) * 100 : ((pos.entry - exitPrice) / pos.entry) * 100;
  const positive = pnl >= 0;

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: "#111827" }}>
        {pos.ticker}
      </td>
      <td style={{ padding: "10px 8px" }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 3,
          background: isLong ? "#dcfce7" : "#fee2e2",
          color: isLong ? "#15803d" : "#dc2626",
        }}>{pos.direction}</span>
      </td>
      <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 13, color: "#6b7280" }}>
        ${pos.entry.toFixed(2)}
      </td>
      <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 13, color: "#374151" }}>
        ${exitPrice.toFixed(2)}
      </td>
      <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: positive ? "#16a34a" : "#dc2626" }}>
        {positive ? "+" : ""}${pnl.toFixed(2)}
      </td>
      <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 11, color: positive ? "#16a34a" : "#dc2626" }}>
        {positive ? "+" : ""}{pnlPct.toFixed(1)}%
      </td>
      <td style={{ padding: "10px 8px" }}>
        <span style={{
          fontSize: 10,
          padding: "2px 8px",
          borderRadius: 10,
          background: isOpen ? "#eff6ff" : "#f9fafb",
          color: isOpen ? "#2563eb" : "#9ca3af",
          border: isOpen ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
          fontWeight: 500,
        }}>{isOpen ? "Open" : "Closed"}</span>
      </td>
    </tr>
  );
}
