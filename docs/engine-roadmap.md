# Engine roadmap

Scope for two items on `NEXTUP.md`: **refining the signal engine**, and
**splitting the model into alpha-forecast and risk components**. Written
2026-08-05 against `8b29d39`.

This document exists because both items are easy to start in the wrong order.
The engine has fifteen-odd hand-set constants and no way to tell whether
changing one helps, so the instinct — open `engine.ts` and adjust weights — is
the one move guaranteed to produce numbers that improve while the engine gets
worse. Everything below is arranged to make that impossible.

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

## Phase 2c — pooling, then tuning — **now the top item**

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
3. **2c** — pooling, timeframe-weighted, validated behind a chronological
   split. Now the highest-value item: it is the fix for a measured defect
   rather than a speculative improvement.
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
