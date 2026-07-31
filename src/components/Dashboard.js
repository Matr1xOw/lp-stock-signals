"use client";

import { useState } from "react";
import SignalCard from "./SignalCard";
import PositionRow from "./PositionRow";
import { MOCK_SIGNALS, MOCK_POSITIONS } from "@/lib/mockData";
import { calcPnl } from "@/lib/utils";

export default function Dashboard() {
  const [tab, setTab] = useState("signals");
  const [posFilter, setPosFilter] = useState("all");

  const filteredPositions = MOCK_POSITIONS.filter(p =>
    posFilter === "all" ? true : p.status === posFilter
  );

  const openPositions = MOCK_POSITIONS.filter(p => p.status === "open");
  const totalPnl = openPositions.reduce((sum, p) => sum + calcPnl(p).pnl, 0);

  const filteredTotal = filteredPositions.reduce((sum, p) => sum + calcPnl(p).pnl, 0);

  return (
    <div style={{
      minHeight: "100vh",
      padding: "24px 20px",
      maxWidth: 720,
      margin: "0 auto",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#f8fafc",
            margin: 0,
            letterSpacing: "-0.3px",
          }}>LP</h1>
          <span style={{ fontSize: 12, color: "#4b5563", letterSpacing: "2px", textTransform: "uppercase" }}>Stock Signals</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b7280" }}>
          <span>
            <span style={{ color: "#4ade80", fontFamily: "monospace", fontWeight: 600 }}>{openPositions.length}</span> open
          </span>
          <span>
            P&L{" "}
            <span style={{
              fontFamily: "monospace",
              fontWeight: 600,
              color: totalPnl >= 0 ? "#4ade80" : "#f87171",
            }}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </span>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex",
        gap: 0,
        marginBottom: 20,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {["signals", "positions"].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "none",
              border: "none",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              color: tab === t ? "#f0f0f0" : "#6b7280",
              cursor: "pointer",
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              textTransform: "capitalize",
              transition: "all 0.15s",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Signals Tab */}
      {tab === "signals" && (
        <div>
          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1px" }}>
            Latest Signals
          </div>
          {MOCK_SIGNALS.map(s => <SignalCard key={s.id} signal={s} />)}
        </div>
      )}

      {/* Positions Tab */}
      {tab === "positions" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {["all", "open", "closed"].map(f => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                style={{
                  background: posFilter === f ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)",
                  border: posFilter === f ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 6,
                  padding: "5px 14px",
                  fontSize: 12,
                  color: posFilter === f ? "#60a5fa" : "#6b7280",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "80px 50px 70px 70px 90px 70px",
            padding: "0 0 8px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            fontSize: 10,
            color: "#4b5563",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            <span>Ticker</span>
            <span>Side</span>
            <span>Entry</span>
            <span>{posFilter === "closed" ? "Close" : "Current"}</span>
            <span>P&L</span>
            <span>Status</span>
          </div>

          {filteredPositions.map(p => <PositionRow key={p.id} pos={p} />)}

          {/* Total P&L */}
          {posFilter !== "open" && (
            <div style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
            }}>
              <span style={{ color: "#6b7280" }}>
                {posFilter === "closed" ? "Closed" : "Total"} P&L
              </span>
              <span style={{
                fontFamily: "monospace",
                fontWeight: 600,
                color: filteredTotal >= 0 ? "#4ade80" : "#f87171",
              }}>
                {filteredTotal >= 0 ? "+" : ""}${filteredTotal.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
