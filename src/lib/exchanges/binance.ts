/**
 * Binance spot adapter — GET /api/v3/account.
 * Signing: HMAC-SHA256 hex digest over the query string, `X-MBX-APIKEY` header.
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints
 * Requires a key with "Reading" permission (read-only is exactly what we want).
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

const BASE = "https://api.binance.com";

interface BinanceAccountResp {
  balances?: { asset?: unknown; free?: unknown; locked?: unknown }[];
  msg?: string;
}

/** Shared by Binance and Tokocrypto (Binance Cloud compatible). */
export function binanceSignature(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

/** Maps a Binance-style account payload to normalized balances. */
export function parseBinanceBalances(payload: BinanceAccountResp): NormalizedBalance[] {
  const rows = Array.isArray(payload.balances) ? payload.balances : [];
  const out: NormalizedBalance[] = [];
  for (const row of rows) {
    if (typeof row?.asset !== "string" || !row.asset) continue;
    const free = toNum(row.free);
    const locked = toNum(row.locked);
    if (free + locked <= 0) continue;
    out.push({ asset: row.asset.toUpperCase(), free, locked });
  }
  return out;
}

export const binanceAdapter: ExchangeAdapter = {
  id: "binance",
  async fetchBalances(creds: ExchangeCredentials): Promise<NormalizedBalance[]> {
    const query = `timestamp=${Date.now()}&recvWindow=10000`;
    const signature = binanceSignature(query, creds.apiSecret);
    const res = await signedFetch(`${BASE}/api/v3/account?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });

    if (!res.ok) {
      // -2014/-2015 = bad key format / no permission for the action.
      if (res.status === 401 || res.status === 403) {
        throw new ExchangeError("auth", `HTTP ${res.status}`);
      }
      throw new ExchangeError("network", `HTTP ${res.status}`);
    }

    const data = (await res.json()) as BinanceAccountResp;
    if (data && typeof data === "object" && "code" in data && typeof data.code === "number") {
      // Signed endpoints can also answer 200 with an error envelope.
      throw new ExchangeError("auth", data.msg ?? `code ${data.code}`);
    }
    if (!Array.isArray(data?.balances)) {
      throw new ExchangeError("unexpected", "missing balances array");
    }
    return parseBinanceBalances(data);
  },
};
