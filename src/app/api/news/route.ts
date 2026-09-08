import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const dynamic = "force-dynamic";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  date: string;
  trusted: boolean;
}

/** Sources we treat as trusted crypto/market outlets (host fragments). */
const TRUSTED_HOSTS = [
  "coindesk.com",
  "cointelegraph.com",
  "bloomberg.com",
  "reuters.com",
  "theblock.co",
  "decrypt.co",
  "crypto.news",
  "bitcoinmagazine.com",
  "cnbc.com",
  "forbes.com",
  "finance.yahoo.com",
  "blockworks.co",
  "coinmarketcap.com",
  "theblock.com",
  "cryptoslate.com",
  "bitcoinist.com",
  "cryptopotato.com",
  "newsbtc.com",
];

const QUERIES = [
  { q: "crypto market today bitcoin ethereum analysis news", recency: 2 },
  { q: "bitcoin price news institutional ETF flows", recency: 3 },
  { q: "ethereum solana altcoin market news", recency: 3 },
  { q: "crypto regulation macro news fed rates digital assets", recency: 4 },
];

const FALLBACK_ITEMS: NewsItem[] = [
  {
    title: "Bitcoin range tightens as traders watch ETF flow data for direction",
    url: "https://www.coindesk.com/markets",
    source: "coindesk.com",
    snippet:
      "Spot ETF flows remain the dominant marginal buyer narrative; analysts flag the 50-day moving average as the level bulls need to defend into the next macro print.",
    date: new Date().toISOString().slice(0, 10),
    trusted: true,
  },
  {
    title: "Ethereum staking yields and L2 activity stay central to the ETH narrative",
    url: "https://cointelegraph.com/tags/ethereum",
    source: "cointelegraph.com",
    snippet:
      "Layer-2 throughput records continue while base-fee burn keeps net issuance deflationary on high-activity weeks, according to on-chain dashboards.",
    date: new Date().toISOString().slice(0, 10),
    trusted: true,
  },
  {
    title: "Solana DEX volumes capture share as new listings draw speculative flow",
    url: "https://www.theblock.co/data",
    source: "theblock.co",
    snippet:
      "Decentralized exchange share data shows SOL-quoted pairs punching above their market-cap weight, a pattern historically associated with high-beta altcoin regimes.",
    date: new Date().toISOString().slice(0, 10),
    trusted: true,
  },
  {
    title: "Macro desk: rate-cut odds keep risk assets bid, but volatility term structure warns",
    url: "https://www.reuters.com/markets/",
    source: "reuters.com",
    snippet:
      "Cross-asset strategists note crypto's 30-day realized volatility remains well above equities; sizing discipline is advised around CPI and FOMC windows.",
    date: new Date().toISOString().slice(0, 10),
    trusted: true,
  },
  {
    title: "Stablecoin supply growth read as a leading liquidity signal for crypto",
    url: "https://decrypt.co/news",
    source: "decrypt.co",
    snippet:
      "Net issuance of major stablecoins has re-accelerated month-over-month, a flow-based proxy analysts use to gauge dry powder sitting on exchanges.",
    date: new Date().toISOString().slice(0, 10),
    trusted: true,
  },
];

interface CacheEntry {
  items: NewsItem[];
  source: "live" | "fallback";
  ts: number;
}

const globalCache = globalThis as unknown as { __cpNewsCache?: CacheEntry };
const CACHE_MS = 5 * 60_000;

function hostToSource(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

function isTrusted(host: string): boolean {
  const h = hostToSource(host);
  return TRUSTED_HOSTS.some((t) => h === t || h.endsWith("." + t) || h.includes(t));
}

function scoreItem(item: RawItem): number {
  // trusted sources first, then recency (lexicographic date helps), then rank
  const trust = isTrusted(item.host_name) ? 1000 : 0;
  const dateBoost = /^\d{4}-\d{2}-\d{2}/.test(item.date) ? 100 : 0;
  const rankPenalty = Math.min(item.rank ?? 10, 10);
  return trust + dateBoost - rankPenalty;
}

interface RawItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank?: number;
  date?: string;
}

export async function GET() {
  const now = Date.now();
  const cached = globalCache.__cpNewsCache;
  if (cached && now - cached.ts < CACHE_MS) {
    return NextResponse.json({ updatedAt: cached.ts, source: cached.source, items: cached.items });
  }

  try {
    const zai = await ZAI.create();
    // sequential + tiny stagger to stay under the remote rate limit
    const merged: RawItem[] = [];
    const seen = new Set<string>();
    for (const { q, recency } of QUERIES.slice(0, 2)) {
      try {
        const res = (await zai.functions.invoke("web_search", { query: q, num: 8, recency_days: recency })) as RawItem[];
        for (const item of Array.isArray(res) ? res : []) {
          if (!item?.url || !item?.name) continue;
          const key = item.url.split("?")[0];
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(item);
        }
      } catch (e) {
        console.error("search query failed:", e instanceof Error ? e.message : e);
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (merged.length === 0) throw new Error("no search results");

    const items: NewsItem[] = merged
      .sort((a, b) => scoreItem(b) - scoreItem(a))
      .slice(0, 12)
      .map((item) => ({
        title: item.name.trim(),
        url: item.url,
        source: hostToSource(item.host_name || new URL(item.url).hostname),
        snippet: (item.snippet ?? "").trim().slice(0, 240),
        date: (item.date ?? "").slice(0, 10),
        trusted: isTrusted(item.host_name || new URL(item.url).hostname),
      }));

    const entry: CacheEntry = { items, source: "live", ts: now };
    globalCache.__cpNewsCache = entry;
    return NextResponse.json({ updatedAt: now, source: "live", items });
  } catch (err) {
    console.error("news route error:", err);
    const entry: CacheEntry = { items: FALLBACK_ITEMS, source: "fallback", ts: now };
    globalCache.__cpNewsCache = entry;
    return NextResponse.json({ updatedAt: now, source: "fallback", items: FALLBACK_ITEMS });
  }
}
