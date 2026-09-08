"use client";

import { useEffect } from "react";
import { useCryptoStore } from "@/store/crypto-store";
import type { AssetSnapshot } from "@/lib/market-data";

/** Fetches the market snapshot once on mount and seeds the store. */
export function MarketDataLoader() {
  const setMarket = useCryptoStore((s) => s.setMarket);
  const assets = useCryptoStore((s) => s.assets);

  useEffect(() => {
    if (assets.length > 0) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        if (!res.ok) throw new Error("market fetch failed");
        const data = (await res.json()) as { assets: AssetSnapshot[]; source: "coingecko" | "model"; updatedAt: number };
        if (!cancelled) setMarket(data.assets, data.source, data.updatedAt);
      } catch (err) {
        console.error("market load failed", err);
        if (!cancelled) useCryptoStore.getState().setLoadingMarket(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assets.length, setMarket]);

  return null;
}
