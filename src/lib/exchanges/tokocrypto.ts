/**
 * Tokocrypto adapter — Binance Cloud whitelabel (Binance-compatible engine).
 *
 * Verified live from this sandbox (2026-09):
 *   GET /api/v3/account with a dummy key returns code 3701
 *   "Invalid API-key, IP, or permissions for action" — i.e. the Binance-style
 *   signed account endpoint is routed and enforces API keys. (The older
 *   /open/v1/account/balance path now answers 404.)
 *
 * Signing is identical to Binance: HMAC-SHA256 hex over the query string with
 * the X-MBX-APIKEY header. Responses may use either the Binance shape
 * ({ balances: [...] }) or the whitelabel envelope ({ code, msg, data: [...] })
 * — both are handled. Note: keys created with an IP allowlist must include the
 * server's IP, or the exchange answers 3701 (mapped to "auth").
 */

import {
  ExchangeCredentials,
  ExchangeError,
  ExchangeAdapter,
  NormalizedBalance,
  signedFetch,
  toNum,
} from "./types";
import { binanceSignature } from "./binance";

const BASE = "https://www.tokocrypto.com";

interface TocoResp {
  // Binance shape
  balances?: { asset?: unknown; free?: unknown; locked?: unknown }[];
  // whitelabel envelope shape
  code?: unknown;
  msg?: unknown;
  data?:
    | { asset?: unknown; coin?: unknown; free?: unknown; available?: unknown; locked?: unknown; frozen?: unknown }[]
    | null;
}

export const tokocryptoAdapter: ExchangeAdapter = {
  id: "tokocrypto",
  async fetchBalances(creds: ExchangeCredentials): Promise<NormalizedBalance[]> {
    const query = `timestamp=${Date.now()}&recvWindow=10000`;
    const signature = binanceSignature(query, creds.apiSecret);
    const res = await signedFetch(`${BASE}/api/v3/account?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ExchangeError("auth", `HTTP ${res.status}`);
      }
      throw new ExchangeError("network", `HTTP ${res.status}`);
    }

    const data = (await res.json()) as TocoResp;

    // whitelabel envelope: code 0 = success, anything else is a rejection.
    if (data && typeof data === "object" && "code" in data && !("balances" in data)) {
      const code = Number(data.code);
      if (Number.isFinite(code) && code !== 0) {
        throw new ExchangeError(code === 3701 ? "auth" : "unexpected", String(data.msg ?? code));
      }
    }

    // Binance shape
    if (Array.isArray(data?.balances)) {
      const out: NormalizedBalance[] = [];
      for (const row of data.balances) {
        if (typeof row?.asset !== "string" || !row.asset) continue;
        const free = toNum(row.free);
        const locked = toNum(row.locked);
        if (free + locked <= 0) continue;
        out.push({ asset: row.asset.toUpperCase(), free, locked });
      }
      return out;
    }

    // whitelabel envelope data[] shape (asset|coin, free|available, locked|frozen)
    if (Array.isArray(data?.data)) {
      const out: NormalizedBalance[] = [];
      for (const row of data.data) {
        const asset =
          typeof row?.asset === "string" && row.asset
            ? row.asset
            : typeof row?.coin === "string"
              ? row.coin
              : "";
        if (!asset) continue;
        const free = toNum(row?.free ?? row?.available);
        const locked = toNum(row?.locked ?? row?.frozen);
        if (free + locked <= 0) continue;
        out.push({ asset: asset.toUpperCase(), free, locked });
      }
      return out;
    }

    throw new ExchangeError("unexpected", "unrecognized payload shape");
  },
};
