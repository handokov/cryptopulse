/**
 * Bitget spot trading client for the bot (v2 REST API).
 *
 * Public (unsigned): candles, ticker, product rules (min order).
 * Signed (HMAC, same scheme as src/lib/exchanges/bitget.ts):
 *   POST /api/v2/spot/trade/place-order — market buy/sell
 *   GET  /api/v2/spot/trade/orderInfo   — best-effort fill price
 *
 * Signing: base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret)).
 * For POST the requestPath has no query; for signed GETs the query IS part of
 * the path. Docs: https://www.bitget.com/api-doc/spot/intro
 */

import { createHmac, randomUUID } from "crypto";
import { signedFetch, toNum, type ExchangeCredentials } from "@/lib/exchanges/types";

const BASE = "https://api.bitget.com";

/* ------------------------------------------------------------------ */
/* Public market data                                                  */
/* ------------------------------------------------------------------ */

/** Candle granularity used by the strategy (4-hour bars). */
export const BAR_GRANULARITY = "4h";
/** Bars per year for annualizing volatility on 4H bars (crypto trades 24/7). */
export const BARS_PER_YEAR = 365 * 6;

export interface Klines {
  /** Oldest → newest close prices. */
  closes: number[];
  lastClose: number;
}

interface RawCandleRow {
  0?: unknown; 1?: unknown; 4?: unknown;
}

/** GET /api/v2/spot/market/candles — public. */
export async function fetchCloses(symbol: string, limit = 160): Promise<Klines> {
  const path = `/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${BAR_GRANULARITY}&limit=${limit}`;
  const res = await signedFetch(`${BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`bitget candles HTTP ${res.status}`);
  const body = (await res.json()) as { code?: unknown; data?: RawCandleRow[] | null };
  if (body.code !== "00000" || !Array.isArray(body.data)) throw new Error("bitget candles bad payload");
  const closes = body.data
    .map((r) => toNum(r[4]))
    .filter((v) => v > 0);
  if (closes.length < 30) throw new Error("bitget candles too short");
  return { closes, lastClose: closes[closes.length - 1] };
}

/** GET /api/v2/spot/market/tickers — public. Returns last trade price. */
export async function fetchTickerPrice(symbol: string): Promise<number> {
  const path = `/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`;
  const res = await signedFetch(`${BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`bitget ticker HTTP ${res.status}`);
  const body = (await res.json()) as { code?: unknown; data?: { lastPr?: unknown }[] | null };
  if (body.code !== "00000" || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("bitget ticker bad payload");
  }
  const last = toNum(body.data[0]?.lastPr);
  if (last <= 0) throw new Error("bitget ticker no price");
  return last;
}

export interface SpotProductRules {
  minOrderUsdt: number;
  quantityPrecision: number;
}

/** GET /api/v2/spot/public/symbols — public. Live exchange minimums. */
export async function fetchSpotProduct(symbol: string): Promise<SpotProductRules> {
  const path = `/api/v2/spot/public/symbols?symbol=${encodeURIComponent(symbol)}`;
  const res = await signedFetch(`${BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`bitget products HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: unknown;
    data?: { minTradeUSDT?: unknown; quantityPrecision?: unknown }[] | null;
  };
  if (body.code !== "00000" || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("bitget products bad payload");
  }
  const row = body.data[0];
  return {
    minOrderUsdt: toNum(row.minTradeUSDT),
    quantityPrecision: Number.isFinite(Number(row.quantityPrecision)) ? Number(row.quantityPrecision) : 8,
  };
}

/* ------------------------------------------------------------------ */
/* Signed trading                                                      */
/* ------------------------------------------------------------------ */

function sign(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method}${requestPath}${body}`).digest("base64");
}

async function signedRequest<T>(
  creds: ExchangeCredentials,
  method: "GET" | "POST",
  requestPath: string,
  body?: unknown
): Promise<T> {
  if (!creds.apiPassphrase) throw new Error("bitget: missing passphrase");
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Date.now().toString();
  const res = await signedFetch(`${BASE}${requestPath}`, {
    method,
    headers: {
      "ACCESS-KEY": creds.apiKey,
      "ACCESS-SIGN": sign(timestamp, method, requestPath, bodyStr, creds.apiSecret),
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": creds.apiPassphrase,
      "Content-Type": "application/json",
      locale: "en-US",
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });
  if (!res.ok) throw new Error(`bitget HTTP ${res.status}`);
  const data = (await res.json()) as { code?: unknown; msg?: unknown; data?: unknown };
  if (data.code !== "00000") {
    throw new Error(typeof data.msg === "string" && data.msg ? data.msg : `bitget code ${String(data.code)}`);
  }
  return data.data as T;
}

export interface PlacedOrder {
  orderId: string;
  clientOid: string;
}

/**
 * Market order on spot.
 * BUY  → quantity is the QUOTE amount (USDT to spend), per Bitget v2 rules.
 * SELL → quantity is the BASE amount (coin to sell).
 */
export async function placeSpotMarketOrder(
  creds: ExchangeCredentials,
  opts: { symbol: string; side: "buy" | "sell"; quantity: string }
): Promise<PlacedOrder> {
  const clientOid = randomUUID();
  const data = await signedRequest<{ orderId?: unknown; clientOid?: unknown }>(
    creds,
    "POST",
    "/api/v2/spot/trade/place-order",
    { symbol: opts.symbol, side: opts.side, orderType: "market", force: "ioc", quantity: opts.quantity, clientOid }
  );
  const orderId = typeof data?.orderId === "string" ? data.orderId : "";
  if (!orderId) throw new Error("bitget: no orderId in response");
  return { orderId, clientOid };
}

export interface OrderFill {
  status: string;
  priceAvg: number | null;
  baseVolume: number | null;
}

/** Best-effort fill info for a placed order (used to refine entry price). */
export async function fetchOrderFill(creds: ExchangeCredentials, symbol: string, orderId: string): Promise<OrderFill> {
  const path = `/api/v2/spot/trade/orderInfo?symbol=${encodeURIComponent(symbol)}&orderId=${encodeURIComponent(orderId)}`;
  try {
    const data = await signedRequest<{ status?: unknown; priceAvg?: unknown; baseVolume?: unknown }[]>(
      creds,
      "GET",
      path
    );
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row) return { status: "unknown", priceAvg: null, baseVolume: null };
    return {
      status: typeof row.status === "string" ? row.status : "unknown",
      priceAvg: toNum(row.priceAvg) > 0 ? toNum(row.priceAvg) : null,
      baseVolume: toNum(row.baseVolume) > 0 ? toNum(row.baseVolume) : null,
    };
  } catch {
    return { status: "unknown", priceAvg: null, baseVolume: null };
  }
}
