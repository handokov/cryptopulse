"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, RefreshCw, ShieldCheck, Newspaper, Signal } from "lucide-react";

interface NewsItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  date: string;
  trusted: boolean;
}

interface NewsResponse {
  updatedAt: number;
  source: "live" | "fallback";
  items: NewsItem[];
}

export function NewsFeed() {
  const t = useTranslations("news");
  const [data, setData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [trustedOnly, setTrustedOnly] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      if (!res.ok) throw new Error("news fetch failed");
      setData((await res.json()) as NewsResponse);
      setFlash(true);
      setTimeout(() => setFlash(false), 1050);
    } catch {
      /* keep previous data on failure */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = (data?.items ?? []).filter((i) => (trustedOnly ? i.trusted : true));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={load}
          disabled={refreshing}
          className={`bg-primary/15 text-primary hover:bg-primary/25 ${flash ? "flash-pulse" : ""}`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? t("refreshing") : t("refresh")}
        </Button>
        <Button
          size="sm"
          variant={trustedOnly ? "secondary" : "ghost"}
          onClick={() => setTrustedOnly((v) => !v)}
          aria-pressed={trustedOnly}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {trustedOnly ? t("trustedOnly") : t("allSources")}
        </Button>
        {data && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {data.source === "live" ? (
              <>
                <Signal className="h-3 w-3 text-primary" /> {t("liveVia")}
              </>
            ) : (
              <>
                <Newspaper className="h-3 w-3 text-accent" /> {t("cachedBrief")}
              </>
            )}
            · {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className={`nice-scroll max-h-[520px] space-y-3 overflow-y-auto pr-1 ${flash ? "flash-pulse rounded-xl" : ""}`}>
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2 h-5 w-3/4" />
              <Skeleton className="mt-2 h-3.5 w-full" />
              <Skeleton className="mt-1 h-3.5 w-2/3" />
            </div>
          ))}

        {!loading && items.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {t("noMatch")}
          </p>
        )}

        {items.map((item, i) => (
          <motion.a
            key={item.url + i}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.3) }}
            className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${item.trusted ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"}`}>
                {item.source}
              </span>
              {item.trusted && <ShieldCheck className="h-3 w-3 text-primary" aria-label="trusted source" />}
              {item.date && <span className="tnum">{item.date}</span>}
              <ExternalLink className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <h3 className="mt-1.5 text-sm font-semibold leading-snug group-hover:text-primary">{item.title}</h3>
            {item.snippet && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.snippet}</p>}
          </motion.a>
        ))}
      </div>
    </div>
  );
}
