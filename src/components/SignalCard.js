"use client";

import { formatTime } from "@/lib/utils";

export default function SignalCard({ signal }) {
  const isLong = signal.direction === "LONG";
  const spread = Math.abs(signal.tp - signal.entry);
  const totalRange = Math.abs(signal.tp - signal.sl);
  const tpPct = (spread / totalRange) * 100;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      padding: "18px 20px",
      marginBottom: 12,
      borderLeft: `3px solid ${isLong ? "#22c55e" : "#ef4444"}`,
      opacity: signal.status === "expired" ? 0.5 : 1,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 18,
            fontWeight: 700,
            color: "#f0f0f0",
            letterSpacing: "0.5px",
          }}>{signal.ticker}</span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: isLong ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            color: isLong ? "#4ade80" : "#f87171",
            letterSpacing: "0.5px",
          }}>{signal.direction}</span>
          {signal.status === "expired" && (
            <span style={{ fontSize: 10, color: "#6b7280", fontStyle: "italic" }}>expired</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{formatTime(signal.timestamp)}</span>
      </div>

      {/* Indicator badges */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: signal.validated ? "#4ade80" : "#f59e0b",
          background: signal.validated ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
          padding: "2px 7px",
          borderRadius: 3,
        }}>
          {signal.research}{!signal.validated && ` (unvalidated${signal.checkpoint ? ` — ${signal.checkpoint}` : ""})`}
        </span>
        {Object.entries(signal.indicators).map(([k, v]) => (
          <span key={k} style={{
            fontSize: 11,
            fontFamily: "monospace",
            color: "#9ca3af",
            background: "rgba(255,255,255,0.04)",
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
        gap: 12,
        marginBottom: 14,
      }}>
        {[
          { label: "Entry", value: signal.entry, color: "#e0e0e0", icon: "▲" },
          { label: "Stop Loss", value: signal.sl, color: "#ef4444", icon: "✕" },
          { label: "Take Profit", value: signal.tp, color: "#22c55e", icon: "◎" },
          { label: "Risk", value: `${signal.risk}%`, color: "#f59e0b", icon: null },
        ].map(({ label, value, color, icon }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
            <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color }}>
              {icon && <span style={{ fontSize: 10, marginRight: 4 }}>{icon}</span>}
              {typeof value === "number" ? value.toFixed(2) : value}
            </div>
          </div>
        ))}
      </div>

      {/* Risk/reward bar */}
      <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          left: isLong ? 0 : `${tpPct}%`,
          width: `${isLong ? tpPct : 100 - tpPct}%`,
          height: "100%",
          borderRadius: 3,
          background: `linear-gradient(90deg, ${isLong ? "#ef4444" : "#22c55e"}, ${isLong ? "#22c55e" : "#ef4444"})`,
          opacity: 0.6,
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 9, color: "#6b7280" }}>SL {signal.sl}</span>
        <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>{signal.rr}R</span>
        <span style={{ fontSize: 9, color: "#6b7280" }}>TP {signal.tp}</span>
      </div>
    </div>
  );
}
