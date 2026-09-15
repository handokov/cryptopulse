/**
 * Bitget spot adapter v2 — GET /api/v2/spot/account/assets.
 * Signing: base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret))
 * with ACCESS-KEY / ACCESS-SIGN / ACCESS-TIMESTAMP / ACCESS-PASSPHRASE headers.
 * Docs: https://www.bitget.com/api-doc/spot/account/Get-Assets
 * Requires "Read-Only" permission plus the passphrase set at key creation.
 */

import { createHmac } from "crypto";
import {
  ExchangeCredentials,
  ExchangeError,
  ExchangeAdapter,
  NormalizedBalance,
  signedFetch,
  toNum,
} from "./types";

const BASE = "https://api.bitget.com";
const PATH = "/api/v2/spot/account/assets";
const PLACE_ORDER_PATH = "/api/v2/spot/trade/place-order";

/* ------------------------------------------------------------------ */
/* Trade-permission probe (Task 17)                                    */
/*                                                                     */
/* Bitget exposes no "describe my key" endpoint, so the only way to    */
/* learn whether a key carries spot-trade scope is to attempt an order */
/* and read the rejection. The probe sends a DELIBERATELY INVALID      */
/* order — a symbol that cannot exist plus a quote size far below any  */
/* tradable minimum — so no exchange (and no bug) can ever fill it.    */
/* The rejection TEXT is the signal:                                   */
/*   • permission-flavoured error  → key is READ-ONLY (denied)         */
/*   • symbol/parameter error      → the call passed the permission    */
/*                                   gate → trade scope present        */
/*   • anything else               → inconclusive (keep previous)      */
/* ------------------------------------------------------------------ */

export type TradeProbeState = "granted" | "denied" | "inconclusive";

export interface TradeProbeResult {
  state: TradeProbeState;
  code?: string;
  message?: string;
}

/** Pure classifier — unit-testable without network. */
export function classifyTradeProbe(code: string | undefined, msg: string): TradeProbeState {
  const m = (msg || "").toLowerCase();
  // Bitget 40014 family = "no permission for this apikey"; message mentions
  // permission/privilege/authorization on current deployments.
  if (code === "40014" || /permission|privilege|authoriz|no right|not allow/.test(m)) {
    return "denied";
  }
  // A symbol/parameter rejection means the request reached the business layer.
  if (/symbol|parameter|size|amount|invalid|exist|minimum|min\b/.test(m)) {
    return "granted";
  }
  return "inconclusive";
}

/**
 * Probe the key's spot-trade scope. NEVER places a real order (impossible
 * symbol + sub-minimum size). Call only AFTER the balance test succeeded —
 * auth problems are then already ruled out, so a permission-flavoured
 * rejection is genuinely about the trade scope.
 */
export async function probeTradePermission(creds: ExchangeCredentials): Promise<TradeProbeResult> {
  if (!creds.apiPassphrase) return { state: "inconclusive", message: "missing passphrase" };
  const body = JSON.stringify({
    // Both values are intentionally invalid: the symbol does not exist on
    // Bitget and 0.000001 USDT is below every spot minimum — a market BUY
    // can never book, whatever the key's permissions are.
    symbol: "CRYPTOPULSEPROBEUSDT",
    side: "buy",
    orderType: "market",
    size: "0.000001",
    force: "normal",
  });
  try {
    const timestamp = Date.now().toString();
    const sign = bitgetSign(timestamp, "POST", PLACE_ORDER_PATH, body, creds.apiSecret);
    const res = await signedFetch(`${BASE}${PLACE_ORDER_PATH}`, {
      method: "POST",
      headers: {
        "ACCESS-KEY": creds.apiKey,
        "ACCESS-SIGN": sign,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": creds.apiPassphrase,
        "Content-Type": "application/json",
        locale: "en-US",
      },
      body,
    });
    if (!res.ok) {
      return { state: "inconclusive", message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { code?: unknown; msg?: unknown };
    const code = typeof data?.code === "string" ? data.code : undefined;
    const msg = typeof data?.msg === "string" ? data.msg : "";
    if (code === "00000") {
      // Theoretically unreachable (invalid symbol + invalid size); if it ever
      // happens the key can trade — treat as granted and log the oddity.
      console.warn("[bitget-probe] probe order unexpectedly accepted — key is trade-capable");
      return { state: "granted", code, message: msg || "probe accepted" };
    }
    return { state: classifyTradeProbe(code, msg), code, message: msg };
  } catch (err) {
    return {
      state: "inconclusive",
      message: err instanceof Error ? err.message : "probe network error",
    };
  }
}

/**
 * Public (unsigned) last-trade price for one spot pair, e.g. "AIOUSDT".
 * Used by the portfolio sync to sanity-check symbol resolutions against the
 * exchange's own price so a same-ticker imposter coin can't be matched.
 * Returns null on any failure (never throws).
 */
export async function fetchBitgetTickerPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3500), cache: "no-store" }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { code?: unknown; data?: { lastPr?: unknown }[] | null };
    if (body.code !== "00000" || !Array.isArray(body.data) || body.data.length === 0) return null;
    const last = toNum(body.data[0]?.lastPr);
    return last > 0 ? last : null;
  } catch {
    return null;
  }
}

interface BitgetResp {
  code?: unknown;
  msg?: unknown;
  data?:
    | { coin?: unknown; available?: unknown; frozen?: unknown; locked?: unknown }[]
    | null;
}

function bitgetSign(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method}${requestPath}${body}`).digest("base64");
}

export const bitgetAdapter: ExchangeAdapter = {
  id: "bitget",
  async fetchBalances(creds: ExchangeCredentials): Promise<NormalizedBalance[]> {
    if (!creds.apiPassphrase) {
      throw new ExchangeError("auth", "missing passphrase");
    }
    const timestamp = Date.now().toString();
    const sign = bitgetSign(timestamp, "GET", PATH, "", creds.apiSecret);
    const res = await signedFetch(`${BASE}${PATH}`, {
      headers: {
        "ACCESS-KEY": creds.apiKey,
        "ACCESS-SIGN": sign,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": creds.apiPassphrase,
        "Content-Type": "application/json",
        locale: "en-US",
      },
    });

    if (!res.ok) {
      // Bitget auth failures surface as 400xx codes in a 200/400 body too;
      // HTTP-level 401/403 are the usual bad-key signals.
      if (res.status === 401 || res.status === 403) {
        throw new ExchangeError("auth", `HTTP ${res.status}`);
      }
      throw new ExchangeError("network", `HTTP ${res.status}`);
    }

    const data = (await res.json()) as BitgetResp;
    const code = typeof data?.code === "string" ? data.code : "";
    if (code !== "00000") {
      const msg = typeof data?.msg === "string" ? data.msg : `code ${code}`;
      // 400003/400007/401xx family = credentials or passphrase problems.
      throw new ExchangeError(/^400|401/.test(code) ? "auth" : "unexpected", msg);
    }
    const rows = Array.isArray(data?.data) ? data.data : [];
    const out: NormalizedBalance[] = [];
    for (const row of rows) {
      if (typeof row?.coin !== "string" || !row.coin) continue;
      const free = toNum(row.available);
      const locked = toNum(row.frozen) + toNum(row.locked);
      if (free + locked <= 0) continue;
      out.push({ asset: row.coin.toUpperCase(), free, locked });
    }
    return out;
  },
};
