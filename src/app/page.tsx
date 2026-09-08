import { SiteHeader } from "@/components/crypto/site-header";
import { SiteFooter } from "@/components/crypto/site-footer";
import { MorphingHero } from "@/components/crypto/morphing-hero";
import { MarketDataLoader } from "@/components/crypto/market-data-loader";
import { MarketGrid } from "@/components/crypto/market-grid";
import { SignalPolygon } from "@/components/crypto/signal-polygon";
import { ProjectionLab } from "@/components/crypto/projection-lab";
import { AnalysisEngine } from "@/components/crypto/analysis-engine";
import { NewsFeed } from "@/components/crypto/news-feed";
import { LabPanels } from "@/components/crypto/lab-panels";
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
  return (
    <div id="top" className="flex min-h-screen flex-col bg-background bg-grid">
      <MarketDataLoader />
      <SiteHeader />

      <main className="flex-1">
        <MorphingHero />

        {/* 01 — Markets */}
        <section id="markets" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label="Market trends">
          <SectionHeading
            index="01 / MARKETS"
            title="Daily trend tracking — high-volume assets"
            subtitle="Live snapshot of the highest-liquidity crypto assets. Sparklines show the last 30 sessions; click any card to focus every lab and the analysis engine on that asset."
          />
          <MarketGrid />
        </section>

        {/* 02 — Signal labs */}
        <section id="labs" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label="Signal labs">
          <SectionHeading
            index="02 / SIGNAL LABS"
            title="Shape the signal, then bend the curve"
            subtitle="The Signal Polygon turns factor weights into geometry — drag its vertices and watch values read back in real time. The Projection Lab turns those assumptions into a slider-driven price function with a confidence band."
          />
          <LabPanels />
        </section>

        {/* 03 — Analysis */}
        <section id="analysis" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label="Forward analysis">
          <SectionHeading
            index="03 / FORWARD ANALYSIS"
            title="Step-by-step trading verdicts, line by line"
            subtitle="One run computes SMA bias, RSI, MACD, Bollinger envelope, realized volatility, volume participation and your vertex blend — each step revealed line by line with a color-coded read."
          />
          <AnalysisEngine />
        </section>

        {/* 04 — News */}
        <section id="news" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16" aria-label="News aggregation">
          <SectionHeading
            index="04 / NEWS AGGREGATION"
            title="What trusted outlets are printing today"
            subtitle="Aggregated from established crypto and market desks (CoinDesk, Cointelegraph, Reuters, Bloomberg, The Block and more), deduplicated and ranked — trusted sources first."
          />
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Newspaper className="h-4 w-4 text-primary" /> Feed
            </div>
            <NewsFeed />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
