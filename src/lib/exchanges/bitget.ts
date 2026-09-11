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
