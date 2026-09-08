/**
 * GET /api/market/top100 — CoinGecko top-100 by market cap with a
 * module-level TTL cache and last-good fallback on upstream failure.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface TopCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume24h: number;
  sparkline: number[];
}

interface CacheEntry {
  fetchedAt: number;
  coins: TopCoin[];
}

let cache: CacheEntry | null = null;
let lastGood: CacheEntry | null = null;

const TTL = 120_000;

interface CGMarketsItem {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  image?: unknown;
  current_price?: unknown;
  price_change_percentage_24h?: unknown;
  price_change_percentage_24h_in_currency?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  market_cap?: unknown;
  total_volume?: unknown;
  sparkline_in_7d?: { price?: unknown } | null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchTop100(): Promise<TopCoin[] | null> {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h%2C7d";
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CGMarketsItem[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const coins: TopCoin[] = [];
    for (const item of data) {
      if (typeof item?.id !== "string" || !item.id) continue;
      const price = num(item.current_price, NaN);
      if (!Number.isFinite(price)) continue;
      const change24h =
        item.price_change_percentage_24h_in_currency != null
          ? num(item.price_change_percentage_24h_in_currency)
          : num(item.price_change_percentage_24h);
      const sparkRaw = item.sparkline_in_7d?.price;
      coins.push({
        id: item.id,
        symbol: String(item.symbol ?? "").toUpperCase(),
        name: String(item.name ?? item.id),
        image: String(item.image ?? ""),
        price,
        change24h,
        change7d: num(item.price_change_percentage_7d_in_currency),
        marketCap: num(item.market_cap),
        volume24h: num(item.total_volume),
        sparkline: Array.isArray(sparkRaw) ? sparkRaw.map((p) => num(p)) : [],
      });
    }
    return coins.length > 0 ? coins : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < TTL) {
    return NextResponse.json({
      updatedAt: cache.fetchedAt,
      source: "cache",
      coins: cache.coins,
    });
  }

  const coins = await fetchTop100();
  if (coins) {
    cache = { fetchedAt: now, coins };
    lastGood = cache;
    return NextResponse.json({ updatedAt: now, source: "coingecko", coins });
  }

  if (lastGood) {
    return NextResponse.json({
      updatedAt: lastGood.fetchedAt,
      source: "cache",
      coins: lastGood.coins,
    });
  }

  return NextResponse.json({ error: "upstream" }, { status: 502 });
}
