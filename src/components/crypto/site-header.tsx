"use client";

import { useTranslations } from "next-intl";
import { useCryptoStore } from "@/store/crypto-store";
import { fmtPrice, fmtPct } from "@/lib/format";
import { LanguageSwitcher } from "./language-switcher";
import { Activity } from "lucide-react";

export function SiteHeader() {
  const t = useTranslations("nav");
  const btc = useCryptoStore((s) => s.assets.find((a) => a.symbol === "BTC"));

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <a href="#top" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </span>
          Crypto<span className="text-primary">Pulse</span>
        </a>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Primary">
          <a href="#markets" className="transition-colors hover:text-foreground">{t("markets")}</a>
          <a href="#news" className="transition-colors hover:text-foreground">{t("news")}</a>
          <a href="#labs" className="transition-colors hover:text-foreground">{t("labs")}</a>
          <a href="#analysis" className="transition-colors hover:text-foreground">{t("analysis")}</a>
        </nav>

        <div className="flex items-center gap-2.5 text-xs">
          {btc && (
            <span className="tnum hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 sm:flex">
              <span className="font-semibold text-foreground/80">BTC</span>
              <span>{fmtPrice(btc.price)}</span>
              <span className={btc.change24h >= 0 ? "font-medium text-primary" : "font-medium text-destructive"}>
                {fmtPct(btc.change24h)}
              </span>
            </span>
          )}
          <span className="hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 font-medium text-primary lg:flex">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" />
            24/7 LIVE
          </span>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
