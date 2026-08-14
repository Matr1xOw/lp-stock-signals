# Green nested simulation — assessment

Whether Feng, Li & Zhou (2022), *"Green nested simulation via likelihood ratio:
Applications to longevity risk management"* (IME 106, 285–301) can be applied to
this desk. Assessed 2026-08-13 against `2fbe70d`.

Short answer: **not to the signal engine**, for a reason that is quantifiable
rather than a matter of taste. It ports cleanly to a *portfolio risk* engine
that does not exist yet, and the reason it fails here is itself the more
interesting result.

## What the method does

Estimating the distribution of a future value `V_τ = E[H | F_τ]` empirically is
a nested simulation: `M` outer scenarios out to a risk horizon, then `N` inner
paths from there to maturity, budget `Γ = MN`. Standard practice uses the `N`
inner paths of scenario *i* for scenario *i* only and discards them, even
though all `Γ` paths are draws from the same family, differing only in the
conditioning value.

GNS reweights instead of resimulating. By the importance-sampling identity
every pooled path can contribute to every outer scenario, carrying a likelihood
ratio `W = f(·|κ_τ) / g(·)`. Same budget, `Γ` effective paths per scenario
instead of `N`.

Three choices make it work: a **mixture sampling density**
`g = (1/M) Σ f(·|κ_τ^(i))` rather than a pairwise ratio, which is what keeps
the weights from blowing up between distant scenarios; **self-normalisation**,
biased in finite samples but consistent and much lower variance; and **Markov
telescoping**, which collapses the product of density ratios to the single step
after the horizon.

It is unbiased with an `O(Γ⁻¹)` CLT, against approximation methods whose bias
does not shrink with budget — empirically 200× to ~4,000× lower IMSE. Its
honest weakness is tail variance: outer scenarios far from the centre of the
mixture get few well-weighted paths, which is exactly where VaR lives.

## Why it does not port to the signal engine

The tempting mapping is: outer scenario = the current setup's conditioning
state, inner paths = historical instances of that detector, `H` = realised R.
Then stop partitioning history by symbol and estimate expectancy as a weighted
average over the whole library.

Three reasons that does not work here, in increasing order of severity.

**1. The cheap version of it already shipped.** Phase 2c pools every symbol's
record into a pattern prior and shrinks toward it with `weight = n/(n+k)`, `k`
measured per timeframe out of sample. Going from "partition by symbol" to "pool
everything" is the large move and it is already banked — 15m expectancy
prediction went from r = 0.03 to r = 0.30. What GNS adds on top is only the
difference between a *scalar* shrinkage weight and a *state-dependent* one.

**2. The binding constraint is information, not compute.** GNS converts
simulation effort into precision at fixed budget: you can always generate more
inner paths, they are merely expensive. Our inner paths are historical and
capped at 400 bars per symbol by the upstream feed. Reweighting redistributes
the information already present; it cannot manufacture more. The method's
central trade is unavailable.

**3. Estimating the density degenerates in our dimension — this is the fatal
one.** There is no generative model for market state, so `f` would have to be
fitted over the conditioning features, at which point the weights are kernel
similarities and the method has become Hong–Juneja–Liu with a bandwidth problem.

`SignalContext` carries eight features. At 15m there are ~5,265 resolved
setups. Holding 10% of the data in a neighbourhood in *d* dimensions needs edge
length `0.1^(1/d)`; at `d = 8` that is **0.75 — three quarters of the range in
every dimension**. The neighbourhood is nearly the whole space and the weights
flatten toward uniform.

[**green-simulation-limits**](https://github.com/Matr1xOw/green-simulation-limits)
measures what that costs, on a toy where the answer is known in closed form so
IMSE is exact. It began as a script in this repo and was split out, because it
shares no code, no data and no audience with a trading desk. Budget 4,000, 40
trials, conditioning embedded in *d* dimensions of which only the first drives
the payoff:

| d | standard nested | GNS, known *f* | GNS, kernel | pooled mean |
| --- | --- | --- | --- | --- |
| 1 | 0.0141 | **0.0002** | 0.0010 | 0.1678 |
| 2 | 0.0135 | 0.0001 | 0.0030 | 0.1688 |
| 4 | 0.0145 | 0.0001 | 0.0090 | 0.1785 |
| 8 | 0.0141 | 0.0001 | **0.0135** | 0.1802 |

With `f` known, GNS is ~100× better than standard nested simulation — the
paper's headline, reproduced. Estimating `f` costs a factor of five at `d = 1`
and **the entire advantage by `d = 8`**, where GNS-kernel and plain nested
simulation are the same number.

An earlier draft of this document claimed the kernel estimator "provably
converges to the unweighted pooled mean". The measurement says that is too
strong at this budget — at `d = 8` it still beats the pooled mean by an order
of magnitude, so some conditioning survives. The correct and still decisive
statement is that **it loses everything it was supposed to buy**: by eight
dimensions you have paid for a likelihood-ratio scheme and are getting naive
nested simulation.

It also gives up the property GNS was selling. Its advantage over Taylor
approximation is that it is unbiased while the approximation's bias does not
shrink with budget. An estimated density reintroduces bias of unknown sign and
magnitude — worse than Taylor's, which can at least be bounded.

**And the quantity is not worth estimating better anyway.** The placebo and
decile harnesses found that the detectors do not beat matched random entries
(−0.050R at 15m) and the score does not rank what they find (decile spread
−0.214R, inverted). A better estimator of `E[R | state]` is a better estimate of
something measured not to vary usefully with state. See
[`engine-roadmap.md`](engine-roadmap.md).

## What survives regardless

**The payoff cache.** Realised outcomes are fixed history: a setup triggering at
bar *T* has its outcome determined by bars after *T*, which never change, so
cached rows stay valid even as the 400-bar window rolls. `poolingUnits`
currently replays all eleven detectors over every symbol on every scan, ~1.6s
CPU per slice. Keyed on `(symbol, timeframe, detector, trigger timestamp)`, a
rescan computes almost nothing. This is the green-simulation half rather than
the nested half, it needs no likelihood ratios at all, and it is what unblocks
universe expansion — a sweep currently costs `ceil(universe / 40) × 2` minutes.

**Effective sample size as a gate.** `ESS = 1/Σ W̄ⱼ²` is a better veto than
`VETO_MIN_SAMPLE`'s raw count of 10, and it applies to the scalar shrinkage
estimator already shipped: it says whether the prior or the symbol's own record
is carrying the estimate. Small, well-defined, worth doing.

## Where it would actually apply

The preconditions are: a **known** parametric conditional density, **expensive**
inner simulation, many outer scenarios sharing one family of conditional laws,
and a **compute-bound** rather than data-bound budget. The signal engine fails
the first and last. A portfolio risk engine satisfies all four, because the
model is *specified* rather than inferred — `f` is known by construction, which
is precisely what dissolves the fatal objection above.

Nothing has been built. The shape would be: outer scenarios are draws of market
state at a risk horizon, inner paths run to position exit, and the output is
VaR or P(drawdown) on the open book. The appeal is the paper own closing hook —
reuse across experiments identical but for their initial inputs — which is what
happens every time a position is edited. The scenarios shift, the path library
does not. Reweight, do not resimulate.

## The research question

The gap is real and worth putting to the author: **what does green simulation
look like when the conditional density is estimated rather than known?**

Sharpened by the table above, it is more specific than it first appears. The
mixture denominator is what tames the likelihood ratio and gives GNS its
variance control — and the mixture denominator is exactly what cannot be
estimated reliably in moderate dimension. So the variance control and the
dimensionality problem are not two limitations, they are the same limitation
seen from two sides.

The contribution is the crossover: **the dimension at which an estimated
density costs more than the reuse gains.** Here it is somewhere between four
and eight for a budget of 4,000, and it will move with budget, bandwidth rule
and how much of the conditioning is actually informative. None of that is in
the paper, which never needs it because Lee-Carter hands it a closed form.

The table is reproduced by
[green-simulation-limits](https://github.com/Matr1xOw/green-simulation-limits),
which carries the full write-up of the result and the control conditions that
make it trustworthy.
