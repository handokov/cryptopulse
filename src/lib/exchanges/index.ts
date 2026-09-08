/**
 * Exchange registry — the single place that maps an ExchangeId to its adapter
 * and metadata (display name, UI accent, credential requirements).
 */

import { ExchangeAdapter, ExchangeCredentials, ExchangeId } from "./types";
import { binanceAdapter } from "./binance";
import { bitgetAdapter } from "./bitget";
import { tokocryptoAdapter } from "./tokocrypto";
import { demoAdapter } from "./demo";

export * from "./types";

const ADAPTERS: Record<ExchangeId, ExchangeAdapter> = {
  binance: binanceAdapter,
  bitget: bitgetAdapter,
  tokocrypto: tokocryptoAdapter,
  demo: demoAdapter,
};

export function isExchangeId(v: unknown): v is ExchangeId {
  return typeof v === "string" && v in ADAPTERS;
}

export function getAdapter(id: ExchangeId): ExchangeAdapter {
  return ADAPTERS[id];
}

/** Does this exchange's key scheme need a passphrase (Bitget) or credentials at all (demo)? */
export function exchangeNeedsPassphrase(id: ExchangeId): boolean {
  return id === "bitget";
}

export function exchangeNeedsCredentials(id: ExchangeId): boolean {
  return id !== "demo";
}

export async function fetchExchangeBalances(
  id: ExchangeId,
  creds: ExchangeCredentials
): Promise<ReturnType<ExchangeAdapter["fetchBalances"]>> {
  return ADAPTERS[id].fetchBalances(creds);
}
