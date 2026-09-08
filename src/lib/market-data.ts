/**
 * Market data core: asset universe (high-volume crypto assets), seeded
 * history generation for consistent model series, live snapshot with
 * in-memory cache. Tries CoinGecko first, falls back to the internal model.
 */

export interface AssetDef {
  symbol: string;
  name: string;
  coingeckoId: string;
  basePrice: number;
  dailyVol: number;
  drift: number; // daily log drift used by the model
  baseVolume24h: number; // USD
  accent: string; // hex accent used client-side
}

export interface AssetSnapshot {
  symbol: string;
  name: string;
  price: number;
  change24h: number; // percent
  volume24h: number; // USD
  marketCap: number; // USD
  history: number[]; // 90 daily closes, last = current price
  color: string;
}

export interface MarketSnapshot {
  updatedAt: number;
  source: "coingecko" | "model";
  assets: AssetSnapshot[];
}

/** High-volume assets tracked by the site. */
export const ASSET_DEFS: AssetDef[] = [
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", basePrice: 95000, dailyVol: 0.028, drift: 0.0012, baseVolume24h: 38_000_000_000, accent: "#10b981" },
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", basePrice: 3400, dailyVol: 0.035, drift: 0.0010, baseVolume24h: 18_500_000_000, accent: "#34d399" },
  { symbol: "SOL", name: "Solana", coingeckoId: "solana", basePrice: 190, dailyVol: 0.045, drift: 0.0014, baseVolume24h: 4_600_000_000, accent: "#f59e0b" },
  { symbol: "BNB", name: "BNB", coingeckoId: "binancecoin", basePrice: 700, dailyVol: 0.030, drift: 0.0008, baseVolume24h: 2_100_000_000, accent: "#fbbf24" },
  { symbol: "XRP", name: "XRP", coingeckoId: "ripple", basePrice: 2.2, dailyVol: 0.050, drift: 0.0009, baseVolume24h: 5_200_000_000, accent: "#2dd4bf" },
  { symbol: "DOGE", name: "Dogecoin", coingeckoId: "dogecoin", basePrice: 0.16, dailyVol: 0.055, drift: 0.0002, baseVolume24h: 1_900_000_000, accent: "#a3e635" },
  { symbol: "ADA", name: "Cardano", coingeckoId: "cardano", basePrice: 0.75, dailyVol: 0.050, drift: 0.0004, baseVolume24h: 1_250_000_000, accent: "#4ade80" },
  { symbol: "AVAX", name: "Avalanche", coingeckoId: "avalanche-2", basePrice: 28, dailyVol: 0.048, drift: 0.0006, baseVolume24h: 900_000_000, accent: "#fb923c" },
];

/* ---------------- seeded RNG ---------------- */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------------- history generation ---------------- */

/**
 * Generates `days` daily closes ending exactly at `anchorPrice` using a
 * backward geometric random walk seeded by the symbol (stable shape).
 */
export function generateHistory(def: AssetDef, anchorPrice: number, days = 90): number[] {
  const rng = mulberry32(hashString(def.symbol));
  const out = new Array<number>(days);
  out[days - 1] = anchorPrice;
  for (let i = days - 1; i > 0; i--) {
    const r = def.drift + def.dailyVol * gaussian(rng);
    out[i - 1] = out[i] / Math.exp(r);
  }
  return out;
}

/** Gentle deterministic "breathing" of the model price over time. */
function modelPrice(def: AssetDef, now: number): number {
  const cycle = Math.floor(now / 120_000); // drifts every 2 min (cache window)
  const rng = mulberry32(hashString(def.symbol + ":" + cycle));
  const jitter = (rng() - 0.5) * 0.006; // ±0.3%
  return def.basePrice * (1 + jitter);
}

/* ---------------- coingecko fetch ---------------- */

interface CGCoin {
  current_price: number;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
  market_cap: number | null;
}

async function fetchCoinGecko(): Promise<Record<string, CGCoin> | null> {
  const ids = ASSET_DEFS.map((d) => d.coingeckoId).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CGCoin[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const byId: Record<string, CGCoin> = {};
    for (const c of data) byId[(c as unknown as { id: string }).id] = c;
    return byId;
  } catch {
    return null;
  }
}

/* ---------------- snapshot with cache ---------------- */

type CacheEntry = { snapshot: MarketSnapshot; ts: number };
const globalCache = globalThis as unknown as { __cpMarketCache?: CacheEntry };
const CACHE_MS = 120_000;

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const now = Date.now();
  const cached = globalCache.__cpMarketCache;
  if (cached && now - cached.ts < CACHE_MS) return cached.snapshot;

  const cg = await fetchCoinGecko();
  const assets: AssetSnapshot[] = ASSET_DEFS.map((def) => {
    const live = cg ? cg[def.coingeckoId] : undefined;
    const price = live?.current_price && live.current_price > 0 ? live.current_price : modelPrice(def, now);
    const history = generateHistory(def, price, 90);
    const change24h =
      live?.price_change_percentage_24h != null
        ? live.price_change_percentage_24h
        : (history[history.length - 1] / history[history.length - 2] - 1) * 100;
    const volume24h = live?.total_volume ?? def.baseVolume24h;
    const marketCap = live?.market_cap ?? price * roughSupply(def.symbol);
    return {
      symbol: def.symbol,
      name: def.name,
      price,
      change24h,
      volume24h,
      marketCap,
      history,
      color: def.accent,
    };
  });

  const snapshot: MarketSnapshot = {
    updatedAt: now,
    source: cg ? "coingecko" : "model",
    assets,
  };
  globalCache.__cpMarketCache = { snapshot, ts: now };
  return snapshot;
}

function roughSupply(symbol: string): number {
  switch (symbol) {
    case "BTC": return 19_800_000;
    case "ETH": return 120_400_000;
    case "SOL": return 478_000_000;
    case "BNB": return 139_000_000;
    case "XRP": return 59_000_000_000;
    case "DOGE": return 146_000_000_000;
    case "ADA": return 35_000_000_000;
    case "AVAX": return 410_000_000;
    default: return 100_000_000;
  }
}
