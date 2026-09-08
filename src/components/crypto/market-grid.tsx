"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCryptoStore } from "@/store/crypto-store";
import { fmtPrice, fmtCompactUsd, fmtPct } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";

function Sparkline({ data, color, up }: { data: number[]; color: string; up: boolean }) {
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const W = 220;
    const H = 44;
    return data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - 4 - ((v - min) / span) * (H - 8);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data]);

  return (
    <svg viewBox="0 0 220 44" className="h-11 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={up ? color : "#f43f5e"} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function AssetCard({ symbol }: { symbol: string }) {
  const t = useTranslations("markets");
  const asset = useCryptoStore((s) => s.assets.find((a) => a.symbol === symbol));
  const selected = useCryptoStore((s) => s.selected);
  const selectAsset = useCryptoStore((s) => s.selectAsset);
  const isSelected = selected === symbol;
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!isSelected) return;
    const t1 = setTimeout(() => setFlash(true), 0);
    const t2 = setTimeout(() => setFlash(false), 1050);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSelected]);

  if (!asset) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-3 h-6 w-24" />
        <Skeleton className="mt-3 h-11 w-full" />
        <Skeleton className="mt-3 h-3 w-32" />
      </div>
    );
  }

  const up = asset.change24h >= 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => selectAsset(asset.symbol)}
      aria-pressed={isSelected}
      aria-label={t("selectAria", { name: asset.name })}
      className={`group relative w-full rounded-xl border bg-card p-4 text-left transition-colors ${
        isSelected ? "border-primary/70" : "border-border hover:border-primary/40"
      } ${flash ? "flash-pulse" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold" style={{ backgroundColor: `${asset.color}22`, color: asset.color }}>
            {asset.symbol.slice(0, 3)}
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">{asset.name}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{asset.symbol} / USD</p>
          </div>
        </div>
        {up ? (
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
          <TrendingDown className="h-4 w-4 text-destructive" aria-hidden="true" />
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-xl font-bold tracking-tight">{fmtPrice(asset.price)}</span>
        <span className={`tnum text-xs font-semibold ${up ? "text-primary" : "text-destructive"}`}>
          {fmtPct(asset.change24h)}
        </span>
      </div>

      <div className="mt-2">
        <Sparkline data={asset.history.slice(-30)} color={asset.color} up={up} />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tnum">{t("vol", { value: fmtCompactUsd(asset.volume24h) })}</span>
        <span className="tnum">{t("mcap", { value: fmtCompactUsd(asset.marketCap) })}</span>
      </div>

      {isSelected && (
        <span className="absolute right-3 top-3 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {t("tracking")}
        </span>
      )}
    </motion.button>
  );
}

export function MarketGrid() {
  const assets = useCryptoStore((s) => s.assets);
  const symbols = assets.map((a) => a.symbol);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(symbols.length ? symbols : Array.from({ length: 8 }, () => "")).map((s, i) =>
        s ? (
          <AssetCard key={s} symbol={s} />
        ) : (
          <div key={`sk-${i}`} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-3 h-6 w-24" />
            <Skeleton className="mt-3 h-11 w-full" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        )
      )}
    </div>
  );
}
