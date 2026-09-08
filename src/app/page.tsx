"use client";

import { useTranslations } from "next-intl";
import { SiteHeader } from "@/components/crypto/site-header";
import { SiteFooter } from "@/components/crypto/site-footer";
import { MorphingHero } from "@/components/crypto/morphing-hero";
import { MarketDataLoader } from "@/components/crypto/market-data-loader";
import { MarketGrid } from "@/components/crypto/market-grid";
import { Top100Groups } from "@/components/crypto/top100-groups";
import { LabPanels } from "@/components/crypto/lab-panels";
import { AnalysisEngine } from "@/components/crypto/analysis-engine";
import { NewsFeed } from "@/components/crypto/news-feed";
import { PortfolioSection } from "@/components/crypto/portfolio-section";
import { Newspaper } from "lucide-react";

function SectionHeading({
  index,
  title,
  subtitle,
}: {
  index: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-6">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">{index}</p>
      <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function Home() {
  const tMarkets = useTranslations("markets");
  const tTop100 = useTranslations("top100");
  const tLabs = useTranslations("labs");
  const tAnalysis = useTranslations("analysis");
  const tNews = useTranslations("news");
  const tPortfolio = useTranslations("portfolio");

  return (
    <div id="top" className="flex min-h-screen flex-col bg-background bg-grid">
      <MarketDataLoader />
      <SiteHeader />

      <main className="flex-1">
        {/* 01 — Markets */}
        <section id="markets" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tMarkets("title")}>
          <SectionHeading
            index={tMarkets("index")}
            title={tMarkets("title")}
            subtitle={tMarkets("subtitle")}
          />
          <MarketGrid />
        </section>

        {/* 02 — Top 100 board */}
        <section id="top100" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tTop100("title")}>
          <SectionHeading
            index={tTop100("index")}
            title={tTop100("title")}
            subtitle={tTop100("subtitle")}
          />
          <Top100Groups />
        </section>

        {/* 03 — Signal labs */}
        <section id="labs" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tLabs("title")}>
          <SectionHeading
            index={tLabs("index")}
            title={tLabs("title")}
            subtitle={tLabs("subtitle")}
          />
          <LabPanels />
        </section>

        {/* 04 — Analysis */}
        <section id="analysis" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tAnalysis("title")}>
          <SectionHeading
            index={tAnalysis("index")}
            title={tAnalysis("title")}
            subtitle={tAnalysis("subtitle")}
          />
          <AnalysisEngine />
        </section>

        {/* 05 — News */}
        <section id="news" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tNews("title")}>
          <SectionHeading
            index={tNews("index")}
            title={tNews("title")}
            subtitle={tNews("subtitle")}
          />
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Newspaper className="h-4 w-4 text-primary" /> {tNews("feed")}
            </div>
            <NewsFeed />
          </div>
        </section>

        {/* 06 — Portfolio dashboard */}
        <section id="portfolio" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label={tPortfolio("title")}>
          <SectionHeading
            index={tPortfolio("index")}
            title={tPortfolio("title")}
            subtitle={tPortfolio("subtitle")}
          />
          <PortfolioSection />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
