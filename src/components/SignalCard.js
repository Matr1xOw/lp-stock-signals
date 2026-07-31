"use client";

import { formatTime } from "@/lib/utils";

export default function SignalCard({ signal }) {
  const isLong = signal.direction === "LONG";
  const spread = Math.abs(signal.tp - signal.entry);
  const totalRange = Math.abs(signal.tp - signal.sl);
  const tpPct = (spread / totalRange) * 100;

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e8eaed",
      borderRadius: 10,
      padding: "16px 18px",
      marginBottom: 10,
      borderLeft: `3px solid ${isLong ? "#16a34a" : "#dc2626"}`,
      opacity: signal.status === "expired" ? 0.55 : 1,
      transition: "box-shadow 0.15s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 16,
            fontWeight: 700,
            color: "#111827",
          }}>{signal.ticker}</span>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: isLong ? "#dcfce7" : "#fee2e2",
            color: isLong ? "#15803d" : "#dc2626",
            letterSpacing: "0.3px",
          }}>{signal.direction}</span>
          {signal.status === "expired" && (
            <span style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic" }}>expired</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{formatTime(signal.timestamp)}</span>
      </div>

      {/* Indicator badges */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: signal.validated ? "#15803d" : "#b45309",
          background: signal.validated ? "#f0fdf4" : "#fffbeb",
          padding: "2px 7px",
          borderRadius: 3,
          border: signal.validated ? "1px solid #bbf7d0" : "1px solid #fde68a",
        }}>
          {signal.research}{!signal.validated && ` (unvalidated${signal.checkpoint ? ` — ${signal.checkpoint}` : ""})`}
        </span>
        {Object.entries(signal.indicators).map(([k, v]) => (
          <span key={k} style={{
            fontSize: 10,
            fontFamily: "monospace",
            color: "#6b7280",
            background: "#f3f4f6",
            padding: "2px 7px",
            borderRadius: 3,
          }}>
            {k === "adx1h" ? "ADX₁ₕ" : k === "spyr" ? "SPYr" : "Dip"} {typeof v === "number" && v > 0 && k === "dip" ? "+" : ""}{v}{k === "dip" ? "%" : ""}
          </span>
        ))}
      </div>

      {/* Price levels */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 8,
        marginBottom: 12,
      }}>
        {[
          { label: "Entry", value: signal.entry, color: "#111827", icon: "▲" },
          { label: "Stop Loss", value: signal.sl, color: "#dc2626", icon: "✕" },
          { label: "Take Profit", value: signal.tp, color: "#16a34a", icon: "◎" },
          { label: "Risk", value: `${signal.risk}%`, color: "#d97706", icon: null },
        ].map(({ label, value, color, icon }) => (
          <div key={label}>
            <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
            <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color }}>
              {icon && <span style={{ fontSize: 9, marginRight: 3 }}>{icon}</span>}
              {typeof value === "number" ? value.toFixed(2) : value}
            </div>
          </div>
        ))}
      </div>

      {/* Risk/reward bar */}
      <div style={{ position: "relative", height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          left: isLong ? 0 : `${tpPct}%`,
          width: `${isLong ? tpPct : 100 - tpPct}%`,
          height: "100%",
          borderRadius: 3,
          background: `linear-gradient(90deg, ${isLong ? "#fca5a5" : "#86efac"}, ${isLong ? "#86efac" : "#fca5a5"})`,
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 9, color: "#9ca3af" }}>SL {signal.sl}</span>
        <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 600 }}>{signal.rr}R</span>
        <span style={{ fontSize: 9, color: "#9ca3af" }}>TP {signal.tp}</span>
      </div>
    </div>
  );
}
