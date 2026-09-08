/**
 * Centralized projection math — the SINGLE SOURCE OF TRUTH for every
 * projected price, percentage, drift figure and formula string rendered
 * anywhere in the app (Forward Analysis engine + Projection Lab).
 *
 * Model
 * -----
 *   drift component     D(t) = P0 · e^(μ̂·t)
 *   cyclical component  W(t) = 1 + A·sin(2πt/T_p) · e^(−t/τ)   (τ = 2·T_p)
 *   full path           P(t) = D(t) · W(t)
 *   confidence band     ± e^(σ_daily·√t·volMult·0.9)   (log-space half-width)
 *
 * Invariants enforced here (components must NEVER recompute these):
 *   expectedChangePct   = ((expectedPrice − P0) / P0) · 100   ← exact standard formula
 *   driftChangePct      = ((driftPrice    − P0) / P0) · 100   ← pure e^(μ̂·T) reference
 *   waveContributionPct = expectedChangePct − driftChangePct  ← what the cycle adds
 *
 * Every formula/description string must be built from a ProjectionOutcome
 * (or the helpers below) so displayed text can never drift away from the
 * numbers used by the charts and summary cards.
 */

import { fmtPrice } from "@/lib/format";

export interface ProjectionParams {
  /** Entry price P0 (last close). */
  p0: number;
  /** Total log-drift per day μ̂ (history drift + any user/score adjustment). */
  muDaily: number;
  /** Projection horizon T in days. */
  horizonDays: number;
  /** Wave amplitude A in % of price (0 disables the cyclical term). Default 0. */
  waveAmpPct?: number;
  /** Wave period T_p in days (required when waveAmpPct > 0). */
  wavePeriodDays?: number;
  /** Daily log-return σ (enables the band). Default 0. */
  sdDaily?: number;
  /** Volatility multiplier for the band. Default 1. */
  volMult?: number;
}

export interface ProjectionOutcome {
  p0: number;
  horizonDays: number;
  /** μ̂ in log space per day. */
  muDaily: number;
  /** μ̂ formatted for display, e.g. "+0.123%/d". */
  muDailyLabel: string;
  /** Damped-wave decay constant τ = 2·T_p (0 when wave disabled). */
  tauDays: number;
  /** W(T): multiplicative cyclical component at the horizon (1 when disabled). */
  waveFactor: number;
  /** Percentage points the wave adds on top of pure drift at the horizon. */
  waveContributionPct: number;
  /** Pure drift projection P0·e^(μ̂·T) — no cyclical term. */
  driftPrice: number;
  /** ((driftPrice − P0) / P0) · 100. */
  driftChangePct: number;
  /** Final projection D(T)·W(T) — the number the chart endpoint shows. */
  expectedPrice: number;
  /** ((expectedPrice − P0) / P0) · 100 — exact, single computation. */
  expectedChangePct: number;
  /** Log-space band half-width at the horizon (for ± e^±band). */
  bandLogAtHorizon: number;
}

const TAU_PERIOD_RATIO = 2;

/** Cyclical component W(t). Returns exactly 1 when the wave is disabled. */
export function waveFactorAt(t: number, waveAmpPct: number, wavePeriodDays: number): number {
  if (!(waveAmpPct > 0) || !(wavePeriodDays > 0)) return 1;
  const tau = wavePeriodDays * TAU_PERIOD_RATIO;
  return 1 + (waveAmpPct / 100) * Math.sin((2 * Math.PI * t) / wavePeriodDays) * Math.exp(-t / tau);
}

/** One sample of the full path — the chart curve and the endpoint share this. */
export function pathPoint(
  p0: number,
  muDaily: number,
  t: number,
  waveAmpPct: number,
  wavePeriodDays: number
): number {
  return p0 * Math.exp(muDaily * t) * waveFactorAt(t, waveAmpPct, wavePeriodDays);
}

/** Log-space band half-width at time t. */
export function bandLogAt(t: number, sdDaily: number, volMult: number): number {
  return sdDaily * Math.sqrt(Math.max(t, 0)) * volMult * 0.9;
}

/**
 * The one projection computation. Charts, cards, terminal steps and
 * description strings all consume this — never re-derive elsewhere.
 */
export function projectPrice(params: ProjectionParams): ProjectionOutcome {
  const { p0, muDaily, horizonDays } = params;
  const amp = params.waveAmpPct ?? 0;
  const period = params.wavePeriodDays ?? 0;
  const sd = params.sdDaily ?? 0;
  const volMult = params.volMult ?? 1;

  const waveFactor = waveFactorAt(horizonDays, amp, period);
  const driftPrice = p0 * Math.exp(muDaily * horizonDays);
  const expectedPrice = driftPrice * waveFactor;

  // strict standard percentage — the ONLY place pct is computed
  const expectedChangePct = (expectedPrice / p0 - 1) * 100;
  const driftChangePct = (driftPrice / p0 - 1) * 100;

  return {
    p0,
    horizonDays,
    muDaily,
    muDailyLabel: fmtMu(muDaily),
    tauDays: amp > 0 && period > 0 ? period * TAU_PERIOD_RATIO : 0,
    waveFactor,
    waveContributionPct: expectedChangePct - driftChangePct,
    driftPrice,
    driftChangePct,
    expectedPrice,
    expectedChangePct,
    bandLogAtHorizon: bandLogAt(horizonDays, sd, volMult),
  };
}

/**
 * Daily path samples + confidence band for charting.
 * Endpoint value equals projectPrice(...).expectedPrice by construction.
 */
export function buildPath(
  params: ProjectionParams
): { path: number[]; upper: number[]; lower: number[] } {
  const { p0, muDaily, horizonDays } = params;
  const amp = params.waveAmpPct ?? 0;
  const period = params.wavePeriodDays ?? 0;
  const sd = params.sdDaily ?? 0;
  const volMult = params.volMult ?? 1;

  const path: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let t = 1; t <= horizonDays; t++) {
    const p = pathPoint(p0, muDaily, t, amp, period);
    const b = bandLogAt(t, sd, volMult);
    path.push(p);
    upper.push(p * Math.exp(b));
    lower.push(p * Math.exp(-b));
  }
  return { path, upper, lower };
}

/* ------------------------------------------------------------------ */
/* Centralized display builders — feed every formula/description string */
/* ------------------------------------------------------------------ */

/** Signed μ̂ label, e.g. "+0.100%/d" / "−0.554%/d". */
export function fmtMu(muDaily: number, digits = 3): string {
  const pct = muDaily * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%/d`;
}

/**
 * Substituted drift expression for formula strings, e.g.
 * "$78,688 · e^(-0.82314%×45)" — built from the exact values used in code.
 * μ̂ is printed with 5 decimals so a reader recomputing from the printed
 * string lands within price-display rounding at any horizon.
 */
export function substitutedExpr(p0: number, muDaily: number, horizonDays: number): string {
  const muPct = (muDaily * 100).toFixed(5);
  return `${fmtPrice(p0)} · e^(${muPct}%×${horizonDays})`;
}
