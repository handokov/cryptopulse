"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCryptoStore, FACTOR_META } from "@/store/crypto-store";
import { useLocaleStore } from "@/store/locale-store";
import { Button } from "@/components/ui/button";
import { fmtPrice, fmtPct } from "@/lib/format";
import type { AnalysisStep, StepTone } from "@/lib/analysis-engine";
import { Radar, Loader2, CircleCheck, Minus, TriangleAlert, XCircle } from "lucide-react";

const TONE_STYLES: Record<StepTone, { icon: React.ReactNode; text: string }> = {
  info: { icon: <Minus className="h-3.5 w-3.5 text-sky-300/80" />, text: "text-foreground/80" },
  good: { icon: <CircleCheck className="h-3.5 w-3.5 text-primary" />, text: "text-primary" },
  warn: { icon: <TriangleAlert className="h-3.5 w-3.5 text-accent" />, text: "text-accent" },
  bad: { icon: <XCircle className="h-3.5 w-3.5 text-destructive" />, text: "text-destructive" },
};

export function AnalysisEngine() {
  const t = useTranslations("analysis");
  const tFactors = useTranslations("factors");
  const tProjection = useTranslations("projection");
  const selected = useCryptoStore((s) => s.selected);
  const extraAsset = useCryptoStore((s) => s.extraAssets[s.selected]);
  const factors = useCryptoStore((s) => s.factors);
  const horizon = useCryptoStore((s) => s.horizon);
  const analysis = useCryptoStore((s) => s.analysis);
  const analyzing = useCryptoStore((s) => s.analyzing);
  const revealedSteps = useCryptoStore((s) => s.revealedSteps);
  const setAnalyzing = useCryptoStore((s) => s.setAnalyzing);
  const setAnalysis = useCryptoStore((s) => s.setAnalysis);
  const revealStep = useCryptoStore((s) => s.revealStep);
  const firePulse = useCryptoStore((s) => s.firePulse);
  const locale = useLocaleStore((s) => s.locale);

  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* ---- line-by-line reveal ---- */
  useEffect(() => {
    if (!analysis || analyzing) return;
    if (revealedSteps >= analysis.steps.length) return;
    const timer = setTimeout(() => {
      revealStep();
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }, 420);
    return () => clearTimeout(timer);
  }, [analysis, analyzing, revealedSteps, revealStep]);

  const runAnalysis = async () => {
    setError(null);
    setAnalyzing(true);
    firePulse();
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: selected, horizon, factors, locale, coinId: extraAsset?.coingeckoId }),
      });
      if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
      const data = (await res.json()) as Parameters<typeof setAnalysis>[0];
      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const verdictDone = !!analysis && !analyzing && revealedSteps >= analysis.steps.length;
  /* Label the terminal with the horizon the RESULTS were computed at (the
     baked analysis), falling back to the live slider before the first run —
     prevents "header says 30d, math says 45d" style contradictions. */
  const displayHorizon = analysis?.projection.horizonDays ?? horizon;
  const verdictTone =
    analysis?.verdict.action === "LONG"
      ? { badge: "bg-primary/15 text-primary border-primary/40", glow: "verdict-glow" }
      : analysis?.verdict.action === "SHORT"
        ? { badge: "bg-destructive/15 text-destructive border-destructive/40", glow: "" }
        : { badge: "bg-accent/15 text-accent border-accent/40", glow: "" };

  const actionLabel =
    analysis?.verdict.action === "LONG"
      ? t("actions.long")
      : analysis?.verdict.action === "SHORT"
        ? t("actions.short")
        : t("actions.neutral");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* terminal */}
      <div
        className={`flex h-[430px] flex-col overflow-hidden rounded-xl border bg-[#0c1210] ${
          analyzing ? "pulse-amber border-accent/60" : "border-border"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-accent/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
            </span>
            forward-analysis — {selected.toLowerCase()}@{displayHorizon}
            {tProjection("daysShort")}
          </div>
          {analyzing && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
              <Loader2 className="h-3 w-3 animate-spin" /> computing…
            </span>
          )}
        </div>

        <div ref={listRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto p-4 font-mono text-xs">
          {!analysis && !analyzing && (
            <p className="flex h-full items-center justify-center text-center text-muted-foreground">
              {t("placeholderBefore")}{" "}
              <span className="mx-1 rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">{t("run")}</span>{" "}
              {t("placeholderAfter")}
            </p>
          )}
          {analyzing && !analysis && (
            <div className="space-y-2.5 text-muted-foreground">
              {[0, 1, 2].map((i) => (
                <p key={i} className="step-in" style={{ animationDelay: `${i * 0.25}s` }}>
                  <span className="text-accent">▚</span>{" "}
                  {t("computing", {
                    symbol: selected,
                    count: String(FACTOR_META.filter((f) => factors[f.key] !== 50).length),
                  })}
                </p>
              ))}
            </div>
          )}
          <AnimatePresence>
            {analysis &&
              analysis.steps.slice(0, revealedSteps).map((step: AnalysisStep) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="flex gap-2.5"
                >
                  <span className="tnum shrink-0 text-muted-foreground/60">{String(step.id).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <p className={`flex items-center gap-1.5 font-semibold ${TONE_STYLES[step.tone].text}`}>
                      {TONE_STYLES[step.tone].icon}
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/75">{step.formula}</p>
                    <p className={`mt-0.5 leading-relaxed ${TONE_STYLES[step.tone].text}`}>{step.detail}</p>
                  </div>
                </motion.div>
              ))}
          </AnimatePresence>
          {error && <p className="text-destructive">error: {error}</p>}
        </div>
      </div>

      {/* verdict + controls */}
      <div className="flex flex-col gap-4">
        <Button
          size="lg"
          onClick={runAnalysis}
          disabled={analyzing}
          className="h-12 bg-primary font-semibold text-primary-foreground transition-transform hover:scale-[1.02] disabled:opacity-70"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t("analyzing")}
            </>
          ) : (
            <>
              <Radar className="h-4 w-4" /> {t("run")}
            </>
          )}
        </Button>

        <div className={`rounded-xl border bg-card p-4 transition-shadow ${verdictDone ? verdictTone.glow : ""} ${analyzing ? "pulse-amber" : "border-border"}`}>
          {analysis && verdictDone ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("verdict")}</span>
                <span className={`rounded-md border px-2.5 py-1 text-sm font-extrabold tracking-wide ${verdictTone.badge}`}>
                  {actionLabel}
                </span>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("compositeScore")}</span>
                  <span className="tnum font-bold">{analysis.verdict.score.toFixed(1)}/100</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${analysis.verdict.score}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg,#f43f5e,#f59e0b,#10b981)" }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("confidence", { value: String(analysis.verdict.confidence) })}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {[
                  [t("targets.entry"), analysis.targets.entry, "text-foreground"],
                  [t("targets.support"), analysis.targets.support, "text-destructive"],
                  [t("targets.resistance"), analysis.targets.resistance, "text-primary"],
                  [t("targets.stop"), analysis.targets.stop, "text-destructive"],
                  [t("targets.t1"), analysis.targets.target1, "text-primary"],
                  [t("targets.t2"), analysis.targets.target2, "text-primary"],
                ].map(([label, val, tone]) => (
                  <div key={label as string} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <span className="shrink-0 text-muted-foreground">{label as string}</span>
                    <span className={`tnum font-semibold ${tone as string}`}>{fmtPrice(val as number)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {t("modelExpects", {
                  price: fmtPrice(analysis.projection.expectedPrice),
                  days: String(analysis.projection.horizonDays),
                  daysShort: tProjection("daysShort"),
                  change: fmtPct(analysis.projection.expectedChangePct, 1),
                })}
              </p>
            </>
          ) : (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center text-muted-foreground">
              <Radar className="mb-2 h-8 w-8 text-primary/50" />
              <p className="text-xs">{t("emptyVerdict")}</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("inputs", {
            symbol: selected,
            days: String(horizon),
            daysShort: tProjection("daysShort"),
            vertices: FACTOR_META.map((f) => `${tFactors(`${f.key}.label`)} ${Math.round(factors[f.key])}`).join(" · "),
          })}
        </div>
      </div>
    </div>
  );
}
