"use client";

import { useState } from "react";
import SignalCard from "./SignalCard";
import PositionRow from "./PositionRow";
import { MOCK_SIGNALS, MOCK_POSITIONS } from "@/lib/mockData";
import { calcPnl } from "@/lib/utils";

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e8eaed",
      borderRadius: 10,
      padding: "16px 20px",
      flex: 1,
    }}>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#111827", fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [posFilter, setPosFilter] = useState("all");

  const filteredPositions = MOCK_POSITIONS.filter(p =>
    posFilter === "all" ? true : p.status === posFilter
  );

  const openPositions = MOCK_POSITIONS.filter(p => p.status === "open");
  const closedPositions = MOCK_POSITIONS.filter(p => p.status === "closed");
  const totalPnl = MOCK_POSITIONS.reduce((sum, p) => sum + calcPnl(p).pnl, 0);
  const openPnl = openPositions.reduce((sum, p) => sum + calcPnl(p).pnl, 0);

  const wins = closedPositions.filter(p => calcPnl(p).pnl >= 0).length;
  const winRate = closedPositions.length > 0 ? ((wins / closedPositions.length) * 100).toFixed(0) : "—";

  const activeSignals = MOCK_SIGNALS.filter(s => s.status === "active");

  return (
    <div style={{ minHeight: "100vh", padding: "20px 28px" }}>
      {/* Top nav */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 24,
        paddingBottom: 16,
        borderBottom: "1px solid #e8eaed",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
          }}>LP</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>LP Stock Signals</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Technical Analysis Dashboard</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "#6b7280" }}>
          <span>Market Hours</span>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 6px rgba(34,197,94,0.4)",
          }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <StatCard label="Open Positions" value={openPositions.length} sub={`${closedPositions.length} closed`} />
        <StatCard
          label="Unrealized P&L"
          value={`${openPnl >= 0 ? "+" : ""}$${openPnl.toFixed(2)}`}
          color={openPnl >= 0 ? "#16a34a" : "#dc2626"}
        />
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          color={totalPnl >= 0 ? "#16a34a" : "#dc2626"}
        />
        <StatCard label="Win Rate" value={`${winRate}%`} sub={`${wins}/${closedPositions.length} trades`} />
        <StatCard label="Active Signals" value={activeSignals.length} sub={`${MOCK_SIGNALS.length} total`} />
      </div>

      {/* Main content: two columns */}
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20, alignItems: "start" }}>
        {/* Left: Signals */}
        <div>
          <div style={{
            background: "#fff",
            border: "1px solid #e8eaed",
            borderRadius: 10,
            padding: "18px 20px",
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Latest Signals</h2>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{activeSignals.length} active</span>
            </div>
            {MOCK_SIGNALS.map(s => <SignalCard key={s.id} signal={s} />)}
          </div>
        </div>

        {/* Right: Positions */}
        <div>
          <div style={{
            background: "#fff",
            border: "1px solid #e8eaed",
            borderRadius: 10,
            padding: "18px 20px",
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Positions</h2>
              <div style={{ display: "flex", gap: 4 }}>
                {["all", "open", "closed"].map(f => (
                  <button
                    key={f}
                    onClick={() => setPosFilter(f)}
                    style={{
                      background: posFilter === f ? "#eff6ff" : "transparent",
                      border: posFilter === f ? "1px solid #bfdbfe" : "1px solid transparent",
                      borderRadius: 6,
                      padding: "4px 12px",
                      fontSize: 11,
                      fontWeight: 500,
                      color: posFilter === f ? "#2563eb" : "#9ca3af",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                  {["Ticker", "Side", "Entry", posFilter === "closed" ? "Close" : "Current", "P&L", "%", "Status"].map(h => (
                    <th key={h} style={{
                      padding: "8px 12px",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#9ca3af",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      textAlign: "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map(p => <PositionRow key={p.id} pos={p} />)}
              </tbody>
            </table>

            {filteredPositions.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                No {posFilter} positions
              </div>
            )}
          </div>

          {/* Chart placeholder */}
          <div style={{
            background: "#fff",
            border: "1px solid #e8eaed",
            borderRadius: 10,
            padding: "18px 20px",
            marginTop: 16,
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 12 }}>Chart</h2>
            <div style={{
              height: 200,
              background: "#f9fafb",
              borderRadius: 8,
              border: "1px dashed #d1d5db",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
              fontSize: 13,
            }}>
              Candlestick chart — coming in Phase 4
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
