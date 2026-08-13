# Engine roadmap

Scope for two items on `NEXTUP.md`: **refining the signal engine**, and
**splitting the model into alpha-forecast and risk components**. Written
2026-08-05 against `8b29d39`.

This document exists because both items are easy to start in the wrong order.
The engine has fifteen-odd hand-set constants and no way to tell whether
changing one helps, so the instinct — open `engine.ts` and adjust weights — is
the one move guaranteed to produce numbers that improve while the engine gets
worse. Everything below is arranged to make that impossible.

## ⚠ Read this first — the unfilled-entry bug, found 2026-08-12

**Every expectancy figure recorded below before this date was measured through
a bug, and the pattern-quality conclusions drawn from them were wrong.**

`buildLevels` puts the trigger at the pattern's break level:
`entry = max(breakout, close)` for a long. Unless price has already gone
through it, that is a *resting stop order* — not a fill. The replay started
the stop-versus-target race at `end + 1` regardless, never checking that price
reached the entry at all. So when the next bar dipped to the stop and price
never rose to the trigger, a setup that would have sat unfilled was booked as
−1R.

One-directional, and large. `backtestTrades` now requires the fill, with a
ten-bar window, and abandons the setup if it never comes:

| pattern | n before | n after | assumed fill | fill required | delta |
| --- | --- | --- | --- | --- | --- |
| DOUBLE BOTTOM | 1092 | 366 | −0.633 | **+0.361** | +0.994 |
| CUP & HANDLE | 145 | 71 | −0.566 | **+0.314** | +0.880 |
| BULL FLAG | 2133 | 1733 | −0.154 | **+0.268** | +0.422 |
| BULL ENGULF | 187 | 187 | +0.147 | +0.147 | 0.000 |
| BEAR ENGULF | 222 | 222 | +0.097 | +0.097 | 0.000 |
| VOL BREAKOUT | 403 | 403 | +0.052 | +0.052 | 0.000 |
| ASC TRIANGLE | 417 | 234 | −0.485 | +0.009 | +0.494 |
| VOL BREAKDOWN | 293 | 293 | −0.125 | −0.125 | 0.000 |
| DESC TRIANGLE | 326 | 156 | −0.723 | −0.240 | +0.483 |
| DOUBLE TOP | 1315 | 326 | −0.865 | −0.303 | +0.563 |
| BEAR FLAG | 1799 | 1280 | −0.663 | −0.372 | +0.292 |
| **ALL** | | | **−0.461** | **+0.008** | **+0.469** |

The four patterns showing a delta of exactly zero are the confirmation: engulfs
and volume breaks trigger at market, so they have no resting entry and nothing
to get wrong. Only the patterns with a pending trigger moved, which is exactly
the signature the bug predicts. Two thirds of `DOUBLE BOTTOM`'s trades never
existed.

### What this retracts

- **"Most detectors lose money on large samples" is withdrawn.** Seven of
  eleven are positive once fills are required. `DOUBLE BOTTOM`, previously
  called the clearest deletion candidate at −0.68R, is now the *best* pattern
  on the desk at +0.36R.
- **The recommendation to delete `DOUBLE TOP` / `DOUBLE BOTTOM` is withdrawn.**
- **The fade experiment that found this was itself invalid.** Fading appeared
  to earn +1.73R on `DOUBLE TOP` — an implied 84% win rate at 2.26 R:R, where
  a random walk gives 31%. The fade was collecting the mirror image of the
  bug as free profit. Re-run against filled entries it is −0.31R, and nothing
  fades profitably enough to matter. It was a bad experiment that happened to
  be a good detector.

### What survives

- **Phase 2a's conclusion holds and strengthens.** On corrected data at 15m,
  internal consistency rises 0.577 → 0.675 and past-predicts-future 0.033 →
  0.134, with pooling at 0.298. Still real, still non-stationary, still worth
  pooling.
- **Phase 2c's constants re-validated unchanged.** 15m still peaks near
  k = 128 (0.300) with the shipped k = 64 at 0.297; 1D still peaks exactly at
  the shipped k = 8, now 0.368. No change needed.
- **The tie-break and target-sweep conclusions stand** — both were about
  relative effects across a fixed population, and both were tiny.

### The live desk

Signals across the universe go from 10 back to 28, with pattern variety
restored, because the veto now reads corrected priors.

### Still to check

**The long/short split is suspicious.** Every long pattern is now positive and
every short pattern negative — `DOUBLE BOTTOM` +0.36 against `DOUBLE TOP`
−0.30, `BULL FLAG` +0.27 against `BEAR FLAG` −0.37. That maps onto the
market's drift over a 15-day window far better than it maps onto detector
quality. Before concluding anything about the short patterns, measure across a
period that contains a real drawdown, or benchmark each pattern against the
drift of its own symbol over the same bars.

## What was measured

Every detector run against every symbol in the first scan slice, three
timeframes, on 2026-08-05. **These are the pre-2b baselines** — phase 2b has
since shipped and moved them; see its section for the current figures.

| Timeframe | symbol×pattern pairs | with a usable expectancy | median resolved sample |
| --- | --- | --- | --- |
| 15m | 220 | 108 (49%) | 5 |
| 1h | 220 | 106 (48%) | 6 |
| 1D | 220 | 84 (38%) | 6 |

Reproduce with the script in the appendix. It reads bars through
`/api/candles` rather than importing `market/yahoo.ts`, because that module is
`server-only` and throws outside a Next runtime.

### `EDGE` is a constant for half of all signals

`scoreEdge` returns a flat `max * 0.4` — 7.2 of 18 points — whenever the
sample is under `MIN_SAMPLE` (`engine.ts:82`, `backtest.ts:70`). At 49%
measurable on 15m and 38% on daily, an eighteen-point factor is contributing
an identical number to most candidates. The score advertises six factors on
the card and delivers five discriminating ones for the majority of signals.

### Where it is measured, it rests on about five trades

Resolved outcomes are −1R or roughly +2R, so the standard error on a five-
trade expectancy is around ±0.6R. `NEGATIVE_EDGE_VETO` fires at −0.35R with a
ten-trade minimum (`engine.ts:54`), where the standard error is still about
±0.44R. **That veto is currently rejecting signals on noise more often than on
evidence.** This was an estimate from the outcome distribution rather than a
measurement; 2a has since confirmed the conclusion by a different route —
the statistic the veto reads correlates 0.03 with the future at 15m.

### The tuning trap

Constants currently set by hand: six factor weights, `MIN_RR` (1.5),
`AMBIGUITY_MARGIN` (0.12), `NEGATIVE_EDGE_VETO` (−0.35), `VETO_MIN_SAMPLE`
(10), RSI vetoes at 80/20, the ±DI gap of 10, the ADX 20→40 ramp, the volume
1→2.5× ramp, `INVALIDATION_BUFFER_ATR` (0.25), `MAX_RISK_FRACTION` (0.1), and
`MAX_POSITION_FRACTION` (0.25). Fitting those against a backtest whose median
sample is five will fit noise, and every reported figure will improve. Hence
the ordering below: measurement, then repair, then tuning.

## Phase 2a — the `EDGE` reliability test — **done, and it came back negative**

Run 2026-08-05 over all 92 symbols, every detector, three timeframes:
`npm run reliability` (needs `npm run dev` up). Units are symbol/pattern
pairs; a unit is usable when it has at least three resolved trades on each
side of a split.

| Timeframe | pairs | internal (odd/even) | corrected | past → future | pooled → future |
| --- | --- | --- | --- | --- | --- |
| 15m | 425 | 0.577 | 0.731 | **0.033** | **0.227** |
| 1h | 499 | 0.499 | 0.666 | **0.141** | **0.265** |
| 1D | 407 | 0.535 | 0.697 | **0.269** | 0.201 |

### What this says

**Expectancy is a real property, not noise.** Internal consistency of 0.50–0.58
is substantial. Split a pair's trades odd/even and the two halves agree. The
original worry — that `EDGE` is five coin flips — is wrong.

**But it does not carry forward, and that is what the engine needs.** Split
the same trades chronologically instead and the correlation collapses to
**0.033 at 15m**, the desk's default timeframe. Measured edge describes the
window it was measured in and says almost nothing about the next one.

The two splits use **the same amount of data per half**, so the gap between
them is not a sample-size artefact. It isolates one variable: time. This is
non-stationarity, cleanly identified.

**Pooling beats symbol-specific history intraday, by a lot.** The pattern's
record across every *other* symbol predicts a pair's future better than its
own past does — 0.227 against 0.033 at 15m, 0.265 against 0.141 at 1h. The
symbol-specific detail is noise at intraday timeframes. Daily reverses it
(0.269 against 0.201), which fits: 400 daily bars span about 1.6 years, so
each chronological half is roughly ten months and there is real per-symbol
history to find.

One honest caveat on that comparison. A symbol-specific predictor is a mean of
three to six trades and carries large measurement error, which attenuates its
correlation; the pooled predictor averages far more trades and is attenuated
less. Part of the gap is that, not a smaller true symbol effect. **It does not
change the decision** — in live use only three to six trades exist per pair,
so the attenuated figure *is* the achievable predictive power. But the
underlying per-symbol effect is larger than 0.033 and a future harness with
more history might find it.

### What follows

1. **`EDGE` as currently computed is worth close to nothing at 15m** while
   carrying 18 of 100 confidence points. It is not decoration — the internal
   consistency proves there is something there — but it is being asked a
   question it cannot answer.
2. **`NEGATIVE_EDGE_VETO` is firing on a statistic with r = 0.03 to the
   future** at intraday timeframes. It is rejecting signals on evidence that
   does not generalise. This is now the most defensible single change
   available: pool it or drop it.
3. **Pooling is validated, and 2c is promoted.** It was scoped as a fix for
   thin samples; it is really a fix for non-stationarity, and it should be
   weighted by timeframe — pooled hard intraday, blended toward
   symbol-specific on daily.
4. The harness for scoring *confidence* against realised R — the other half of
   the original 2a — has not been built. It is still worth doing, but the
   `EDGE` result changes what it should test first.

## Phase 2a (original scope) — the confidence harness

Nothing currently tests the engine's central claim: **that a signal scoring 80
outperforms one scoring 60.** The backtest measures *pattern* expectancy.
Confidence — the number the whole UI is built around — has never been
validated against outcomes.

- Extend the replay to compute the full factor vector at each historical bar,
  not just levels, and correlate score against realised R. Five of the six
  factors read from indicator series that are already whole arrays, so they
  are nearly free.
- `EDGE` is the exception. Scoring it historically means backtesting a prefix
  at every step, which is O(n²). Either compute it on an expanding window at
  intervals and hold it flat between, or validate the other five first and
  fold `EDGE` in once the harness exists.
- ~~Split-half reliability on `EDGE`.~~ Done — see the section above. The
  machinery it needed (`backtestTrades`, `analysis/reliability.ts`) is in
  place and reusable for the confidence harness.
- Hold-outs are not optional: by time (fit on older bars, validate on recent)
  **and** by symbol (fit on half the universe, validate on the other). Without
  both, phase 2c is self-deception with extra steps.

## Phase 2b — repair what is already wrong — **done**

Shipped 2026-08-05. Two of the four items in the original draft survived
contact with the code; the record of what happened to each is more useful
here than a tidy list.

**Horizon reserve — fixed.** `backtestPattern` reserved `MAX_HORIZON` (100
bars) unconditionally, even for patterns whose horizon works out at 20. The
replay is now bounded by `MIN_HORIZON` and skips individual occurrences that
lack their full horizon, so a fast-resolving pattern gets eighty more bars of
history. Occurrences short of their horizon are skipped rather than booked
unresolved, which would have biased the record toward whatever resolves fast.

**Adverse excursion — added.** `BacktestResult.typicalHeatR` is the median
maximum adverse excursion among winning trades, in R. Winners only: the losers
all ran to −1R by construction, so including them would just re-measure the
stop. Surfaced on the signal as `TYPICAL HEAT`.

**Cooldown off-by-one — was not a bug.** The original draft called out
`end += COOLDOWN` sitting inside a `for (…; end++)` loop as an off-by-one. It
is not. `COOLDOWN` is documented as "bars to skip after an occurrence", and
skipping five bars after bar *N* means the next examined bar is *N+6* — which
is exactly what the two increments produce together. Left alone.

**`scoreEdge`'s 40% default — deferred to 2c.** Re-deriving it only makes
sense once pooling exists to replace it.

### What it actually bought

| Timeframe | measurable before | after | median sample | median winner heat |
| --- | --- | --- | --- | --- |
| 15m | 49% | **53%** | 5 → 6 | 0.48R |
| 1h | 48% | **54%** | 6 → 7 | 0.51R |
| 1D | 38% | **39%** | 6 → 6 | 0.55R |

Smaller than the "31% of bars discarded" figure implies, and worth
understanding why: horizon scales with target distance, so most patterns ask
for something near the 100-bar cap anyway and the reserve was genuinely needed
for them. Only the fast-resolving tail benefited. Four to six points of extra
coverage is real but it does not change the picture — the sample problem is a
data problem, and 2c is still where it gets addressed.

**The heat number is the more interesting result.** A typical winner goes
about half of the way to its stop before working, consistently across all
three timeframes. That is a reassuring reading for stop placement — stops sit
at roughly twice the heat a winner takes, so they are not obviously strangling
trades — and it is the first empirical check the geometry has ever had. It is
also the input 3-risk needs.

## Phase 2c — pooling — **shipped 2026-08-06**

`analysis/pooling.ts` blends a symbol's own expectancy toward the pattern's
record across the rest of the scan, `weight = n / (n + k)`. The engine scores
and vetoes on the blended figure.

**`k` was measured, not chosen.** `npm run reliability` sweeps it against
out-of-sample future R, priors built from past halves only, each unit excluded
from its own prior. Every timeframe improved on `k = 0`, which is what the
engine did before:

| tf | k = 0 (before) | chosen k | at chosen k | best k seen |
| --- | --- | --- | --- | --- |
| 5m | 0.364 | 16 | **0.419** | 16 (0.419) |
| 15m | 0.029 | 64 | **0.188** | ∞ (0.222) |
| 1h | 0.141 | 64 | **0.263** | 128 (0.265) |
| 4h | 0.074 | 64 | **0.185** | 128 (0.191) |
| 1D | 0.267 | 8 | **0.286** | 8 (0.286) |

15m improves roughly sixfold. Two constants sit off the measured argmax on
purpose — the optimum is itself an estimate from 300–500 non-independent
pairs, the curves are flat near the top, and permanently discarding a symbol's
record is a strong claim to make from one afternoon's data. The cost of that
caution is about 0.03 of correlation.

**The ordering is not monotonic in timeframe and should not be forced to be.**
5m persists best because 400 five-minute bars span about a week, so both halves
sit in one regime. 1D persists because 400 daily bars span 1.6 years and there
is real per-symbol history. The middle is where a record is both short-lived
and thin.

Shrinkage also dissolves the flat-7.2 problem: an estimate is now defined for
every pair, leaning on the prior when there is nothing else.

### It exposed something bigger than the pooling — **superseded, see the unfilled-entry section at the top**

With the prior in place, most detectors turn out to be **losing patterns on
large samples**. Pooled expectancy at 15m across all 92 symbols:

| pattern | expectancy | n |
| --- | --- | --- |
| VOL BREAKOUT | **+0.19R** | 363 |
| BULL ENGULF | +0.05R | 181 |
| VOL BREAKDOWN | −0.00R | 330 |
| BEAR ENGULF | −0.02R | 208 |
| BULL FLAG | −0.11R | 2063 |
| ASC TRIANGLE | −0.26R | 367 |
| DESC TRIANGLE | −0.41R | 343 |
| BEAR FLAG | −0.45R | 1875 |
| CUP & HANDLE | −0.49R | 167 |
| DOUBLE BOTTOM | −0.68R | 1094 |
| DOUBLE TOP | −0.70R | 1197 |

Symbol-specific noise was hiding this. A pattern with −0.7R everywhere shows
+0.3R on some symbols by chance, and that is what the engine was scoring.

Since `NEGATIVE_EDGE_VETO` is −0.35R and now reads the pooled figure, five of
the eleven detectors are vetoed universally at 15m. Signals across the whole
universe fall from 16 to 10. **This is the engine working as designed** — it
is precisely the "trade whose own history argues against it" the veto was
written for — but it is a large behavioural change resting on one day's
measurement, and it deserves a decision rather than a default.

Checked before accepting it: the backtest scores every occurrence while the
engine declines `rr < 1.5`, so the prior was measuring a population the desk
does not trade. 86% of trades clear the filter and applying it moves nothing
in the rescuing direction — DOUBLE TOP goes to −0.77R. The mismatch is real
but not the explanation. `BacktestTrade.rr` now carries the figure so the
question can be re-asked cheaply.

### The tie-break is not the explanation — measured 2026-08-06

The suspicion was that the pessimistic intrabar assumption was depressing
every pattern. It is not. Across 8189 resolved trades at 15m, **32 resolve on
an ambiguous bar — 0.4%.** Total expectancy across all patterns moves from
−0.348 (pessimistic, shipped) to −0.337 (optimistic). A range of 0.011R.

That is arithmetically obvious in hindsight: stops sit around 1 ATR out and
targets 2–5 ATR, so a single bar covering both needs a 3-plus ATR range, which
15-minute bars rarely have. Truncation is not the explanation either — only
4.1% of occurrences never resolve. `BacktestTrade` now carries `ambiguous` and
`openedTowardTarget` so this stays checkable rather than becoming folklore.

### It is the targets — except where it is the detector — **superseded; the entry bug, not the detectors**

Splitting win rate from reward-to-risk separates the two, and the structure is
unmistakable. `breakeven%` is the win rate each pattern's own R:R requires;
`gap` is what it actually achieves minus that.

| pattern | n | win% | mean R:R | breakeven% | gap | expectancy |
| --- | --- | --- | --- | --- | --- | --- |
| VOL BREAKOUT | 361 | 51.8 | 1.37 | 42.2 | **+9.6** | +0.202 |
| VOL BREAKDOWN | 331 | 42.6 | 1.43 | 41.2 | +1.4 | +0.000 |
| BULL ENGULF | 180 | 39.4 | 1.69 | 37.2 | +2.2 | +0.036 |
| BEAR ENGULF | 210 | 39.5 | 1.61 | 38.3 | +1.2 | −0.001 |
| BULL FLAG | 2062 | 22.3 | 3.29 | 23.3 | **−1.0** | −0.102 |
| ASC TRIANGLE | 369 | 17.9 | 3.49 | 22.3 | −4.4 | −0.259 |
| CUP & HANDLE | 169 | 10.7 | 4.78 | 17.3 | −6.7 | −0.500 |
| DESC TRIANGLE | 343 | 15.5 | 3.35 | 23.0 | −7.5 | −0.408 |
| BEAR FLAG | 1877 | 14.7 | 3.21 | 23.8 | −9.1 | −0.439 |
| DOUBLE BOTTOM | 1092 | 12.5 | 2.22 | 31.0 | **−18.6** | −0.673 |
| DOUBLE TOP | 1195 | 11.2 | 2.26 | 30.7 | **−19.5** | −0.702 |

**Every pattern asking under 1.7R is at or above breakeven. Every pattern
asking over 2R is below it.** Expectancy tracks mean R:R inversely across the
whole table. `buildLevels` sets `target = match.measured` — the full measured
move — and the full measured move is not reached often enough to pay for the
distance being asked.

Two different diseases, and they need different treatment:

- **The flags, triangles and cup are geometry.** They ask 3–5R and land 11–22%.
  `BULL FLAG` is the striking one: a −1.0 gap over 2062 trades, one point of
  win rate away from viable, and the most common pattern on the desk. Scaling
  targets back should raise win rate faster than it lowers R:R for all of
  these.
- **`DOUBLE TOP` and `DOUBLE BOTTOM` are the detectors.** They ask a modest
  2.2R and still miss breakeven by nineteen points across 2287 trades. No
  target adjustment rescues that. Either the detection criteria are wrong or
  the pattern does not work on intraday bars.

### The target sweep — measured 2026-08-06, and the geometry theory is wrong

`npm run target-sweep`. Same trades throughout, `MIN_RR` deliberately not
applied — a smaller target lowers reward-to-risk, and filtering on it would
have compared different populations rather than different exits. At f = 0.6
several patterns retain nothing at all, which is exactly the trap.

| pattern | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 | early/late argmax |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VOL BREAKOUT | 0.030 | 0.063 | 0.083 | 0.118 | 0.118 | 0.147 | **0.192** | 1 / 1 |
| BEAR ENGULF | −0.032 | −0.011 | −0.024 | −0.030 | −0.011 | 0.016 | **0.019** | 0.8 / 1 |
| BULL ENGULF | −0.101 | −0.081 | −0.084 | −0.068 | −0.056 | −0.019 | **0.031** | 0.5 / 1 |
| VOL BREAKDOWN | −0.061 | −0.070 | −0.047 | −0.049 | −0.036 | −0.017 | **−0.004** | 1 / 0.4 |
| BULL FLAG | −0.233 | −0.184 | −0.164 | −0.133 | −0.126 | −0.112 | **−0.104** | 1 / 0.7 |
| ASC TRIANGLE | −0.401 | −0.415 | −0.377 | −0.348 | −0.279 | −0.274 | **−0.249** | 1 / 0.8 |
| CUP & HANDLE | −0.481 | −0.354 | −0.355 | **−0.329** | −0.412 | −0.441 | −0.500 | **0.7 / 0.7** |
| DESC TRIANGLE | −0.531 | −0.495 | −0.464 | −0.409 | −0.429 | −0.457 | **−0.402** | 0.7 / 0.8 |
| BEAR FLAG | −0.478 | −0.463 | −0.443 | −0.449 | −0.443 | −0.438 | **−0.442** | 1 / 0.6 |
| DOUBLE BOTTOM | −0.764 | −0.750 | −0.731 | −0.714 | −0.691 | −0.689 | **−0.677** | 1 / 0.8 |
| DOUBLE TOP | −0.765 | −0.759 | −0.759 | −0.743 | −0.736 | −0.714 | **−0.697** | 1 / 0.9 |

**The full measured move is best or joint-best for nine of eleven patterns.**
Pulling the target in makes things monotonically worse for most of them.

**The previous section's conclusion was wrong, and this is the correction.**
Expectancy does track reward-to-risk inversely *across* patterns, but that is
not a lever *within* one. Patterns that ask for more happen to be worse
patterns; asking for less does not make any given pattern better. `BULL FLAG`
was described here as "one point of win rate from viable" — it is not, because
buying that point of win rate costs more R than it returns.

There is a reason it comes out this way, and it should have been predicted.
Under a driftless walk with a stop at *b* and a target at *a*, the probability
of reaching the target first is `b / (a + b)`, so expectancy is zero at every
target distance — moving the target trades win rate against payoff at a fair
price and changes nothing. The mild preference for *larger* targets in the
table is consistent with slight trend continuation after these setups. **Exit
distance is close to EV-neutral by construction. A losing pattern is losing on
entry.**

Only `CUP & HANDLE` shows an interior optimum both halves agree on — 0.7,
worth +0.17R. It is still −0.33R there, so it does not rescue anything, and
n = 169 is thin. Not worth a special case.

`TARGET_FRACTION` therefore stays at 1, now for a measured reason rather than
by default, and `buildLevels` takes it as a parameter so the engine and the
backtest cannot drift apart on it.

### Next here

- ~~**Delete or fix the losing detectors.**~~ Withdrawn — the losses were the unfilled-entry bug. Exit tuning cannot save them, so the
  question is entry quality. `DOUBLE TOP` and `DOUBLE BOTTOM` are −0.68R and
  −0.70R over 2287 trades and are the clearest candidates for removal; the
  README's "nine detectors" is a promise the scan is not keeping.
- **Understand `VOL BREAKOUT`.** It is the one convincingly profitable pattern
  (+0.19R over 361 trades, and it improves monotonically with target distance).
  Whatever it is doing right is worth knowing before rewriting anything else.
- **Priors come from one slice (31 symbols), not 92.** Good enough given the
  slices now interleave, but a prior accumulated across a full sweep would be
  three times better powered.

## Phase 2c — the original scope, for reference

The fix for thin samples is not more tuning, it is **pooling**. Estimate a
pattern-level prior across the whole universe, then shrink each symbol-
specific expectancy toward it (empirical Bayes). `BULL FLAG` across ninety
symbols has real statistical power; `BULL FLAG on SCHW` never will at 400
bars. This also removes the binary measurable/unmeasurable cliff that makes
`EDGE` a constant today.

2a promoted this from a nice-to-have to the fix for a measured defect, and
sharpened what it should look like:

- **Shrink by timeframe, not by a single constant.** Pooling beat
  symbol-specific history 0.227 to 0.033 at 15m and 0.265 to 0.141 at 1h, but
  *lost* 0.201 to 0.269 on daily. One shrinkage weight across all five
  timeframes would give away the daily result to rescue the intraday one.
- **The veto has to move with it.** `NEGATIVE_EDGE_VETO` reads the
  symbol-specific number, which is the one that does not generalise. It should
  read the pooled estimate or go.
- **Validate behind the same chronological split.** `poolingComparison` in
  `analysis/reliability.ts` is the shape of the test; a pooled `EDGE` has to
  beat the current one at predicting *future* R, not at fitting the window it
  was estimated on. The current factor already looks excellent by that
  standard, which is exactly the trap.

**The binding constraint is data, not code.** `MAX_BARS` is 400 in
`market/yahoo.ts`, and Yahoo will not give more on these endpoints. Pooling
buys power without more history. Going past that means persisting bars locally
as they arrive, or changing data source — a larger project than this item, and
one to scope separately rather than smuggle in here.

## Item 3 — splitting alpha from risk

The dependency on item 2 is not merely sequential: **a split you cannot
measure is a refactor, not an improvement.** Phase 2a's harness is what
demonstrates the split did not degrade anything.

What is conflated today:

| Factor | Points | Actually is |
| --- | --- | --- |
| `PATTERN` | 30 | Alpha |
| `EDGE` | 18 | Alpha — it *is* an expected-return estimate |
| `TREND` | 17 | Alpha |
| `MOMENTUM` | 16 | Alpha |
| `VOLUME` | 11 | Both — conviction is alpha, liquidity and slippage are risk |
| `INDEPENDENCE` | 8 | Risk — portfolio construction, not forecast |

**`INDEPENDENCE` is the clearest tell.** SPY correlation does not make a
forecast better or worse; it makes the trade a better or worse *diversifier*,
and that depends entirely on what is already held. With an empty book,
correlation is close to irrelevant. Already long five tech names, it is the
most important number on the card. A static per-signal score cannot express
that, because it has no access to the book — and the journal is already
holding the book. That is the payoff for the split.

**Alpha model** — outputs an expected R with an uncertainty band, pooled and
shrunk, replacing an arbitrary 0–100. Inputs: pattern geometry, measured edge,
trend agreement, momentum, volume-as-conviction.

**Risk model** — outputs the trade's risk regardless of whether the trade is
any good: a volatility forecast, empirical stop placement from the MAE
distribution added in 2b, liquidity and slippage from dollar volume,
**overnight gap exposure** (the session calendar from `market/session.ts` plus
`typicalHoldBars` already say whether a trade spans a bell), and correlation
against open positions.

**Combiner** — ranks on expected R and sizes from the risk model. Today
`suggestedSize` uses stop distance and a flat 25% cap
(`journal/stats.ts:222`); a real risk model sizes on volatility and book
overlap.

Be clear-eyed: the split does not by itself improve signal quality. It buys
testability, honest sizing, and portfolio awareness. The quality gains live in
2b and 2c.

## Order, and why

1. ~~**2b** — the repairs.~~ Done 2026-08-05; measurements above.
2. ~~**2a** — the `EDGE` split-half test.~~ Done 2026-08-05; it came back
   negative on the temporal split, which promoted 2c.
3. ~~**2c** — pooling, timeframe-weighted.~~ Shipped 2026-08-06; it works, and
   it exposed that five of eleven detectors lose money on large samples.
4. **3-risk** — MAE-based stops, gap exposure, sizing. Most visible
   improvement to anyone actually using the desk, and `typicalHeatR` from 2b
   is already in place to feed it.
5. **3-alpha** — calibrated expected-R, once there is power to calibrate
   against.

Rough sizing: 2b was an afternoon, as estimated. 2a is a couple of days,
dominated by the O(n²) `EDGE` problem. 3-risk is a few days. 2c and 3-alpha
are each a week or more and genuinely open-ended, because what they should do
depends on what 2a measures.

## What would invalidate this

- ~~**`EDGE` passes split-half reliability convincingly.**~~ Settled
  2026-08-05: it passes internally and fails temporally. Neither branch this
  section anticipated — the answer was "real but non-stationary", which
  promotes pooling rather than deletion. See phase 2a above.
- **Confidence turns out to be non-monotonic with realised R.** Still open.
  That is a finding about the weights, not the factors, and it would promote
  2c further still.
- **Pooling does not survive its own out-of-sample test.** The 0.227 figure is
  a correlation across pairs, not a demonstration that a pooled `EDGE` scores
  better signals. Build 2c behind the same chronological split that produced
  these numbers, or it will look like an improvement for the same reason the
  current factor does.
- **A data source with real history appears.** Most of the statistical
  contortion above exists only because of the 400-bar ceiling.

## Appendix — the harnesses

`npm run reliability [timeframes…]` is committed at `scripts/reliability.mts`
and produces the 2a table. It needs `npm run dev` up, because it reads bars
through `/api/candles` rather than importing `market/yahoo.ts`, which is
`server-only` and throws outside a Next runtime. `analysis/reliability.ts`
holds the statistics and is unit-tested against constructed signal and
constructed noise, so a null result can be trusted as a null result.

The coverage probe below is not committed — it is a throwaway. Save it at the
repo root as `power-check.mts`, run `npx tsx power-check.mts 15m`, delete it.

```ts
import { backtestPattern } from "./src/lib/analysis/backtest";
import { PATTERN_NAMES } from "./src/lib/analysis/patterns";
import { scanSlice } from "./src/lib/market/universe";
import type { Series } from "./src/lib/market/types";

async function main() {
  const tf = process.argv[2] ?? "15m";
  const series: Series[] = [];
  for (const sym of scanSlice(0).slice(0, 20)) {
    const r = await fetch(
      `http://localhost:3000/api/candles?symbol=${sym}&timeframe=${tf}`,
    );
    if (r.ok) series.push(await r.json());
  }
  console.log(`\ntf=${tf} symbols=${series.length} bars=${series[0]?.candles.length}`);

  let pairs = 0, measurable = 0, occurrences = 0, unresolved = 0;
  const samples: number[] = [];
  for (const s of series) {
    for (const name of PATTERN_NAMES) {
      const r = backtestPattern(s.candles, name);
      pairs++;
      occurrences += r.wins + r.losses + r.unresolved;
      unresolved += r.unresolved;
      if (r.sample > 0) samples.push(r.sample);
      if (r.expectancy !== null) measurable++;
    }
  }
  samples.sort((a, b) => a - b);
  console.log(`pairs ${pairs}, measurable ${measurable}`);
  console.log(`occurrences ${occurrences} (${unresolved} unresolved)`);
  console.log(`sample median ${samples[Math.floor(samples.length / 2)] ?? 0}`);
}
main();
```
