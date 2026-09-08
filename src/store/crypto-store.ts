"use client";

import { create } from "zustand";
import type { FactorKey } from "@/lib/analysis-engine";
import type { AssetSnapshot } from "@/lib/market-data";
import type { AnalysisResult } from "@/lib/analysis-engine";

export interface FactorMeta {
  key: FactorKey;
  label: string;
  hint: string;
}

export const FACTOR_META: FactorMeta[] = [
  { key: "momentum", label: "Momentum", hint: "RSI / rate-of-change regime" },
  { key: "trend", label: "Trend", hint: "Moving-average structure" },
  { key: "volume", label: "Volume", hint: "Participation & flow" },
  { key: "volatility", label: "Volatility", hint: "Realized risk envelope" },
  { key: "sentiment", label: "Sentiment", hint: "News & narrative tone" },
  { key: "liquidity", label: "Liquidity", hint: "Depth & spreads" },
];

export type Factors = Record<FactorKey, number>;

interface CryptoState {
  /* market data */
  assets: AssetSnapshot[];
  dataSource: "coingecko" | "model" | null;
  updatedAt: number | null;
  loadingMarket: boolean;
  setMarket: (assets: AssetSnapshot[], source: "coingecko" | "model", updatedAt: number) => void;
  setLoadingMarket: (v: boolean) => void;

  /* selection + one-shot pulse token fired on query/select */
  selected: string;
  selectAsset: (symbol: string) => void;
  pulseToken: number;
  firePulse: () => void;

  /* vertex lab factors (0-100 each) */
  factors: Factors;
  setFactor: (key: FactorKey, value: number) => void;
  setAllFactors: (f: Factors) => void;

  /* projection sliders */
  horizon: number; // days 30-180
  driftMod: number; // -0.8% .. +0.8% daily
  volMult: number; // 0.5 .. 2.0
  waveAmp: number; // 0 .. 5% of price
  wavePeriod: number; // 7 .. 60 days
  setSlider: (key: "horizon" | "driftMod" | "volMult" | "waveAmp" | "wavePeriod", value: number) => void;

  /* analysis */
  analysis: AnalysisResult | null;
  analyzing: boolean;
  revealedSteps: number;
  setAnalyzing: (v: boolean) => void;
  setAnalysis: (r: AnalysisResult) => void;
  revealStep: () => void;
  resetReveal: () => void;
}

const DEFAULT_FACTORS: Factors = {
  momentum: 58,
  trend: 62,
  volume: 55,
  volatility: 45,
  sentiment: 60,
  liquidity: 66,
};

export const useCryptoStore = create<CryptoState>((set) => ({
  assets: [],
  dataSource: null,
  updatedAt: null,
  loadingMarket: true,
  setMarket: (assets, source, updatedAt) => set({ assets, dataSource: source, updatedAt, loadingMarket: false }),
  setLoadingMarket: (v) => set({ loadingMarket: v }),

  selected: "BTC",
  selectAsset: (symbol) =>
    set((s) => (s.selected === symbol ? {} : { selected: symbol, pulseToken: s.pulseToken + 1 })),
  pulseToken: 0,
  firePulse: () => set((s) => ({ pulseToken: s.pulseToken + 1 })),

  factors: { ...DEFAULT_FACTORS },
  setFactor: (key, value) => set((s) => ({ factors: { ...s.factors, [key]: value } })),
  setAllFactors: (f) => set({ factors: { ...f } }),

  horizon: 45,
  driftMod: 0.1,
  volMult: 1.0,
  waveAmp: 1.5,
  wavePeriod: 21,
  setSlider: (key, value) => set({ [key]: value } as Partial<CryptoState>),

  analysis: null,
  analyzing: false,
  revealedSteps: 0,
  setAnalyzing: (v) => set({ analyzing: v }),
  setAnalysis: (r) => set({ analysis: r, revealedSteps: 0 }),
  revealStep: () => set((s) => ({ revealedSteps: Math.min(s.revealedSteps + 1, s.analysis?.steps.length ?? 0) })),
  resetReveal: () => set({ revealedSteps: 0 }),
}));
