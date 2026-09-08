"use client";

import { useMemo } from "react";
import { useCryptoStore } from "@/store/crypto-store";
import { logReturns, rsi, sma, stdev } from "@/lib/indicators";

export interface AssetSignals {
  momentum: number; // 0-100 from RSI
  trend: number; // 0-100 from SMA bias
  volatility: number; // 0-100, higher = calmer
  hasData: boolean;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(Math.max(x, lo), hi);

/** Derives live indicator-based factor signals for the selected asset. */
export function useAssetSignals(symbol: string): AssetSignals {
  const assets = useCryptoStore((s) => s.assets);

  return useMemo(() => {
    const asset = assets.find((a) => a.symbol === symbol);
    if (!asset || asset.history.length < 51) {
      return { momentum: 50, trend: 50, volatility: 50, hasData: false };
    }
    const series = asset.history;
    const r = rsi(series, 14) ?? 50;
    const s50 = sma(series, 50) ?? series[series.length - 1];
    const biasPct = (series[series.length - 1] / s50 - 1) * 100;
    const rets = logReturns(series);
    const volAnn = stdev(rets.slice(-30)) * Math.sqrt(365) * 100;

    return {
      momentum: clamp(((r - 50) / 50) * 50 + 50),
      trend: clamp(50 + biasPct * 8),
      volatility: clamp(100 - volAnn * 0.8),
      hasData: true,
    };
  }, [assets, symbol]);
}
