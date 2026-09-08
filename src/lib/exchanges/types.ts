/**
 * Exchange adapter contracts shared by the per-exchange implementations and
 * the portfolio sync engine. Adapters translate exchange-specific signed
 * requests into a normalized balance list — nothing else knows the wire
 * formats.
 */

export type ExchangeId = "binance" | "bitget" | "tokocrypto" | "demo";

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /** Bitget-only: passphrase chosen when the API key was created. */
  apiPassphrase?: string;
}

/** One asset row from a spot account, quantity already parsed to a number. */
export interface NormalizedBalance {
  /** Exchange asset symbol, e.g. "BTC" — matched against the top-100 board. */
  asset: string;
  free: number;
  locked: number;
}

export type ExchangeErrorCode =
  | "network" // unreachable / timeout / 5xx
  | "auth" // key, secret, passphrase or permissions rejected
  | "rate_limit" // 429-style throttling
  | "market" // price/universe source down → assets cannot be matched
  | "unexpected"; // 200 but unusable payload

export class ExchangeError extends Error {
  code: ExchangeErrorCode;
  /** Raw exchange message when available, for the error details line. */
  detail?: string;

  constructor(code: ExchangeErrorCode, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export interface ExchangeAdapter {
  id: ExchangeId;
  fetchBalances(creds: ExchangeCredentials): Promise<NormalizedBalance[]>;
}

/** Shared helper: fetch with timeout + ExchangeError mapping. */
export async function signedFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch {
    throw new ExchangeError("network");
  }
  if (res.status === 429) throw new ExchangeError("rate_limit");
  return res;
}

/** Parses a numeric string like "0.0012" or "" into a finite number. */
export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
