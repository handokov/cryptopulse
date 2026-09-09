/**
 * Bot strategy — pure functions, no I/O, fully deterministic.
 *
 * The composite score reuses the same statistical machinery the site shows
 * humans (log returns, stdev, cycle fit) so the bot trades exactly what the
 * dashboard explains:
 *
 *   score ∈ [−1, +1] = 0.40·trend + 0.30·momentum + 0.15·cycle + 0.15·drift
 *
 *   trend    EMA(fast) vs EMA(slow) gap, tanh-normalized
 *   momentum RSI(14) mapped around 50, tanh-normalized
 *   cycle    cycleFit position: bullish near a RISING trough, bearish near a
 *            FALLING peak, weighted by the fit's R² (0 when unusable)
 *   drift    shrunken mean log return (μ̂·n/(n+30))
 *
 * Mode presets: AGGRESSIVE enters earlier (lower threshold), aims higher
 * (bigger TP), tolerates deeper drawdown (bigger SL) and trades more often.
 */

import { logReturns, stdev, cycleFit } from "@/lib/indicators";
import { BARS_PER_YEAR } from "./bitget-trade";

export type BotMode = "MODERATE" | "AGGRESSIVE";

export interface ModePreset {
  entryScore: number;
  exitScore: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxTradesPerDay: number;
  cooldownMin: number;
}

export const MODE_PRESETS: Record<BotMode, ModePreset> = {
  MODERATE: {
    entryScore: 0.55,
    exitScore: 0.55,
    takeProfitPct: 1.8,
    stopLossPct: 1.2,
    maxTradesPerDay: 4,
    cooldownMin: 45,
  },
  AGGRESSIVE: {
    entryScore: 0.4,
    exitScore: 0.4,
    takeProfitPct: 2.6,
    stopLossPct: 1.8,
    maxTradesPerDay: 8,
    cooldownMin: 15,
  },
};

export interface BotSignal {
  score: number;
  trend: number;
  momentum: number;
  cycle: number;
  cycleR2: number;
  cyclePosPct: number | null;
  cycleRising: boolean | null;
  /** Shrunken mean log return per bar, in percent. */
  driftPctPerBar: number;
  /** Annualized volatility in percent. */
  volAnnPct: number;
  bars: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const tanh = (x: number) => Math.tanh(x);

function ema(series: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}

/** Wilder RSI on closes. */
function rsi(series: number[], period = 14): number {
  if (series.length < period + 2) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  for (let i = period + 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL <= 1e-12) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function computeBotSignal(closes: number[]): BotSignal {
  if (closes.length < 40) throw new Error("need ≥40 bars");
  const rets = logReturns(closes);

  /* Trend: relative EMA gap; 1% gap on 4H bars ≈ saturated. */
  const emaFast = ema(closes, 20);
  const emaSlow = ema(closes, 60);
  const trend = tanh(((emaFast - emaSlow) / emaSlow) * 200);

  /* Momentum. */
  const r = rsi(closes, 14);
  const momentum = tanh((r - 50) / 18);

  /* Cycle position — same cycleFit the Projection Lab badge shows. */
  let cycle = 0;
  let cycleR2 = 0;
  let cyclePosPct: number | null = null;
  let cycleRising: boolean | null = null;
  const fit = closes.length >= 40 ? cycleFit(closes, 6, 30) : null;
  if (fit) {
    cycleR2 = fit.r2;
    cyclePosPct = fit.posPct;
    cycleRising = fit.rising;
    if (fit.posPct < 0 && fit.rising) cycle = fit.r2 * 0.8; // trough behind us, climbing
    else if (fit.posPct > 0 && !fit.rising) cycle = -fit.r2 * 0.8; // peak behind us, rolling over
  }

  /* Drift: last 30 bars, shrunk (a 30-bar mean is mostly noise). */
  const w = rets.slice(-30);
  const muRaw = w.reduce((a, b) => a + b, 0) / (w.length || 1);
  const muEff = muRaw * (w.length / (w.length + 30));
  const drift = tanh(muEff * 1500);

  /* Volatility: annualized from the last 90 bars; extreme regimes dampen. */
  const sd = stdev(rets.slice(-90));
  const volAnnPct = sd * Math.sqrt(BARS_PER_YEAR) * 100;

  let score = 0.4 * trend + 0.3 * momentum + 0.15 * cycle + 0.15 * drift;
  if (volAnnPct > 400) score *= 0.5; // chaos filter — halve conviction
  score = clamp(score, -1, 1);

  return {
    score: Math.round(score * 1000) / 1000,
    trend: Math.round(trend * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    cycle: Math.round(cycle * 1000) / 1000,
    cycleR2: Math.round(cycleR2 * 1000) / 1000,
    cyclePosPct,
    cycleRising,
    driftPctPerBar: muEff * 100,
    volAnnPct,
    bars: closes.length,
  };
}

/** Decision layer — entry/exit per mode preset against a live price. */
export function shouldEnter(signal: BotSignal, mode: BotMode): boolean {
  return signal.score >= MODE_PRESETS[mode].entryScore;
}

export type ExitKind = "take-profit" | "stop-loss" | "trail-stop" | "signal-flip" | null;

export function shouldExit(
  signal: BotSignal,
  entryPrice: number,
  price: number,
  targetPrice: number,
  stopPrice: number,
  mode: BotMode,
  effStopPrice?: number
): { exit: ExitKind; reason: string } {
  if (price >= targetPrice) return { exit: "take-profit", reason: `price ≥ target ${targetPrice.toPrecision(6)}` };
  const stop = typeof effStopPrice === "number" && effStopPrice > 0 ? effStopPrice : stopPrice;
  if (price <= stop) return { exit: "stop-loss", reason: `price ≤ stop ${stop.toPrecision(6)}` };
  if (signal.score <= -MODE_PRESETS[mode].exitScore) {
    return { exit: "signal-flip", reason: `score ${signal.score.toFixed(2)} ≤ −${MODE_PRESETS[mode].exitScore.toFixed(2)}` };
  }
  const pnlPct = ((price - entryPrice) / entryPrice) * 100;
  return { exit: null, reason: `hold (pnl ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` };
}

/* ------------------------------------------------------------------ */
/* VOL exit style — bands scale with each asset's own volatility       */
/*                                                                     */
/* A fixed 1.2 % stop is 0.41σ for an asset that moves 2.9 % per 4H    */
/* bar (LIT) — the stop sits INSIDE routine noise and gets hit by      */
/* ordinary wicks. The fix: express both bands in units of σ, the      */
/* stdev of the last 90 4H log returns (the same window the engine's   */
/* volatility figure uses).                                            */
/*                                                                     */
/*   σref = 1.5 %/bar  (an asset this calm gets the preset verbatim)   */
/*   SL    = preset.stopLossPct    · σ / σref      clamp 1..12 %        */
/*   TP    = preset.takeProfitPct  · σ / σref      clamp 1.5..18 %      */
/*   trail arm   = +1σ unrealized (the move has left the noise band)   */
/*   trail dist  = SL band below the highest price since entry         */
/*                 (worst-case locked profit ≈ +0.2σ > 0)               */
/* ------------------------------------------------------------------ */

/** σ of a calm asset maps to the exact mode preset. */
export const SIGMA_REF_PCT = 1.5;

export interface VolBands {
  /** Per-4H-bar stdev of log returns, in percent. */
  sigmaPct: number;
  tpPct: number;
  slPct: number;
  /** Unrealized gain (%) that arms the trailing stop. */
  trailArmPct: number;
  /** Trailing distance (%) below the highest price since entry. */
  trailPct: number;
}

const clampPct = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Volatility-scaled exit bands for a mode. Pure — same inputs, same bands. */
export function volBands(sigmaPct: number, mode: BotMode): VolBands {
  const preset = MODE_PRESETS[mode];
  const sl = clampPct(preset.stopLossPct * (sigmaPct / SIGMA_REF_PCT), 1.0, 12.0);
  const tp = clampPct(preset.takeProfitPct * (sigmaPct / SIGMA_REF_PCT), 1.5, 18.0);
  return {
    sigmaPct,
    tpPct: tp,
    slPct: sl,
    trailArmPct: sigmaPct,
    trailPct: sl,
  };
}
