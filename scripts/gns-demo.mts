/**
 * Green nested simulation, and where it stops helping.
 *
 * Feng, Li & Zhou (2022) reuse inner simulation paths across outer scenarios
 * by reweighting with a likelihood ratio f(x|κ)/g(x). It works because the
 * conditional density is *known* — their risk factor is a random walk with
 * drift, so f is a closed-form normal.
 *
 * Applying it to anything without a generative model means estimating f, at
 * which point the weights are kernel similarities over the conditioning state.
 * This measures what that costs, on a toy where the exact answer is available
 * in closed form.
 *
 *   npx tsx scripts/gns-demo.mts
 *
 * No market data, no dev server, no network. Everything below is synthetic so
 * the truth is known and IMSE is exact rather than estimated.
 *
 * The setup mirrors the paper's K-call case: a random walk with drift, a
 * call-style payoff at maturity, and V(κ) = E[H | κ] wanted across many outer
 * scenarios. The one addition is that the conditioning state is embedded in d
 * dimensions, only the first of which drives the payoff — which is the
 * situation you are in whenever you have features and do not know which of
 * them matter.
 */

const MU = 0.02;
const SIGMA = 1;
const STRIKE = 0.5;
/** Outer scenarios, inner paths each. Budget Γ = M × N. */
const M = 200;
const N = 20;
const TRIALS = 40;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

/** Box-Muller, so the toy's normals are actually normal. */
function normals(next: () => number) {
  return () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
}

const pdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Abramowitz & Stegun 7.1.26 — plenty for a demo. */
function cdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

const payoff = (x: number) => Math.max(x - STRIKE, 0);

/** Exact E[max(X-K,0)] for X ~ N(m, σ²) — Bachelier. */
function truth(kappa: number): number {
  const m = kappa + MU;
  const z = (m - STRIKE) / SIGMA;
  return (m - STRIKE) * cdf(z) + SIGMA * pdf(z);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

/** Self-normalised weighted average. */
function weightedMean(values: number[], weights: number[]): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    total += weights[i];
    sum += weights[i] * values[i];
  }
  return total > 0 ? sum / total : NaN;
}

type Trial = {
  /** Outer scenarios: the conditioning value that matters. */
  kappa: number[];
  /** Irrelevant conditioning features, one row per scenario. */
  noise: number[][];
  /** Pooled inner draws and their payoffs, tagged with their source scenario. */
  draws: number[];
  payoffs: number[];
  source: number[];
};

function simulate(seed: number, dimensions: number): Trial {
  const next = normals(rng(seed));
  const kappa: number[] = [];
  const noise: number[][] = [];
  for (let i = 0; i < M; i++) {
    kappa.push(next());
    noise.push(Array.from({ length: dimensions - 1 }, () => next()));
  }

  const draws: number[] = [];
  const payoffs: number[] = [];
  const source: number[] = [];
  for (let i = 0; i < M; i++) {
    for (let n = 0; n < N; n++) {
      const x = kappa[i] + MU + SIGMA * next();
      draws.push(x);
      payoffs.push(payoff(x));
      source.push(i);
    }
  }
  return { kappa, noise, draws, payoffs, source };
}

/** Integrated mean squared error against the closed form. */
const imse = (estimates: number[], kappa: number[]) =>
  mean(estimates.map((e, i) => (e - truth(kappa[i])) ** 2));

/** Standard nested simulation: each scenario keeps only its own N paths. */
function standard(t: Trial): number[] {
  return t.kappa.map((_, i) => {
    const own: number[] = [];
    for (let j = 0; j < t.draws.length; j++) {
      if (t.source[j] === i) own.push(t.payoffs[j]);
    }
    return mean(own);
  });
}

/** GNS with the density known, as in the paper. */
function gnsKnown(t: Trial): number[] {
  // g(x) = (1/M) Σ f(x | κ_i), the equal mixture of every scenario's law.
  const mixture = t.draws.map((x) => {
    let total = 0;
    for (const k of t.kappa) total += pdf((x - k - MU) / SIGMA) / SIGMA;
    return total / M;
  });

  return t.kappa.map((k) => {
    const weights = t.draws.map(
      (x, j) => pdf((x - k - MU) / SIGMA) / SIGMA / mixture[j],
    );
    return weightedMean(t.payoffs, weights);
  });
}

/**
 * GNS with the density estimated: kernel similarity over the conditioning
 * state, which is what the likelihood ratio becomes when f is unknown.
 */
function gnsKernel(t: Trial, dimensions: number): number[] {
  const state = (i: number) => [t.kappa[i], ...t.noise[i]];
  // Silverman-style bandwidth. The exponent is where dimension does its damage.
  const h = Math.pow(M * N, -1 / (dimensions + 4));

  return t.kappa.map((_, i) => {
    const target = state(i);
    const weights = t.source.map((s) => {
      const from = state(s);
      let squared = 0;
      for (let d = 0; d < dimensions; d++) squared += (target[d] - from[d]) ** 2;
      return Math.exp(-0.5 * squared / (h * h));
    });
    return weightedMean(t.payoffs, weights);
  });
}

/** What a degenerate kernel collapses to: ignore the conditioning entirely. */
function pooled(t: Trial): number[] {
  const flat = mean(t.payoffs);
  return t.kappa.map(() => flat);
}

function main() {
  console.log(`\nGreen nested simulation — known vs estimated density`);
  console.log(`M = ${M} outer, N = ${N} inner, budget ${M * N}, ${TRIALS} trials\n`);
  console.log("  d   standard   GNS known   GNS kernel   pooled mean");
  console.log("  " + "─".repeat(56));

  for (const d of [1, 2, 4, 8]) {
    const rows = { standard: [] as number[], known: [] as number[], kernel: [] as number[], flat: [] as number[] };
    for (let trial = 0; trial < TRIALS; trial++) {
      const t = simulate(1_000 + trial * 7, d);
      rows.standard.push(imse(standard(t), t.kappa));
      rows.known.push(imse(gnsKnown(t), t.kappa));
      rows.kernel.push(imse(gnsKernel(t, d), t.kappa));
      rows.flat.push(imse(pooled(t), t.kappa));
    }
    const cell = (v: number[]) => mean(v).toFixed(4).padStart(11);
    console.log(
      `  ${d}` + cell(rows.standard) + cell(rows.known) + cell(rows.kernel) + cell(rows.flat),
    );
  }

  console.log(
    "\nIMSE against the closed form, lower is better. `standard` and `GNS known`\n" +
      "do not use the conditioning features, so their columns do not move with d.\n" +
      "Watch `GNS kernel` climb toward `pooled mean`: that is the method losing\n" +
      "its conditioning as irrelevant dimensions are added.\n",
  );
}

main();
