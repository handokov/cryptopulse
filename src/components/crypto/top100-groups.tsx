"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Crosshair, Loader2, Pin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCryptoStore } from "@/store/crypto-store";
import { useLocaleStore } from "@/store/locale-store";
import { ASSET_DEFS } from "@/lib/market-data";
import { fmtPrice, fmtCompactUsd, fmtPct } from "@/lib/format";

/* ---------------- types (mirror /api/market/top100) ---------------- */

interface Top100Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume24h: number;
  sparkline: number[];
  /** Custom pinned coin (outside the top 100) — shown in the trailing "Pinned" group. */
  pinned?: boolean;
}

interface Top100Payload {
  updatedAt: number;
  source: "coingecko" | "cache";
  coins: Top100Coin[];
}

/** Shape returned by GET /api/coin/[id] (AssetSnapshot-compatible). */
interface TraceSnapshot {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  history: number[];
  color: string;
  coingeckoId: string;
  source: "coingecko" | "model";
}

/* ---------------- constants ---------------- */

const CACHE_KEY = "cryptopulse-top100";
const CACHE_TTL_MS = 120_000;
const GROUP_SIZE = 10;
const GROUP_COUNT = 10;
const SKELETON_ROWS = 10;
const TRACKED_SYMBOLS = new Set(ASSET_DEFS.map((a) => a.symbol));

/* ---------------- helpers ---------------- */

/** Downsamples a series to at most `max` points, always keeping the last one. */
function sampleSparkline(data: number[], max = 48): number[] {
  if (data.length <= max) return data;
  const step = data.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(data[Math.min(Math.floor(i * step), data.length - 1)]);
  }
  out[out.length - 1] = data[data.length - 1];
  return out;
}

/** Small 112×32 inline sparkline with an end dot; renders nothing when empty. */
function MiniSpark({ data, up }: { data: number[]; up: boolean }) {
  const geo = useMemo(() => {
    if (!data || data.length < 2) return null;
    const pts = sampleSparkline(data);
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const W = 112;
    const H = 32;
    const coords = pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * (W - 4) + 2;
      const y = H - 4 - ((v - min) / span) * (H - 8);
      return [x, y] as const;
    });
    const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const [lastX, lastY] = coords[coords.length - 1];
    return { points, lastX, lastY };
  }, [data]);

  if (!geo) return null;
  const color = up ? "#10b981" : "#ef4444";
  return (
    <svg viewBox="0 0 112 32" className="h-8 w-28" aria-hidden="true">
      <polyline
        points={geo.points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={geo.lastX} cy={geo.lastY} r={2} fill={color} />
    </svg>
  );
}

/* ---------------- table ---------------- */

interface CoinRowEntry {
  coin: Top100Coin;
  rank: number;
}

function CoinTable({ entries, loading = false }: { entries: CoinRowEntry[]; loading?: boolean }) {
  const t = useTranslations("top100");
  const selectAsset = useCryptoStore((s) => s.selectAsset);
  const setExtraAsset = useCryptoStore((s) => s.setExtraAsset);
  const [traceId, setTraceId] = useState<string | null>(null);
  const tbodyKey = loading ? "skeleton" : `${entries[0]?.rank ?? 0}-${entries.length}`;

  /** Every row is traceable: core symbols select instantly, other coins
      fetch a full 90-day series first so the labs always have data. */
  const traceCoin = useCallback(
    async (coin: Top100Coin) => {
      if (TRACKED_SYMBOLS.has(coin.symbol)) {
        selectAsset(coin.symbol);
        return;
      }
      if (traceId) return;
      setTraceId(coin.id);
      try {
        const res = await fetch(`/api/coin/${coin.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`coin fetch failed: ${res.status}`);
        const snap = (await res.json()) as TraceSnapshot;
        setExtraAsset(snap);
        selectAsset(snap.symbol);
      } catch {
        /* leave the row as-is on failure */
      } finally {
        setTraceId(null);
      }
    },
    [selectAsset, setExtraAsset, traceId]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60">
            <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("rank")}
            </th>
            <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("asset")}
            </th>
            <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("price")}
            </th>
            <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("h24")}
            </th>
            <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("d7")}
            </th>
            <th scope="col" className="hidden py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
              {t("marketCap")}
            </th>
            <th scope="col" className="hidden py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
              {t("volume")}
            </th>
            <th scope="col" className="hidden py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
              {t("last7d")}
            </th>
          </tr>
        </thead>
        <tbody key={tbodyKey} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border/40 last:border-b-0">
                  <td className="py-2.5 pr-3">
                    <Skeleton className="h-4 w-7" />
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <Skeleton className="h-6 w-6 rounded-full" />
                      <Skeleton className="h-4 w-28" />
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Skeleton className="ml-auto h-4 w-16" />
                  </td>
                  <td className="py-2.5 pr-3">
                    <Skeleton className="ml-auto h-4 w-12" />
                  </td>
                  <td className="py-2.5 pr-3">
                    <Skeleton className="ml-auto h-4 w-12" />
                  </td>
                  <td className="hidden py-2.5 pr-3 md:table-cell">
                    <Skeleton className="ml-auto h-4 w-14" />
                  </td>
                  <td className="hidden py-2.5 pr-3 lg:table-cell">
                    <Skeleton className="ml-auto h-4 w-14" />
                  </td>
                  <td className="hidden py-2.5 md:table-cell">
                    <Skeleton className="ml-auto h-8 w-28" />
                  </td>
                </tr>
              ))
            : entries.map(({ coin, rank }) => {
                const tracked = TRACKED_SYMBOLS.has(coin.symbol);
                const tracing = traceId === coin.id;
                const up24 = coin.change24h >= 0;
                const up7 = coin.change7d >= 0;
                return (
                  <tr
                    key={coin.id}
                    role="button"
                    tabIndex={0}
                    aria-label={t("selectAria", { name: coin.name })}
                    onClick={() => void traceCoin(coin)}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void traceCoin(coin);
                      }
                    }}
                    className="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-white/5"
                  >
                    <td className="tnum py-2.5 pr-3 font-mono">
                      {tracing ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-primary"
                          aria-label={t("loadingCoin")}
                        />
                      ) : coin.pinned ? (
                        <Pin className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                      ) : (
                        <span className={rank <= 3 ? "font-semibold text-amber-400" : "text-muted-foreground"}>
                          {rank}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        <img src={coin.image} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium leading-tight text-foreground">{coin.name}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs uppercase leading-tight text-muted-foreground">{coin.symbol}</span>
                            {tracked && (
                              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                                {t("tracked")}
                              </span>
                            )}
                            {coin.pinned && (
                              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-400">
                                {t("customBadge")}
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="tnum py-2.5 pr-3 text-right font-medium text-foreground">{fmtPrice(coin.price)}</td>
                    <td className={`tnum py-2.5 pr-3 text-right font-semibold ${up24 ? "text-primary" : "text-destructive"}`}>
                      {fmtPct(coin.change24h)}
                    </td>
                    <td className={`tnum py-2.5 pr-3 text-right font-semibold ${up7 ? "text-primary" : "text-destructive"}`}>
                      {fmtPct(coin.change7d)}
                    </td>
                    <td className="tnum hidden py-2.5 pr-3 text-right text-muted-foreground md:table-cell">
                      {fmtCompactUsd(coin.marketCap)}
                    </td>
                    <td className="tnum hidden py-2.5 pr-3 text-right text-muted-foreground lg:table-cell">
                      {fmtCompactUsd(coin.volume24h)}
                    </td>
                    <td className="hidden py-2.5 text-right md:table-cell">
                      <span className="inline-flex justify-end">
                        <MiniSpark data={coin.sparkline} up={up7} />
                      </span>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- main component ---------------- */

export function Top100Groups() {
  const t = useTranslations("top100");
  const locale = useLocaleStore((s) => s.locale);

  const [coins, setCoins] = useState<Top100Coin[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [source, setSource] = useState<"coingecko" | "cache">("coingecko");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [groupIndex, setGroupIndex] = useState(0);

  const hasDataRef = useRef(false);

  const applyPayload = useCallback((p: Top100Payload) => {
    setCoins(p.coins);
    setUpdatedAt(p.updatedAt);
    setSource(p.source);
    setError(false);
    hasDataRef.current = true;
  }, []);

  const load = useCallback(
    async (spinner: boolean) => {
      if (spinner) setLoading(true);
      try {
        const res = await fetch("/api/market/top100", { cache: "no-store" });
        if (!res.ok) throw new Error(`top100 fetch failed: ${res.status}`);
        const p = (await res.json()) as Top100Payload;
        applyPayload(p);
        setLoading(false);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload: p }));
        } catch {
          /* storage unavailable — ignore */
        }
      } catch {
        setLoading(false);
        if (spinner || !hasDataRef.current) setError(true);
      }
    },
    [applyPayload]
  );

  useEffect(() => {
    let hydrateFromCache = false;
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts?: number; payload?: Top100Payload };
        if (
          parsed &&
          typeof parsed.ts === "number" &&
          Date.now() - parsed.ts < CACHE_TTL_MS &&
          Array.isArray(parsed.payload?.coins) &&
          parsed.payload.coins.length > 0
        ) {
          hydrateFromCache = true;
          const payload = parsed.payload;
          setTimeout(() => {
            applyPayload(payload as Top100Payload);
            setLoading(false);
          }, 0);
        }
      }
    } catch {
      /* malformed cache — ignore and fetch */
    }
    void load(!hydrateFromCache);
  }, [applyPayload, load]);

  const refetch = useCallback(() => {
    void load(true);
  }, [load]);

  const searching = query.trim().length > 0;
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!searching) return [];
    return coins
      .map((coin, i) => ({ coin, rank: i + 1 }))
      .filter(({ coin }) => coin.name.toLowerCase().includes(q) || coin.symbol.toLowerCase().includes(q));
  }, [coins, q, searching]);

  const groupCoins = useMemo(() => {
    const from = groupIndex * GROUP_SIZE;
    return coins.slice(from, from + GROUP_SIZE).map((coin, i) => ({ coin, rank: from + i + 1 }));
  }, [coins, groupIndex]);

  const groupFrom = groupIndex * GROUP_SIZE + 1;
  const groupTo = groupFrom + GROUP_SIZE - 1;
  const groupAvg = useMemo(() => {
    if (!groupCoins.length) return 0;
    return groupCoins.reduce((sum, { coin }) => sum + coin.change24h, 0) / groupCoins.length;
  }, [groupCoins]);

  /* Custom pinned coins live in a trailing group past the ten numbered ones
     (they are appended after the top 100 in the payload, so the same slice
     logic serves them). */
  const isCustomGroup = groupIndex === GROUP_COUNT;
  const hasCustomGroup = useMemo(() => coins.some((c) => c.pinned), [coins]);
  const maxGroupIndex = hasCustomGroup ? GROUP_COUNT : GROUP_COUNT - 1;

  return (
    <div className="flex flex-col gap-4">
      {/* search + freshness strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-9 border-border bg-card/60 pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {updatedAt != null && (
            <span className="tnum">{t("updated", { time: new Date(updatedAt).toLocaleTimeString(locale) })}</span>
          )}
          {source === "cache" && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-400">
              {t("stale")}
            </span>
          )}
        </div>
      </div>

      {/* traceability note */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Crosshair className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
        {t("allTraceable")}
      </p>

      {/* group pills */}
      {!searching && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label={t("prevGroup")}
            disabled={groupIndex === 0}
            onClick={() => setGroupIndex((i) => Math.max(0, i - 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {Array.from({ length: GROUP_COUNT }, (_, i) => {
            const from = i * GROUP_SIZE + 1;
            const to = from + GROUP_SIZE - 1;
            const active = i === groupIndex;
            return (
              <button
                key={from}
                type="button"
                aria-label={t("groupAria", { from, to })}
                aria-pressed={active}
                onClick={() => setGroupIndex(i)}
                className={`tnum rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {from}–{to}
              </button>
            );
          })}
          {hasCustomGroup && (
            <button
              type="button"
              aria-label={t("customGroupTitle")}
              aria-pressed={isCustomGroup}
              onClick={() => setGroupIndex(GROUP_COUNT)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                isCustomGroup
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Pin className="h-3 w-3" aria-hidden="true" />
              {t("customGroup")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("nextGroup")}
            disabled={groupIndex === maxGroupIndex}
            onClick={() => setGroupIndex((i) => Math.min(maxGroupIndex, i + 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* group header */}
      {!searching && !loading && !error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isCustomGroup ? t("customGroupTitle") : t("groupAria", { from: groupFrom, to: groupTo })}
          </p>
          <span className="tnum rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            {t("groupAvg", { value: fmtPct(groupAvg) })}
          </span>
        </div>
      )}

      {/* board */}
      {error && !hasDataRef.current ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">{t("error")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={refetch}
            className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          >
            {t("retry")}
          </Button>
        </div>
      ) : searching ? (
        filtered.length > 0 ? (
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <CoinTable entries={filtered} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            {t("empty", { query: query.trim() })}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
          <CoinTable entries={groupCoins} loading={loading} />
        </div>
      )}
    </div>
  );
}
