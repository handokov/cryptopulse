/**
 * Bitget small-cap screener: online USDT spot pairs EXCLUDING the tracked
 * board (top-100 + pinned symbols) and Bitget's tokenized-equity pairs,
 * filtered by a minimum 24 h USDT volume. Built for manual small-cap
 * hunting ("≥ $200K/day volume, outside the top 100") without adding any
 * CoinGecko dependency — everything comes from Bitget public endpoints:
 *
 *   GET /api/v2/spot/public/symbols  (rules, status, areaSymbol flag — cached 10 min)
 *   GET /api/v2/spot/market/tickers  (prices + volumes — cached 60 s)
 *
 * Filters applied, in order:
 *   1. quoteCoin === "USDT", status === "online", areaSymbol !== "yes"
 *      (areaSymbol = Bitget's tokenized-stocks/rWA pairs, e.g. rSPY)
 *   2. base symbol not in the caller-provided exclusion set (board symbols)
 *   3. stablecoin/fiat bases dropped via denylist
 *   4. leveraged-token shapes dropped (3L/3S/5L/5S always; UP/DOWN only when
 *      the stripped base also exists as a pair — so JUP/SYRUP stay)
 *   5. 24 h USDT volume ≥ threshold, sorted volume-desc, capped
 */

export interface SmallcapRow {
  /** Full Bitget pair, e.g. "AIOUSDT". */
  symbol: string;
  /** Base asset, e.g. "AIO". */
  base: string;
  price: number;
  /** Fraction from Bitget (e.g. -0.0131 = −1.31 %). */
  change24h: number;
  high24h: number;
  low24h: number;
  volumeUsdt: number;
  /** Pair listing time (ms epoch) — lets the UI flag fresh listings. */
  openTime: number;
}

export interface SmallcapsResult {
  updatedAt: number;
  source: "bitget";
  minVolUsdt: number;
  /** Pairs passing every filter BEFORE the limit cut. */
  total: number;
  rows: SmallcapRow[];
}

interface BGSymbolRow {
  symbol?: unknown;
  baseCoin?: unknown;
  quoteCoin?: unknown;
  status?: unknown;
  areaSymbol?: unknown;
  openTime?: unknown;
}

interface BGTickerRow {
  symbol?: unknown;
  lastPr?: unknown;
  change24h?: unknown;
  high24h?: unknown;
  low24h?: unknown;
  usdtVolume?: unknown;
}

const BASE_URL = "https://api.bitget.com";
const SYMBOLS_TTL = 600_000;
const TICKERS_TTL = 60_000;

/** Fiat-backed / stable pairs that would otherwise clutter a coin screener. */
const STABLE_BASES = new Set([
  "USDC", "DAI", "TUSD", "FDUSD", "USDP", "PYUSD", "USDE", "USD1",
  "EUR", "EURI", "AEUR", "EURA", "XUSD", "UST", "USDS", "USDT",
]);

const g = globalThis as unknown as {
  __cpBGSymbols?: { at: number; rows: BGSymbolRow[] } | null;
  __cpBGTickers?: { at: number; rows: BGTickerRow[] } | null;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { code?: unknown; data?: unknown };
    if (body.code !== "00000") return null;
    return body.data as T;
  } catch {
    return null;
  }
}

async function getSymbolRows(): Promise<BGSymbolRow[] | null> {
  const cached = g.__cpBGSymbols;
  if (cached && Date.now() - cached.at < SYMBOLS_TTL) return cached.rows;
  const rows = await fetchJson<BGSymbolRow[]>(`${BASE_URL}/api/v2/spot/public/symbols`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  g.__cpBGSymbols = { at: Date.now(), rows };
  return rows;
}

async function getTickerRows(): Promise<BGTickerRow[] | null> {
  const cached = g.__cpBGTickers;
  if (cached && Date.now() - cached.at < TICKERS_TTL) return cached.rows;
  const rows = await fetchJson<BGTickerRow[]>(`${BASE_URL}/api/v2/spot/market/tickers`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  g.__cpBGTickers = { at: Date.now(), rows };
  return rows;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getBitgetSmallcaps(
  minVolUsdt: number,
  limit = 60,
  excludeSymbols: Set<string>
): Promise<SmallcapsResult> {
  const [symbolRows, tickerRows] = await Promise.all([getSymbolRows(), getTickerRows()]);
  if (!symbolRows || !tickerRows) throw new Error("bitget smallcaps upstream unavailable");

  /* Pair metadata keyed by full symbol (USDT-quote crypto pairs only). */
  const meta = new Map<string, { base: string; openTime: number }>();
  const baseSet = new Set<string>();
  for (const r of symbolRows) {
    const symbol = typeof r.symbol === "string" ? r.symbol : "";
    const base = typeof r.baseCoin === "string" ? r.baseCoin.toUpperCase() : "";
    if (!symbol || !base) continue;
    if (r.quoteCoin !== "USDT" || r.status !== "online") continue;
    if (r.areaSymbol === "yes") continue; // tokenized stocks / rWA
    meta.set(symbol, { base, openTime: num(r.openTime) });
    baseSet.add(base);
  }

  const out: SmallcapRow[] = [];
  for (const t of tickerRows) {
    const symbol = typeof t.symbol === "string" ? t.symbol : "";
    const m = meta.get(symbol);
    if (!m) continue;
    if (excludeSymbols.has(m.base)) continue; // board (top-100 + pins) member
    if (STABLE_BASES.has(m.base)) continue;
    /* Leveraged shapes: 3L/3S/5L/5S always; UP/DOWN only when the stripped
       base is itself a listed pair (BTCUP → BTC exists), so JUP stays. */
    if (/(3L|3S|5L|5S)$/.test(m.base)) continue;
    if (/(UP|DOWN)$/.test(m.base) && baseSet.has(m.base.slice(0, -2))) continue;

    const price = num(t.lastPr);
    const volumeUsdt = num(t.usdtVolume);
    if (price <= 0 || volumeUsdt < minVolUsdt) continue;

    out.push({
      symbol,
      base: m.base,
      price,
      change24h: num(t.change24h),
      high24h: num(t.high24h),
      low24h: num(t.low24h),
      volumeUsdt,
      openTime: m.openTime,
    });
  }

  out.sort((a, b) => b.volumeUsdt - a.volumeUsdt);
  const rows = out.slice(0, Math.max(1, limit));
  return { updatedAt: Date.now(), source: "bitget", minVolUsdt: minVolUsdt, total: out.length, rows };
}
