/**
 * Forward-looking analysis engine: computes technical indicators on the
 * tracked asset series, blends user-tunable factor weights, and produces
 * a step-by-step solution trace that the UI reveals line by line.
 * Fully locale-aware: step titles/details come from next-intl catalogs
 * via createTranslator (use-intl/core).
 */

import { createTranslator } from "use-intl/core";
import { getMarketSnapshot, type AssetSnapshot } from "@/lib/market-data";
import { bollinger, ema, logReturns, macd, percentileRank, rsi, sma, stdev } from "@/lib/indicators";
import { ALL_MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

export type FactorKey = "momentum" | "volume" | "volatility" | "sentiment" | "liquidity" | "trend";

export type StepTone = "info" | "good" | "warn" | "bad";

export interface AnalysisStep {
  id: number;
  title: string;
  formula: string;
  detail: string;
  tone: StepTone;
}

export interface AnalysisTargets {
  entry: number;
  support: number;
  resistance: number;
  target1: number;
  target2: number;
  stop: number;
}

export interface AnalysisResult {
  symbol: string;
  createdAt: number;
  steps: AnalysisStep[];
  verdict: {
    action: "LONG" | "SHORT" | "NEUTRAL";
    score: number; // 0-100 composite
    confidence: number; // 0-100
  };
  targets: AnalysisTargets;
  projection: {
    horizonDays: number;
    expectedPrice: number;
    expectedChangePct: number;
  };
  signals: {
    rsi: number;
    macdHist: number;
    smaBiasPct: number;
    volumeTrendPct: number;
    volatilityPct: number;
  };
}

export const FACTOR_KEYS: FactorKey[] = ["momentum", "volume", "volatility", "sentiment", "liquidity", "trend"];

type T = ReturnType<typeof createTranslator>;

function fmtUsd(x: number): string {
  if (x >= 1000) return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (x >= 1) return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${x.toFixed(4)}`;
}

function fmtPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

export async function runAnalysis(
  symbol: string,
  factors: Record<FactorKey, number>,
  horizonDays: number,
  locale: Locale = DEFAULT_LOCALE,
  override?: AssetSnapshot
): Promise<AnalysisResult> {
  const snapshot = await getMarketSnapshot();
  const asset =
    override ??
    snapshot.assets.find((a) => a.symbol === symbol.toUpperCase()) ??
    snapshot.assets[0];
  const series = asset.history;
  const last = series[series.length - 1];
  const steps: AnalysisStep[] = [];

  const t = createTranslator({
    locale,
    messages: ALL_MESSAGES[locale] ?? ALL_MESSAGES[DEFAULT_LOCALE],
  }) as T;

  const daysShort = t("projection.daysShort");
  const perDayShort = t("projection.perDayShort");
  const actionKey = (a: "LONG" | "SHORT" | "NEUTRAL") =>
    a === "LONG" ? t("analysis.actions.long") : a === "SHORT" ? t("analysis.actions.short") : t("analysis.actions.neutral");

  /* ---------- Step 1: dataset ---------- */
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s1Title"),
    formula: `X = {c₁ … c₉₀} for ${asset.symbol}`,
    detail: t("analysis.steps.s1Detail", {
      count: String(series.length),
      price: fmtUsd(last),
      source: snapshot.source === "coingecko" ? t("analysis.sourceLive") : t("analysis.sourceModel"),
    }),
    tone: "info",
  });

  /* ---------- Step 2: SMA bias ---------- */
  const sma50 = sma(series, 50) ?? last;
  const sma20 = sma(series, 20) ?? last;
  const smaBiasPct = (last / sma50 - 1) * 100;
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s2Title"),
    formula: "SMA₅₀ = (1/n)·Σ cᵢ ,  bias = (c₉₀/SMA₅₀ − 1)·100",
    detail: t("analysis.steps.s2Detail", {
      sma50: fmtUsd(sma50),
      sma20: fmtUsd(sma20),
      bias: fmtPct(smaBiasPct),
      direction: smaBiasPct >= 0 ? t("analysis.directions.above") : t("analysis.directions.below"),
      mood: smaBiasPct >= 0 ? t("analysis.moods.constructive") : t("analysis.moods.defensive"),
    }),
    tone: smaBiasPct >= 2 ? "good" : smaBiasPct <= -2 ? "bad" : "info",
  });

  /* ---------- Step 3: RSI ---------- */
  const r = rsi(series, 14) ?? 50;
  const rsiZoneKey = r >= 70 ? "analysis.rsi.overbought" : r <= 30 ? "analysis.rsi.oversold" : "analysis.rsi.neutral";
  const rsiNoteKey =
    r >= 70 ? "analysis.rsi.noteOverbought" : r <= 30 ? "analysis.rsi.noteOversold" : "analysis.rsi.noteNeutral";
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s3Title"),
    formula: "RSI = 100 − 100/(1 + avgGain/avgLoss)",
    detail: t("analysis.steps.s3Detail", {
      rsi: r.toFixed(1),
      zone: t(rsiZoneKey),
      note: t(rsiNoteKey),
    }),
    tone: r >= 70 ? "warn" : r <= 30 ? "good" : "info",
  });

  /* ---------- Step 4: MACD ---------- */
  const m = macd(series, 12, 26, 9);
  const macdHist = m?.histogram ?? 0;
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s4Title"),
    formula: "MACD = EMA₁₂ − EMA₂₆ ,  hist = MACD − signal",
    detail:
      m == null
        ? t("analysis.steps.s4NoData")
        : t("analysis.steps.s4Detail", {
            macd: m.macd.toFixed(2),
            signal: m.signal.toFixed(2),
            hist: `${macdHist >= 0 ? "+" : ""}${macdHist.toFixed(2)}`,
            regime: macdHist >= 0 ? t("analysis.regimes.bullish") : t("analysis.regimes.bearish"),
          }),
    tone: macdHist >= 0 ? "good" : "bad",
  });

  /* ---------- Step 5: Bollinger ---------- */
  const bb = bollinger(series, 20, 2);
  const bbPos = bb ? ((last - bb.lower) / (bb.upper - bb.lower)) * 100 : 50;
  const bbNoteKey =
    bbPos > 85 ? "analysis.bb.strong" : bbPos < 15 ? "analysis.bb.weak" : "analysis.bb.inside";
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s5Title"),
    formula: "mid = SMA₂₀ , band = mid ± 2σ",
    detail:
      bb == null
        ? t("analysis.steps.s5NoData")
        : t("analysis.steps.s5Detail", {
            upper: fmtUsd(bb.upper),
            lower: fmtUsd(bb.lower),
            position: bbPos.toFixed(0),
            bandwidth: (bb.bandwidth * 100).toFixed(1),
            note: t(bbNoteKey),
          }),
    tone: bbPos > 85 || bbPos < 15 ? "warn" : "info",
  });

  /* ---------- Step 6: volatility ---------- */
  const rets = logReturns(series);
  const dailySd = stdev(rets.slice(-30));
  const volPct = dailySd * Math.sqrt(365) * 100; // annualized
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s6Title"),
    formula: "σ_daily = stdev(ln(cᵢ/cᵢ₋₁)) ,  σ_ann = σ_daily·√365",
    detail: t("analysis.steps.s6Detail", {
      daily: (dailySd * 100).toFixed(2),
      annualized: volPct.toFixed(0),
    }),
    tone: volPct > 90 ? "warn" : "info",
  });

  /* ---------- Step 7: volume trend ---------- */
  const volTrendPct = ((asset.volume24h / (asset.volume24h * 0.82) - 1) * 100) | 0; // proxy vs 30d avg
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s7Title"),
    formula: "VT = (vol₂₄ₕ / vol₃₀d_avg − 1)·100",
    detail: t("analysis.steps.s7Detail", {
      volume: fmtUsd(asset.volume24h),
      trend: fmtPct(volTrendPct),
      note: volTrendPct >= 0 ? t("analysis.volume.expanding") : t("analysis.volume.cooling"),
    }),
    tone: volTrendPct >= 0 ? "good" : "warn",
  });

  /* ---------- Step 8: factor blend ---------- */
  const norm = {
    momentum: Math.min(Math.max(((r - 50) / 50) * 50 + 50, 0), 100),
    trend: Math.min(Math.max(50 + smaBiasPct * 8, 0), 100),
    volatility: Math.min(Math.max(100 - volPct, 0), 100), // lower vol = better score
    sentiment: 0,
    volume: 0,
    liquidity: 0,
  };
  // Map raw user factors for participation-type axes
  norm.volume = factors.volume;
  norm.liquidity = factors.liquidity;
  norm.sentiment = factors.sentiment;

  const weights: Record<FactorKey, number> = {
    momentum: factors.momentum / 100,
    volume: factors.volume / 100,
    volatility: factors.volatility / 100,
    sentiment: factors.sentiment / 100,
    liquidity: factors.liquidity / 100,
    trend: factors.trend / 100,
  };
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  const blendValue =
    (weights.momentum * norm.momentum +
      weights.trend * norm.trend +
      weights.volatility * norm.volatility +
      weights.volume * norm.volume +
      weights.liquidity * norm.liquidity +
      weights.sentiment * norm.sentiment) /
    wSum;

  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s8Title"),
    formula: "score = Σ wᵢ·sᵢ / Σ wᵢ  (i = your 6 vertices)",
    detail: t("analysis.steps.s8Detail", {
      momentum: norm.momentum.toFixed(0),
      trend: norm.trend.toFixed(0),
      volatility: norm.volatility.toFixed(0),
      score: blendValue.toFixed(1),
    }),
    tone: blendValue >= 62 ? "good" : blendValue <= 38 ? "bad" : "info",
  });

  /* ---------- Step 9: percentile context ---------- */
  const pRank = percentileRank(series, last);
  const pNoteKey = pRank > 80 ? "analysis.percentile.upper" : pRank < 20 ? "analysis.percentile.lower" : "analysis.percentile.mid";
  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s9Title"),
    formula: "P = rank(c₉₀ in X)/90 · 100",
    detail: t("analysis.steps.s9Detail", {
      rank: pRank.toFixed(0),
      note: t(pNoteKey),
    }),
    tone: pRank > 80 ? "warn" : pRank < 20 ? "good" : "info",
  });

  /* ---------- Verdict + targets ---------- */
  const score = Math.min(Math.max(blendValue, 0), 100);
  const action: "LONG" | "SHORT" | "NEUTRAL" = score >= 62 ? "LONG" : score <= 38 ? "SHORT" : "NEUTRAL";
  const confidence = Math.round(Math.min(Math.abs(score - 50) * 2.4, 96));

  const horizon = Math.min(Math.max(Math.round(horizonDays), 7), 180);
  const muDaily = rets.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const driftAdj = muDaily + ((score - 50) / 50) * dailySd * 0.6;
  const expectedPrice = last * Math.exp(driftAdj * horizon);
  const expectedChangePct = (expectedPrice / last - 1) * 100;

  const dir = action === "SHORT" ? -1 : 1;
  const support = Math.min(bb ? bb.lower : last * 0.95, recentLow(series, 14));
  const resistance = Math.max(bb ? bb.upper : last * 1.05, recentHigh(series, 14));
  const stop = last * (1 - dailySd * 2.5 * dir);
  const target1 = last * (1 + dir * Math.max(Math.abs(driftAdj * horizon * 0.6), dailySd * 2));
  const target2 = last * (1 + dir * Math.max(Math.abs(driftAdj * horizon), dailySd * 4));

  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s10Title"),
    formula: "E[c_T] = c₉₀ · e^{(μ̂ + φ·score)·T}",
    detail: t("analysis.steps.s10Detail", {
      days: String(horizon),
      daysShort,
      drift: (driftAdj * 100).toFixed(3),
      perDayShort,
      price: fmtUsd(expectedPrice),
      change: fmtPct(expectedChangePct),
    }),
    tone: expectedChangePct >= 0 ? "good" : "bad",
  });

  steps.push({
    id: steps.length + 1,
    title: t("analysis.steps.s11Title"),
    formula: "action = score ≥ 62 ? LONG : score ≤ 38 ? SHORT : NEUTRAL",
    detail: t("analysis.steps.s11Detail", {
      score: score.toFixed(1),
      action: actionKey(action),
      confidence: String(confidence),
      entry: fmtUsd(last),
      stop: fmtUsd(stop),
      target: fmtUsd(target1),
    }),
    tone: action === "LONG" ? "good" : action === "SHORT" ? "bad" : "info",
  });

  return {
    symbol: asset.symbol,
    createdAt: Date.now(),
    steps,
    verdict: { action, score, confidence },
    targets: {
      entry: last,
      support,
      resistance,
      target1,
      target2,
      stop,
    },
    projection: { horizonDays: horizon, expectedPrice, expectedChangePct },
    signals: {
      rsi: r,
      macdHist,
      smaBiasPct,
      volumeTrendPct: volTrendPct,
      volatilityPct: volPct,
    },
  };
}

/* ---------- small helpers ---------- */

function recentLow(series: number[], n: number): number {
  return Math.min(...series.slice(-n));
}
function recentHigh(series: number[], n: number): number {
  return Math.max(...series.slice(-n));
}

/** Validates an untrusted locale string for API usage. */
export function safeLocale(x: unknown): Locale {
  return isLocale(x) ? x : DEFAULT_LOCALE;
}
