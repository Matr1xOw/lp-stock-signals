Features to add:
- ~~Ability to copy and paste a signal~~ — shipped in 8b29d39
- ~~Signals accumulate across the whole universe instead of one batch~~ — e794a6a

- Refining and fine tuning the signal engine — **mostly done, and it found
  something bigger than tuning**

  Scoped and measured in docs/engine-roadmap.md. Read that before continuing;
  every number below is reproducible with `npm run reliability` and
  `npm run target-sweep`, both of which need `npm run dev` running.

  - ~~2b: recover discarded backtest history, measure adverse excursion~~ 46e9073
  - ~~2a: does the measured edge measure anything?~~ 117bf29 — it is real but
    non-stationary. A pair's own record correlates 0.03 with its own future on
    15m bars; the pattern's record across other symbols correlates 0.22.
  - ~~2c: pool and shrink, weighted by timeframe~~ bc04e36 — improves
    out-of-sample prediction at every timeframe, 15m roughly sixfold.

  What is left here is no longer tuning. Pooling exposed that most detectors
  lose money on large samples — DOUBLE TOP is −0.70R over 1197 trades, DOUBLE
  BOTTOM −0.68R over 1094 — and neither the intrabar tie-break (worth 0.011R)
  nor the target distance (near EV-neutral) explains it. They lose on entry.

  Both of those conclusions were then overturned by a bug: the backtest
  scored trades whose entry never filled, worth 0.469R. Once fixed, seven of
  eleven detectors are positive and DOUBLE BOTTOM is the best of them.

  A matched placebo (`npm run placebo`) then settled what that is worth.
  Resolving the same trade from a random bar on the same symbol earns the
  same money: edge is -0.050 at 15m and +0.005 daily. The long/short split is
  market drift, not detector quality. On this data the detectors contribute
  nothing to entry timing.

  The decile test (`npm run decile`) then answered the last open question.
  Confidence does not rank entries: the spread between the top and bottom 30%
  is +0.021 on daily, and -0.214 at 15m, where the highest-confidence decile
  is the *worst* against its own placebo at -0.302. Intraday the score is a
  mild contrarian indicator, plausibly because high confidence means strong
  ADX, aligned MACD and heavy volume at once — a description of a move that
  has already happened.

  So the engine has no demonstrable edge: the detectors do not beat random
  timing, the score does not rank what they find, and the apparent profit is
  market drift. Everything around it — journal, book, session handling,
  levels, risk measurement — is sound.

  - **Fix the README.** It claims the engine "measures its own edge" and puts
    CONFIDENCE on every card as the headline number. Written in good faith,
    no longer supported. Highest priority in the repo: the only place where
    the code and the claims disagree.
  - Test the climax hypothesis — if high confidence buys exhaustion, flipping
    or flattening VOLUME and TREND is cheap to measure and the harness would
    show it straight away.

- Split up the model into its alpha forecasts and risks models — next up

  3-risk first: `typicalHeatR` from 2b is already measured and unused, and it
  is what stop placement should be based on rather than pattern geometry.
  Sizing that knows what the journal already holds is the other half.

- Expand the stock universe and make loading more effective with research from Ben Feng's paper

  Note this now interacts with the sweep: a full sweep takes
  `ceil(universe / 40) × 2` minutes, so 300 symbols would take 16 minutes and
  signals would age most of a sweep before being re-confirmed. Needs a
  decision on SCAN_BATCH and the request budget alongside it.

- Buiid into a web application vs a website to maintain consistent runtime

Smaller loose ends:
- The LOG TRADE dialog has no closed-market warning, though it is where the
  warning bites hardest — it is the moment you would record a fill that cannot
  have happened yet.
- The holiday table in market/session.ts stops at 2027.
