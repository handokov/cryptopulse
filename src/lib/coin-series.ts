/**
 * Series provider for ANY top-100 coin (not just the 8 tracked assets).
 * Fetches CoinGecko snapshot fields + a 90-day daily price series and
 * converts them into an AssetSnapshot-compatible object so the signal
 * polygon, projection lab and analysis engine can consume them unchanged.
 *
 * Falls back to the same seeded backward-walk model used by the core
 * assets (anchored at the live price) when deep history is unavailable,
 * so every coin on the board stays traceable even under rate limits.
 */

import { generateHistory, hashString, type AssetSnapshot } from "@/lib/market-data";
import { findTopCoin } from "@/lib/top100";

export interface CoinSnapshot extends AssetSnapshot {
  coingeckoId: string;
  source: "coingecko" | "model";
}

const PALETTE = [
  "#10b981", "#34d399", "#f59e0b", "#fbbf24", "#2dd4bf",
  "#a3e635", "#4ade80", "#fb923c", "#84cc16", "#f97316",
];

const TTL_MS = 600_000; // 10 min per coin

interface CacheEntry {
  snap: CoinSnapshot;
  ts: number;
}

const g = globalThis as unknown as {
  __cpCoinCache?: Map<string, CacheEntry>;
  __cpCoinLastGood?: Map<string, CacheEntry>;
};
const cache = (g.__cpCoinCache ??= new Map<string, CacheEntry>());
const lastGood = (g.__cpCoinLastGood ??= new Map<string, CacheEntry>());

async function cgFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface CGMarketItem {
  id: string;
  symbol: string | null;
  name: string | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
  market_cap: number | null;
}

/** Downsamples CoinGecko half-hourly market_chart prices into daily UTC closes. */
function toDailyCloses(prices: Array<[number, number]>): number[] {
  const byDay = new Map<string, number>();
  for (const [ts, price] of prices) {
    if (typeof ts !== "number" || typeof price !== "number") continue;
    byDay.set(new Date(ts).toISOString().slice(0, 10), price);
  }
  return [...byDay.values()];
}

/**
 * Builds a full AssetSnapshot for an arbitrary CoinGecko coin id.
 * Returns null only when even the live snapshot fields are unavailable.
 */
export async function getCoinSnapshot(coingeckoId: string): Promise<CoinSnapshot | null> {
  const id = coingeckoId.toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(id)) return null;

  const now = Date.now();
  const cached = cache.get(id);
  if (cached && now - cached.ts < TTL_MS) return cached.snap;

  const markets = (await cgFetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&price_change_percentage=24h`
  )) as CGMarketItem[] | null;
  const meta = Array.isArray(markets) ? markets[0] : undefined;

  // Fallback source: the cached top-100 board (keeps tracing alive under
  // CoinGecko rate limits, mirroring the site's degradation philosophy).
  let fbSymbol = "";
  let fbName = "";
  let fbPrice = 0;
  let fbChange24h: number | null = null;
  let fbVolume = 0;
  let fbCap = 0;
  if (!meta || !meta.current_price || meta.current_price <= 0) {
    const board = findTopCoin(id);
    if (!board) {
      const good = lastGood.get(id);
      return good ? good.snap : null;
    }
    fbSymbol = board.symbol;
    fbName = board.name;
    fbPrice = board.price;
    fbChange24h = board.change24h;
    fbVolume = board.volume24h;
    fbCap = board.marketCap;
  }

  const symbol = String(meta?.symbol ?? fbSymbol ?? id).toUpperCase();
  const name = String(meta?.name ?? fbName ?? symbol);
  const price = meta?.current_price && meta.current_price > 0 ? meta.current_price : fbPrice;
  const color = PALETTE[hashString(id) % PALETTE.length];

  let history: number[] = [];
  let source: "coingecko" | "model" = "coingecko";

  const chart = (await cgFetch(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=90`
  )) as { prices?: Array<[number, number]> } | null;
  const daily = chart?.prices ? toDailyCloses(chart.prices) : [];

  if (daily.length >= 30) {
    history = daily;
  } else {
    // Seeded backward walk anchored at the live price — same model as core assets.
    const pseudoDef = {
      symbol,
      name,
      coingeckoId: id,
      basePrice: price,
      dailyVol: 0.05,
      drift: 0.0008,
      baseVolume24h: meta?.total_volume ?? fbVolume ?? 10_000_000,
      accent: color,
    };
    history = generateHistory(pseudoDef, price, 90);
    source = "model";
  }

  const snap: CoinSnapshot = {
    symbol,
    name,
    coingeckoId: id,
    price,
    change24h:
      meta?.price_change_percentage_24h ??
      fbChange24h ??
      (history.length > 1 ? (history[history.length - 1] / history[history.length - 2] - 1) * 100 : 0),
    volume24h: meta?.total_volume ?? fbVolume,
    marketCap: meta?.market_cap ?? fbCap,
    history,
    color,
    source,
  };

  cache.set(id, { snap, ts: now });
  lastGood.set(id, { snap, ts: now });
  return snap;
}
