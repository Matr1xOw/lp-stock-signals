import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionNotice } from "./execution";
import { signalTicket } from "./ticket";
import type { Signal } from "./types";

const signal: Signal = {
  id: "AAPL-15m-1",
  symbol: "AAPL",
  name: "Apple Inc.",
  direction: "LONG",
  timeframe: "15m",
  entry: 224.8,
  stop: 221.15,
  target: 232.1,
  rr: 2,
  price: 224.8,
  previousClose: 223.4,
  pattern: "Range breakout",
  patternDetail: "3-touch resistance",
  detectedAt: 1_770_000_000,
  confidence: 78,
  factors: [],
  context: {
    adx: 27,
    plusDi: 25,
    minusDi: 15,
    rsi: 58,
    macdHistogram: 0.4,
    relativeVolume: 1.6,
    benchmarkCorrelation: 0.4,
    atr: 2.1,
  },
  historicalWinRate: 0.61,
  historicalExpectancy: 0.42,
  typicalHoldBars: 9,
  typicalHeatR: 0.41,
  historicalSample: 18,
};

// $500 over $3.65 of risk per share would be 136 shares, but the position cap
// binds first: a quarter of $100k at $224.80 is 111.
const sizing = { riskPerTrade: 500, accountSize: 100_000 };

describe("signalTicket", () => {
  it("leads with the line that identifies the trade", () => {
    const lines = signalTicket(signal, sizing).split("\n");
    assert.equal(lines[0], "AAPL LONG · 15m");
  });

  it("states each level with its move from entry", () => {
    const ticket = signalTicket(signal, sizing);
    assert.match(ticket, /^Entry {3}224\.80$/m);
    assert.match(ticket, /^Stop {4}221\.15 {2}\(-1\.6%\)$/m);
    assert.match(ticket, /^Target {2}232\.10 {2}\(\+3\.2%\)$/m);
  });

  it("measures the move from entry, not from last price", () => {
    // Price has run past the trigger; the stop is still 1.6% below *entry*.
    const ticket = signalTicket({ ...signal, price: 229 }, sizing);
    assert.match(ticket, /\(-1\.6%\)/);
  });

  it("carries the share count beside the reward-to-risk", () => {
    assert.match(signalTicket(signal, sizing), /^R:R {5}2\.00R · 111 shares at 1R$/m);
  });

  it("signs a short's levels the other way round", () => {
    const short = signalTicket(
      { ...signal, direction: "SHORT", stop: 228.5, target: 217.5 },
      sizing,
    );
    assert.equal(short.split("\n")[0], "AAPL SHORT · 15m");
    assert.match(short, /^Stop {4}228\.50 {2}\(\+1\.6%\)$/m);
    assert.match(short, /^Target {2}217\.50 {2}\(-3\.2%\)$/m);
  });

  it("keeps the win rate tied to its sample size", () => {
    assert.match(
      signalTicket(signal, sizing),
      /^Confidence 78\/100 · hist win 61% \(18 setups\)$/m,
    );
  });

  it("drops the win rate entirely when there is none", () => {
    const untested = signalTicket(
      { ...signal, historicalWinRate: null, historicalSample: 0 },
      sizing,
    );
    assert.match(untested, /^Confidence 78\/100$/m);
    assert.doesNotMatch(untested, /hist win/);
  });

  it("separates the levels from the reasoning with a blank line", () => {
    const lines = signalTicket(signal, sizing).split("\n");
    assert.equal(lines[5], "");
    assert.equal(lines[6], "Range breakout, 3-touch resistance");
  });

  it("appends the closed-market warning only when there is one", () => {
    const notice: ExecutionNotice = {
      badge: "MARKET CLOSED · OPENS IN 11h 8m",
      detail: "Cannot be taken for 11h 8m.",
      wait: "11h 8m",
      atMarket: true,
    };
    const closed = signalTicket(signal, { ...sizing, notice });
    assert.equal(closed.split("\n").at(-1), "MARKET CLOSED - opens in 11h 8m");
    assert.doesNotMatch(signalTicket(signal, sizing), /MARKET CLOSED/);
  });

  it("folds the engine's typography back to ASCII", () => {
    // Real pattern details carry a multiplication sign: "4.9× volume".
    const ticket = signalTicket(
      { ...signal, patternDetail: "20-bar low on 4.9× volume" },
      sizing,
    );
    assert.match(ticket, /^Range breakout, 20-bar low on 4\.9x volume$/m);
  });

  it("stays pasteable: no characters a broker field will mangle", () => {
    const ticket = signalTicket(
      { ...signal, patternDetail: "4.9× volume, −2R worst case" },
      sizing,
    );
    // The interpunct is the one deliberate exception.
    assert.doesNotMatch(ticket.replace(/·/g, ""), /[^\x00-\x7F]/);
  });
});
