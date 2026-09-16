/**
 * Bitget spot trading client for the bot (v2 REST API).
 *
 * Public (unsigned): candles, ticker, product rules (min order).
 * Signed (HMAC, same scheme as src/lib/exchanges/bitget.ts):
 *   POST /api/v2/spot/trade/place-order      — market / limit (post-only)
 *                                                + attached TP/SL (tpslType)
 *   POST /api/v2/spot/trade/cancel-order     — cancel by orderId
 *   GET  /api/v2/spot/trade/orderInfo        — order status + fill price
 *   GET  /api/v2/spot/trade/fills            — executed fills (OCO reconcile)
 *   GET  /api/v2/spot/trade/current-plan-order — armed TP/SL plan rows
 *   POST /api/v2/spot/trade/cancel-plan-order — cancel an armed TP/SL row
 *   GET  /api/v2/spot/account/assets         — spot balance (funding check)
 *
 * Contract verified against the official `bitget-api` SDK types (Task 16):
 * orders take `size` (NOT the retired `quantity`); attached TP/SL is the
 * spot OCO mechanism — when the entry fills, Bitget arms both triggers and
 * cancels the sibling automatically after one fires.
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

/* v2 phase 2 — timeframe-aware market data.
   Bitget v2 candle granularity strings are LOWERCASE for hour bars and
   "1day" for daily (verified against the live API — "4H"/"1H"/"1D" are
   rejected with code 400171), one entry per supported BotTimeframe. */
export const TF_GRANULARITY: Record<string, string> = {
  "15M": "15min",
  "30M": "30min",
  "1H": "1h",
  "4H": "4h",
  "1D": "1day",
};

/** Crypto trades 24/7 — bars per year is purely a function of bar length. */
export function barsPerYearFor(tf: string): number {
  const minutes: Record<string, number> = { "15M": 15, "30M": 30, "1H": 60, "4H": 240, "1D": 1440 };
  const m = minutes[tf];
  return m ? Math.round((365 * 24 * 60) / m) : BARS_PER_YEAR;
}

export interface Klines {
  /** Oldest → newest close prices. */
  closes: number[];
  lastClose: number;
}

interface RawCandleRow {
  0?: unknown; 1?: unknown; 4?: unknown;
}

/** GET /api/v2/spot/market/candles — public. */
export async function fetchCloses(symbol: string, limit = 160, tf = "4H"): Promise<Klines> {
  const granularity = TF_GRANULARITY[tf] ?? BAR_GRANULARITY;
  const path = `/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&limit=${limit}`;
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

export interface Candle {
  /** Unix seconds (lightweight-charts UTCTimestamp). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface RawOhlcRow {
  0?: unknown; 1?: unknown; 2?: unknown; 3?: unknown; 4?: unknown;
}

/**
 * GET /api/v2/spot/market/candles — full OHLC rows for the chart, ascending
 * by time. The last row is the still-forming bar (same data the engine's
 * fetchCloses sees), which keeps chart and engine perfectly in sync.
 */
export async function fetchCandles(symbol: string, tf = "4H", limit = 180, minBars = 30): Promise<Candle[]> {
  const granularity = TF_GRANULARITY[tf] ?? BAR_GRANULARITY;
  const path = `/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&limit=${limit}`;
  const res = await signedFetch(`${BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`bitget candles HTTP ${res.status}`);
  const body = (await res.json()) as { code?: unknown; data?: RawOhlcRow[] | null };
  if (body.code !== "00000" || !Array.isArray(body.data)) throw new Error("bitget candles bad payload");
  const rows = body.data
    .map((r) => ({
      time: Math.floor(toNum(r[0]) / 1000),
      open: toNum(r[1]),
      high: toNum(r[2]),
      low: toNum(r[3]),
      close: toNum(r[4]),
    }))
    .filter((c) => c.time > 0 && c.close > 0 && c.open > 0)
    .sort((a, b) => a.time - b.time);
  if (rows.length < minBars) throw new Error("bitget candles too short");
  return rows;
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
  /** Decimal places allowed on the limit price (pricePrecision from symbols). */
  pricePrecision: number;
}

/** GET /api/v2/spot/public/symbols — public. Live exchange minimums. */
export async function fetchSpotProduct(symbol: string): Promise<SpotProductRules> {
  const path = `/api/v2/spot/public/symbols?symbol=${encodeURIComponent(symbol)}`;
  const res = await signedFetch(`${BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`bitget products HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: unknown;
    data?: { minTradeUSDT?: unknown; quantityPrecision?: unknown; pricePrecision?: unknown }[] | null;
  };
  if (body.code !== "00000" || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error("bitget products bad payload");
  }
  const row = body.data[0];
  return {
    minOrderUsdt: toNum(row.minTradeUSDT),
    quantityPrecision: Number.isFinite(Number(row.quantityPrecision)) ? Number(row.quantityPrecision) : 8,
    pricePrecision: Number.isFinite(Number(row.pricePrecision)) ? Number(row.pricePrecision) : 8,
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
 * BUY  → size is the QUOTE amount (USDT to spend), per Bitget v2 rules.
 * SELL → size is the BASE amount (coin to sell).
 * Optional attached TP/SL (tpslType) — the spot OCO mechanism; when both
 * triggers are given, Bitget arms them as soon as the order fills.
 * Param is `size` — the retired `quantity` name is no longer in the v2
 * contract (verified against the official SDK types, Task 16).
 */
export async function placeSpotMarketOrder(
  creds: ExchangeCredentials,
  opts: { symbol: string; side: "buy" | "sell"; quantity: string; takeProfitTrigger?: string; stopLossTrigger?: string }
): Promise<PlacedOrder> {
  const clientOid = randomUUID();
  const body: Record<string, unknown> = {
    symbol: opts.symbol,
    side: opts.side,
    orderType: "market",
    force: "ioc",
    size: opts.quantity,
    clientOid,
  };
  if (opts.takeProfitTrigger && opts.stopLossTrigger) {
    body.tpslType = "tpsl";
    body.presetTakeProfitPrice = opts.takeProfitTrigger;
    body.presetStopLossPrice = opts.stopLossTrigger;
  }
  const data = await signedRequest<{ orderId?: unknown; clientOid?: unknown }>(
    creds,
    "POST",
    "/api/v2/spot/trade/place-order",
    body
  );
  const orderId = typeof data?.orderId === "string" ? data.orderId : "";
  if (!orderId) throw new Error("bitget: no orderId in response");
  return { orderId, clientOid };
}

/**
 * Post-only LIMIT order with ATTACHED TP/SL (the spot OCO mechanism).
 *
 * - `force: "post_only"` → the order can only rest on the book as maker; if
 *   it would cross immediately Bitget rejects it — the anti-buy-the-top
 *   guarantee, identical to the paper simulation's "below market" level.
 * - `tpslType: "tpsl"` + preset trigger prices → when the entry fills,
 *   Bitget arms BOTH triggers and auto-cancels the sibling after one fires
 *   (true OCO). If the entry never fills, nothing is ever armed.
 * - Execution after a trigger defaults to market when execute* is omitted.
 * - Limit `size` is the BASE amount; `price` must respect pricePrecision.
 */
export async function placeSpotLimitOrderWithTpsl(
  creds: ExchangeCredentials,
  opts: {
    symbol: string;
    side: "buy" | "sell";
    price: string;
    size: string;
    takeProfitTrigger?: string;
    stopLossTrigger?: string;
  }
): Promise<PlacedOrder> {
  const clientOid = randomUUID();
  const body: Record<string, unknown> = {
    symbol: opts.symbol,
    side: opts.side,
    orderType: "limit",
    force: "post_only",
    price: opts.price,
    size: opts.size,
    clientOid,
  };
  if (opts.takeProfitTrigger && opts.stopLossTrigger) {
    body.tpslType = "tpsl";
    body.presetTakeProfitPrice = opts.takeProfitTrigger;
    body.presetStopLossPrice = opts.stopLossTrigger;
  }
  const data = await signedRequest<{ orderId?: unknown; clientOid?: unknown }>(
    creds,
    "POST",
    "/api/v2/spot/trade/place-order",
    body
  );
  const orderId = typeof data?.orderId === "string" ? data.orderId : "";
  if (!orderId) throw new Error("bitget: no orderId in response");
  return { orderId, clientOid };
}

/** Cancel an order (entry limit or any resting order) by orderId. */
export async function cancelSpotOrder(
  creds: ExchangeCredentials,
  opts: { symbol: string; orderId: string }
): Promise<void> {
  await signedRequest<{ result?: unknown; success?: unknown }>(
    creds,
    "POST",
    "/api/v2/spot/trade/cancel-order",
    { symbol: opts.symbol, orderId: opts.orderId }
  );
}

export interface SpotBalance {
  coin: string;
  available: number;
  frozen: number;
}

/**
 * GET /api/v2/spot/account/assets?coin=… — the funding source for live
 * entries. Available already excludes funds frozen by open orders.
 */
export async function fetchSpotBalance(creds: ExchangeCredentials, coin = "USDT"): Promise<SpotBalance | null> {
  const path = `/api/v2/spot/account/assets?coin=${encodeURIComponent(coin)}`;
  const data = await signedRequest<{ coin?: unknown; available?: unknown; frozen?: unknown; lock?: unknown }[]>(
    creds,
    "GET",
    path
  );
  const rows = Array.isArray(data) ? data : [];
  const row = rows.find((r) => String(r?.coin ?? "").toUpperCase() === coin.toUpperCase());
  if (!row) return null;
  return {
    coin,
    available: toNum(row.available),
    frozen: toNum(row.frozen) + toNum((row as { lock?: unknown }).lock),
  };
}

export interface OcoPlanRow {
  orderId: string;
  side: string;
  size: number;
  triggerPrice: number;
  status: string;
  planType: string;
}

/**
 * GET /api/v2/spot/trade/current-plan-order?symbol=… — rows of the armed
 * TP/SL plans (attached TP/SL surface here after the entry fills). The
 * response is `{ nextFlag, idLessThan, orderList }` per the SDK; parsed
 * defensively because older shapes returned a bare array.
 */
export async function fetchOcoPlanRows(creds: ExchangeCredentials, symbol: string): Promise<OcoPlanRow[]> {
  const path = `/api/v2/spot/trade/current-plan-order?symbol=${encodeURIComponent(symbol)}`;
  try {
    const data = await signedRequest<unknown>(creds, "GET", path);
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { orderList?: unknown[] })?.orderList)
        ? ((data as { orderList: unknown[] }).orderList)
        : [];
    return (list as Record<string, unknown>[]).map((r) => ({
      orderId: String(r.orderId ?? ""),
      side: String(r.side ?? "").toLowerCase(),
      size: toNum(r.size),
      triggerPrice: toNum(r.triggerPrice),
      status: String(r.status ?? ""),
      planType: String(r.planType ?? ""),
    }));
  } catch {
    return []; // query failure must never block an exit decision on its own
  }
}

/** POST /api/v2/spot/trade/cancel-plan-order — cancel one armed TP/SL row. */
export async function cancelOcoPlan(creds: ExchangeCredentials, orderId: string): Promise<void> {
  await signedRequest<{ result?: unknown }>(creds, "POST", "/api/v2/spot/trade/cancel-plan-order", { orderId });
}

export interface SpotFill {
  orderId: string;
  side: string;
  price: number;
  size: number;
  quoteUsdt: number;
  ts: number;
}

/**
 * GET /api/v2/spot/trade/fills?symbol=…&startTime=… — executed fills, used
 * to reconcile an OCO-triggered exit with the exchange's real numbers.
 */
export async function fetchRecentFills(
  creds: ExchangeCredentials,
  symbol: string,
  startTimeMs?: number
): Promise<SpotFill[]> {
  const q = new URLSearchParams({ symbol, limit: "50" });
  if (startTimeMs && startTimeMs > 0) q.set("startTime", String(startTimeMs));
  const path = `/api/v2/spot/trade/fills?${q.toString()}`;
  try {
    const data = await signedRequest<unknown>(creds, "GET", path);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray((data as { fillsList?: unknown[] })?.fillsList)
        ? ((data as { fillsList: unknown[] }).fillsList)
        : [];
    return (rows as Record<string, unknown>[])
      .map((r) => ({
        orderId: String(r.orderId ?? ""),
        side: String(r.side ?? "").toLowerCase(),
        price: toNum(r.priceAvg),
        size: toNum(r.size),
        quoteUsdt: toNum(r.amount),
        ts: toNum(r.uTime) || toNum(r.cTime),
      }))
      .filter((f) => f.price > 0 && f.size > 0);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Status classification + precision helpers                           */
/* ------------------------------------------------------------------ */

export type LiveOrderState = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "UNKNOWN";

/**
 * Defensive classifier for Bitget orderInfo `status` strings. The exact enum
 * has drifted over time ("new", "partially_filled", "full_fill", "filled",
 * "cancelled", …) — the engine may only act on states it positively knows.
 * UNKNOWN degrades to "keep waiting": never sell on a guess.
 */
export function classifyOrderStatus(status: string): LiveOrderState {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "OPEN";
  if (s.includes("cancel") || s.includes("reject")) return "CANCELLED";
  if (s.includes("partial")) return "PARTIAL";
  if (s.includes("full") || s === "filled") return "FILLED";
  if (s.includes("new") || s.includes("init") || s.includes("pending") || s.includes("live") || s.includes("open")) {
    return "OPEN";
  }
  return "UNKNOWN";
}

/** Clip a price/qty to the exchange's decimal precision, trailing-zero free. */
export function clipToPrecision(value: number, precision: number): string {
  const p = Number.isFinite(precision) && precision >= 0 ? Math.min(Math.floor(precision), 12) : 8;
  const clipped = Math.floor(value * 10 ** p) / 10 ** p; // round DOWN — never exceed the budget
  return clipped.toFixed(p).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Pure helper: entry sizing for a post-only limit BUY.
 * Returns null when the budget cannot satisfy the exchange minimum.
 */
export function planLimitBuySize(opts: {
  marketPrice: number;
  level: number;
  budgetUsdt: number;
  minOrderUsdt: number;
  availableUsdt: number;
  quantityPrecision: number;
}): { qty: string; notional: number } | null {
  const { marketPrice, level, budgetUsdt, minOrderUsdt, availableUsdt, quantityPrecision } = opts;
  if (!(level > 0) || !(marketPrice > 0)) return null;
  const minNotional = minOrderUsdt > 0 ? minOrderUsdt : 1; // Bitget spot min verified 2026-09: 1 USDT
  const p = Number.isFinite(quantityPrecision) && quantityPrecision >= 0 ? Math.min(Math.floor(quantityPrecision), 12) : 8;
  let usdt = Math.max(budgetUsdt, minNotional);
  if (usdt > availableUsdt) usdt = availableUsdt; // the order freezes this much quote
  if (usdt < minNotional) return null;
  const qtyStr = clipToPrecision(usdt / level, p);
  let qty = Number(qtyStr);
  let notional = qty * level;
  if (notional < minNotional) {
    // Rounding DOWN dipped under the exchange minimum — round the qty UP to
    // the smallest precision step that satisfies it (same "clamped UP to the
    // exchange min" semantics the engine already logs), then re-check funds.
    const qtyUp = Math.ceil((minNotional / level) * 10 ** p - 1e-9) / 10 ** p;
    qty = Number(qtyUp.toFixed(p));
    notional = qty * level;
    if (notional < minNotional || notional > availableUsdt) return null;
    return { qty: qty.toFixed(p).replace(/0+$/, "").replace(/\.$/, ""), notional };
  }
  return { qty: qtyStr, notional };
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
