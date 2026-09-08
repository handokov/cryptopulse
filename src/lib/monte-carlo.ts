/**
 * Monte Carlo uncertainty band + drift shrinkage.
 *
 * WHY (the honest-statistics upgrade over the analytic ±σ̂√t band):
 *   1. The analytic band assumes i.i.d. NORMAL daily returns. Crypto returns
 *      are fat-tailed and volatility-clustered, so ±1σ̂√t understates tail
 *      risk — a 45-day ±1σ analytic band is roughly a 50–60% zone in
 *      practice, not 68%.
 *   2. The drift μ̂ estimated from ~30 days is dominated by noise:
 *      SE(μ̂) = σ̂/√n ≈ σ̂/5.5 for n=30 — often the same size as μ̂ itself.
 *      Extrapolating raw μ̂ over long horizons extrapolates noise.
 *
 * WHAT
 *   - shrinkDrift: μ̂_eff = μ̂·n/(n+k), k=30 — pulls the raw estimate toward
 *     zero proportionally to how little data backs it, and reports SE so the
 *     UI can show the estimation uncertainty explicitly.
 *   - bootstrapBand: resamples the asset's OWN de-meaned daily log returns
 *     (empirical residuals — fat tails preserved) along a drift path:
 *         r_step = μ_eff + residual × volMult
 *         P_t    = P0 · exp(Σ r_step)
 *     over `paths` simulated trajectories, then reports the nearest-rank
 *     P10 / P50 / P90 across paths at every timestep.
 *
 * DETERMINISM: seeded PRNG (mulberry32) — identical inputs produce identical
 * bands, so no flicker while dragging sliders and every number on screen
 * stays reproducible/verifiable (the app's core ethos).
 *
 * Consumers: Projection Lab only. The server analysis engine keeps its own
 * drift pipeline — centralizing that is a separate, later task.
 */

export interface ShrinkageResult {
  /** Drift after shrinkage: μ̂·n/(n+k). */
  muEff: number;
  /** Standard error of the RAW estimate: σ̂/√n. */
  se: number;
  /** Multiplicative shrink applied: n/(n+k). */
  shrinkFactor: number;
  /** Raw window size n used (echoed for display). */
  n: number;
  /** Shrinkage constant k (echoed for display). */
  k: number;
}

/**
 * Shrink a historical drift estimate toward zero and quantify its noise.
 * k=30 means a 30-day window keeps half its weight, a 90-day window ~75%.
 */
export function shrinkDrift(muHist: number, sdDaily: number, n: number, k = 30): ShrinkageResult {
  const nn = Math.max(Math.round(n), 1);
  const shrinkFactor = nn / (nn + k);
  return {
    muEff: muHist * shrinkFactor,
    se: sdDaily / Math.sqrt(nn),
    shrinkFactor,
    n: nn,
    k,
  };
}

export interface McBandResult {
  /** 10th percentile path across simulations, length = horizonDays. */
  p10: number[];
  /** Median path (drift-only expectation under bootstrap noise). */
  p50: number[];
  /** 90th percentile path. */
  p90: number[];
  /** Number of simulated paths (echoed for display). */
  paths: number;
}

export interface BootstrapBandParams {
  p0: number;
  /** Effective (already-shrunk) total drift per day, log space. */
  muDaily: number;
  /** De-meaned historical daily log returns — the resampling pool. */
  residuals: number[];
  /** User volatility multiplier (scales sampled residuals). */
  volMult: number;
  horizonDays: number;
  paths?: number;
  seed?: number;
}

/** Nearest-rank percentile of an ascending-sorted array. */
function pct(sorted: Float64Array, q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

/** mulberry32 — tiny deterministic PRNG (quality is fine for resampling). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap percentile band. 1000 paths × up to 180 steps ≈ 180k RNG draws —
 * a few milliseconds in the browser, safe inside a useMemo.
 */
export function bootstrapBand(params: BootstrapBandParams): McBandResult {
  const { p0, muDaily, residuals, volMult, horizonDays } = params;
  const paths = Math.max(params.paths ?? 1000, 1);
  const seed = params.seed ?? 20260908;

  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];

  // Degenerate guard: no residuals → flat drift-only "band".
  if (residuals.length === 0) {
    for (let t = 1; t <= horizonDays; t++) {
      const v = p0 * Math.exp(muDaily * t);
      p10.push(v);
      p50.push(v);
      p90.push(v);
    }
    return { p10, p50, p90, paths };
  }

  const rand = mulberry32(seed);
  const cum = new Float64Array(paths); // persistent cumulative log-return per path
  const col = new Float64Array(paths); // per-step prices, sorted in place

  for (let t = 1; t <= horizonDays; t++) {
    for (let p = 0; p < paths; p++) {
      const residual = residuals[(rand() * residuals.length) | 0];
      cum[p] += muDaily + residual * volMult;
      col[p] = p0 * Math.exp(cum[p]);
    }
    col.sort();
    p10.push(pct(col, 0.1));
    p50.push(pct(col, 0.5));
    p90.push(pct(col, 0.9));
  }

  return { p10, p50, p90, paths };
}
