"use client";

/**
 * MarketMovers — Bitget-style market dropdown for the Markets section.
 *
 * A trigger button opens a popover panel listing Bitget USDT spot pairs with
 * last price, 24 h change and volume. Tabs mirror the exchange board:
 * gainers / losers / volume. Rows link straight to the pair on Bitget.
 * Data: /api/market/movers (server-cached 60 s), polled every 60 s.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ExternalLink, RefreshCw, Search, TrendingDown, TrendingUp, BarChart3 } from "lucide-react";
import { fmtPrice, fmtCompactUsd, fmtPct } from "@/lib/format";

interface MoverRow {
  symbol: string;
  base: string;
  price: number;
  change24h: number;
  volumeUsdt: number;
}

interface MoversPayload {
  updatedAt: number;
  total: number;
  rows: MoverRow[];
}

type Tab = "gainers" | "losers" | "volume";

const TABS: Tab[] = ["gainers", "losers", "volume"];

/** Bitget change24h is a FRACTION (0.0204 = +2.04 %) — scale before fmtPct. */
const fmtChange = (fraction: number) => fmtPct(fraction * 100);

/** Extra precision for micro-priced pairs the shared fmtPrice renders as $0.0000. */
function fmtMoverPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toFixed(8)}`;
}

export function MarketMovers() {
  const t = useTranslations("markets.movers");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("gainers");
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<MoversPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (spinner: boolean) => {
    const reqId = ++reqRef.current;
    if (spinner) setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/market/movers?minVol=50000&limit=300", { cache: "no-store" });
      if (!res.ok) throw new Error(`movers fetch failed: ${res.status}`);
      const p = (await res.json()) as MoversPayload;
      if (reqId !== reqRef.current) return; // stale response
      setPayload(p);
    } catch {
      if (reqId === reqRef.current) {
        setError(true);
        setPayload(null);
      }
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, []);

  /* Fetch on mount + poll every 60 s so the panel is instant when opened. */
  useEffect(() => {
    void load(true);
    const iv = setInterval(() => void load(false), 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const rows = useMemo(() => {
    const all = payload?.rows ?? [];
    const sorted = [...all];
    if (tab === "gainers") sorted.sort((a, b) => b.change24h - a.change24h);
    else if (tab === "losers") sorted.sort((a, b) => a.change24h - b.change24h);
    /* volume tab keeps the server's volume-desc order */
    const q = query.trim().toLowerCase();
    if (!q) return sorted.slice(0, 80);
    return sorted
      .filter((r) => r.base.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q))
      .slice(0, 80);
  }, [payload, tab, query]);

  const updatedLabel = useMemo(() => {
    if (!payload?.updatedAt) return "";
    const d = new Date(payload.updatedAt);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss} UTC`;
  }, [payload?.updatedAt]);

  const topMover = useMemo(() => {
    if (!payload?.rows?.length) return null;
    return payload.rows.reduce((best, r) => (r.change24h > best.change24h ? r : best), payload.rows[0]);
  }, [payload]);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {/* left micro-label — echoes the section's mono index style */}
      <p className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:flex">
        <BarChart3 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        {t("stripLabel")}
        {topMover && !error && (
          <span className="tnum font-sans normal-case tracking-normal">
            · <TrendingUp className="mr-0.5 inline h-3 w-3 text-primary" aria-hidden="true" />
            {topMover.base}
            <span className={topMover.change24h >= 0 ? "text-primary" : "text-destructive"}>
              {" "}
              {fmtChange(topMover.change24h)}
            </span>
          </span>
        )}
      </p>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            aria-label={t("triggerAria")}
          >
            <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className={open ? "text-primary" : undefined}>{t("trigger")}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,26rem)] p-0">
          {/* panel header: tabs + search */}
          <div className="border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5" role="tablist" aria-label={t("trigger")}>
                {TABS.map((id) => {
                  const active = tab === id;
                  const Icon = id === "gainers" ? TrendingUp : id === "losers" ? TrendingDown : BarChart3;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {t(id)}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                aria-label={t("refreshAria")}
                className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:text-primary"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              </button>
            </div>

            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPair")}
                className="h-8 border-border bg-background pl-8 text-xs"
                aria-label={t("searchPair")}
              />
            </div>
          </div>

          {/* column captions — Bitget board echo */}
          <div className="flex items-center justify-between px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>{t("colPair")}</span>
            <span className="flex items-center gap-4">
              <span>{t("colLast")}</span>
              <span className="w-16 text-right">{t("colChange")}</span>
            </span>
          </div>

          {/* rows */}
          <div className="max-h-80 overflow-y-auto overscroll-contain">
            {loading && !payload && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {t("error")}
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">{t("empty")}</div>
            )}

            {rows.map((r) => {
              const up = r.change24h >= 0;
              return (
                <a
                  key={r.symbol}
                  href={`https://www.bitget.com/spot/${r.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-primary/5"
                  aria-label={t("pairAria", { pair: `${r.base}/USDT` })}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold">{r.base}/USDT</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="tnum text-muted-foreground">{fmtMoverPrice(r.price)}</span>
                    <span className={`tnum w-16 text-right font-semibold ${up ? "text-primary" : "text-destructive"}`}>
                      {fmtChange(r.change24h)}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>

          {/* panel footer */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span className="tnum">
              {payload ? t("updated", { time: updatedLabel }) : ""}
              {payload ? ` · ${t("pairCount", { count: payload.total })}` : ""}
            </span>
            <a
              href="https://www.bitget.com/spot"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary hover:underline"
            >
              {t("viewAll")}
            </a>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
