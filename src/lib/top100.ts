/**
 * Top-100 market board core: CoinGecko fetch with a module-level TTL cache
 * and last-good fallback on upstream failure. Shared by the
 * /api/market/top100 route and the per-coin tracing endpoint (which uses
 * the cached board as a snapshot source when the live markets call fails).
 */

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

export interface Top100Result {
  updatedAt: number;
  source: "coingecko" | "cache";
  coins: TopCoin[];
}

interface CacheEntry {
  fetchedAt: number;
  coins: TopCoin[];
}

const g = globalThis as unknown as {
  __cpTop100Cache?: CacheEntry | null;
  __cpTop100LastGood?: CacheEntry | null;
};
const cacheRef = (g.__cpTop100Cache ??= null);
const lastGoodRef = (g.__cpTop100LastGood ??= null);

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

/** Cached top-100 snapshot (falls back to the last good board). */
export async function getTop100(): Promise<Top100Result> {
  const now = Date.now();
  const cache = g.__cpTop100Cache;
  if (cache && now - cache.fetchedAt < TTL) {
    return { updatedAt: cache.fetchedAt, source: "cache", coins: cache.coins };
  }

  const coins = await fetchTop100();
  if (coins) {
    const entry: CacheEntry = { fetchedAt: now, coins };
    g.__cpTop100Cache = entry;
    g.__cpTop100LastGood = entry;
    return { updatedAt: now, source: "coingecko", coins };
  }

  const lastGood = g.__cpTop100LastGood;
  if (lastGood) {
    return { updatedAt: lastGood.fetchedAt, source: "cache", coins: lastGood.coins };
  }

  throw new Error("top100 upstream unavailable");
}

/** Looks a coin up in the last good top-100 board (id or symbol match). */
export function findTopCoin(idOrSymbol: string): TopCoin | null {
  const needle = idOrSymbol.toLowerCase().trim();
  const lastGood = g.__cpTop100LastGood;
  const cache = g.__cpTop100Cache;
  const board = lastGood?.coins ?? cache?.coins;
  if (!board) return null;
  return (
    board.find((c) => c.id === needle) ??
    board.find((c) => c.symbol.toLowerCase() === needle) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Symbol → coin matching universe for exchange sync (see exchanges/) */

export interface MatchCandidate {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  /** Board snapshot price when available; null from the coins-list fallback. */
  price: number | null;
}

interface CoinsListEntry {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
}

const g2 = globalThis as unknown as {
  __cpCoinsList?: { at: number; rows: MatchCandidate[] } | null;
};

/** Cheap single-call fallback (GET /coins/list), module-cached for 10 min. */
async function getCoinsListFallback(): Promise<MatchCandidate[] | null> {
  const cached = g2.__cpCoinsList;
  if (cached && Date.now() - cached.at < 600_000) return cached.rows;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/coins/list", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CoinsListEntry[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const rows: MatchCandidate[] = [];
    const seen = new Set<string>();
    for (const item of data) {
      if (typeof item?.id !== "string" || typeof item?.symbol !== "string") continue;
      const sym = item.symbol.toUpperCase();
      if (!sym || seen.has(sym)) continue; // first id wins, deterministic
      seen.add(sym);
      rows.push({
        id: item.id,
        symbol: sym,
        name: typeof item.name === "string" ? item.name : item.id,
        image: null,
        price: null,
      });
    }
    g2.__cpCoinsList = { at: Date.now(), rows };
    return rows;
  } catch {
    return null;
  }
}

/**
 * Best-effort symbol→coin universe for exchange sync: the top-100 board
 * (with images + snapshot prices) first; the all-coins list as a fallback
 * when the markets endpoint is rate-limited (images/prices then come from
 * the simple/price endpoint instead).
 */
export async function getMatchUniverse(): Promise<MatchCandidate[] | null> {
  try {
    const board = (await getTop100()).coins;
    return board.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: c.image || null,
      price: Number.isFinite(c.price) && c.price > 0 ? c.price : null,
    }));
  } catch {
    return await getCoinsListFallback();
  }
}
