/**
 * Bitget market movers — the whole USDT spot board (top-100 included, unlike
 * the small-caps screener) for the "naik/turun" dropdown:
 *
 *   GET /api/v2/spot/public/symbols  (pair rules — cached 10 min, shared with smallcaps)
 *   GET /api/v2/spot/market/tickers  (prices + volumes — cached 60 s, shared)
 *
 * Filters (same hygiene as the screener):
 *   1. quoteCoin === "USDT", status === "online", areaSymbol !== "yes"
 *   2. stablecoin/fiat bases dropped via denylist
 *   3. leveraged-token shapes dropped (3L/3S/5L/5S always; UP/DOWN only when
 *      the stripped base also exists as a pair)
 *   4. 24 h USDT volume ≥ threshold (keeps dead/illiquid pairs out; the UI
 *      sorts locally, so one payload serves the gainers/losers/volume tabs)
 *
 * Rows are returned volume-desc (capped) — the client re-sorts per tab.
 */

import { getSymbolRows, getTickerRows, num, STABLE_BASES } from "./smallcaps";

export interface MoverRow {
  /** Full Bitget pair, e.g. "BTCUSDT". */
  symbol: string;
  /** Base asset, e.g. "BTC". */
  base: string;
  price: number;
  /** Fraction from Bitget (e.g. -0.0131 = −1.31 %). */
  change24h: number;
  high24h: number;
  low24h: number;
  volumeUsdt: number;
}

export interface MoversResult {
  updatedAt: number;
  source: "bitget";
  minVolUsdt: number;
  /** Pairs passing every filter BEFORE the cap. */
  total: number;
  rows: MoverRow[];
}

const LEVERAGED = /(3L|3S|5L|5S)$/;

export async function getBitgetMovers(minVolUsdt: number, limit = 300): Promise<MoversResult> {
  const [symbolRows, tickerRows] = await Promise.all([getSymbolRows(), getTickerRows()]);
  if (!symbolRows || !tickerRows) throw new Error("bitget movers upstream unavailable");

  /* USDT-quote online crypto pair metadata keyed by full symbol. */
  const meta = new Map<string, string>(); // symbol → base
  const baseSet = new Set<string>();
  for (const r of symbolRows) {
    const symbol = typeof r.symbol === "string" ? r.symbol : "";
    const base = typeof r.baseCoin === "string" ? r.baseCoin.toUpperCase() : "";
    if (!symbol || !base) continue;
    if (r.quoteCoin !== "USDT" || r.status !== "online") continue;
    if (r.areaSymbol === "yes") continue; // tokenized stocks / rWA
    meta.set(symbol, base);
    baseSet.add(base);
  }

  const out: MoverRow[] = [];
  for (const t of tickerRows) {
    const symbol = typeof t.symbol === "string" ? t.symbol : "";
    const base = meta.get(symbol);
    if (!base) continue;
    if (STABLE_BASES.has(base)) continue;
    if (LEVERAGED.test(base)) continue;
    if (/(UP|DOWN)$/.test(base) && baseSet.has(base.slice(0, -2))) continue;

    const price = num(t.lastPr);
    const volumeUsdt = num(t.usdtVolume);
    if (price <= 0 || volumeUsdt < minVolUsdt) continue;

    out.push({
      symbol,
      base,
      price,
      change24h: num(t.change24h),
      high24h: num(t.high24h),
      low24h: num(t.low24h),
      volumeUsdt,
    });
  }

  out.sort((a, b) => b.volumeUsdt - a.volumeUsdt);
  const rows = out.slice(0, Math.max(1, limit));
  return { updatedAt: Date.now(), source: "bitget", minVolUsdt, total: out.length, rows };
}
