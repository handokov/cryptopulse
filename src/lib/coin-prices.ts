/**
 * Shared CoinGecko simple/price fetcher: batch USD quotes + 24h change.
 * Extracted from the portfolio route so portfolio / demo / alerts share one
 * implementation (identical headers, timeout, plural vs_currencies, guards).
 */

interface SimplePriceEntry {
  usd?: unknown;
  usd_24h_change?: unknown;
}

export interface SimplePriceMap {
  map: Record<string, { usd: number; change: number }>;
  failed: boolean;
}

/**
 * Fetch current USD prices (+24h change) for the given CoinGecko ids.
 * `failed` is true when nothing resolved (rate limit / network / bad payload).
 * Never throws.
 */
export async function fetchSimplePrices(ids: string[]): Promise<SimplePriceMap> {
  if (ids.length === 0) return { map: {}, failed: false };
  // NOTE: CoinGecko's simple/price requires the plural `vs_currencies`;
  // the singular form returns 422 (param name per API docs).
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
    ","
  )}&vs_currencies=usd&include_24hr_change=true`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) return { map: {}, failed: true };
    const data = (await res.json()) as Record<string, SimplePriceEntry>;
    if (!data || typeof data !== "object") return { map: {}, failed: true };
    const map: Record<string, { usd: number; change: number }> = {};
    for (const id of ids) {
      const entry = data[id];
      const usd = Number(entry?.usd);
      if (entry && Number.isFinite(usd)) {
        map[id] = { usd, change: Number(entry.usd_24h_change ?? 0) || 0 };
      }
    }
    return { map, failed: Object.keys(map).length === 0 };
  } catch {
    return { map: {}, failed: true };
  }
}
