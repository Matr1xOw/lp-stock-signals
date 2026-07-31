# LP Stock Signals

A stock signaler that analyzes market trends using technical indicators and provides actionable trade signals with built-in position tracking.

## Features

- **Signal Generation** — Automated signals based on ADX, RSI, MACD, and SPY correlation
- **Signal Cards** — Entry, stop loss, take profit, risk/reward ratio at a glance
- **Position Tracker** — Track open and closed positions with real-time P&L
- **In-App Notifications** — Get alerted when new signals fire

## Tech Stack

- **Frontend**: Next.js (React)
- **Signal Engine**: Python (FastAPI) — _coming soon_
- **Database**: PostgreSQL — _coming soon_
- **Real-time**: WebSockets — _coming soon_

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Roadmap

- [ ] Phase 1 — Signal engine (FastAPI + pandas-ta + yfinance)
- [ ] Phase 2 — Auth & persistent notifications
- [ ] Phase 3 — PostgreSQL position tracking
- [ ] Phase 4 — Live price WebSocket, charts, backtesting

## License

MIT
