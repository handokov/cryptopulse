"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCryptoStore } from "@/store/crypto-store";
import { Slider } from "@/components/ui/slider";
import { logReturns, stdev } from "@/lib/indicators";
import { buildPath, projectPrice, substitutedExpr } from "@/lib/projection";
import { fmtPrice, fmtPct } from "@/lib/format";
import { SlidersHorizontal } from "lucide-react";

const W = 720;
const H = 320;
const PAD = { l: 64, r: 18, t: 18, b: 26 };
const TAIL = 60; // days of history shown

/**
 * Projection Lab — a live function graph. Five sliders reshape the
 * projected price path P(t) in real time:
 *   P(t) = P0 · e^{μ̂·t} · (1 + A·sin(2πt/T)·e^{−t/τ})
 * with a lognormal confidence band scaled by the volatility multiplier.
 */
export function ProjectionLab() {
  const t = useTranslations("projection");
  const selected = useCryptoStore((s) => s.selected);
  const assets = useCryptoStore((s) => s.assets);
  const extraAssets = useCryptoStore((s) => s.extraAssets);
  const horizon = useCryptoStore((s) => s.horizon);
  const driftMod = useCryptoStore((s) => s.driftMod);
  const volMult = useCryptoStore((s) => s.volMult);
  const waveAmp = useCryptoStore((s) => s.waveAmp);
  const wavePeriod = useCryptoStore((s) => s.wavePeriod);
  const setSlider = useCryptoStore((s) => s.setSlider);

  const asset = assets.find((a) => a.symbol === selected) ?? extraAssets[selected];

  const model = useMemo(() => {
    if (!asset || asset.history.length < 31) return null;
    const hist = asset.history.slice(-TAIL);
    const p0 = hist[hist.length - 1];
    const rets = logReturns(asset.history);
    const muWindow = rets.slice(-30);
    const muHist = muWindow.reduce((a, b) => a + b, 0) / (muWindow.length || 1);
    const sdDaily = stdev(rets.slice(-30));
    const mu = muHist + driftMod / 100;
    const tau = wavePeriod * 2;

    /* Shared math: the curve samples and the summary endpoint come from the
       same projectPrice/buildPath helpers — they can never disagree. */
    const params = {
      p0,
      muDaily: mu,
      horizonDays: horizon,
      waveAmpPct: waveAmp,
      wavePeriodDays: wavePeriod,
      sdDaily,
      volMult,
    };
    const { path, upper, lower } = buildPath(params);
    const outcome = projectPrice(params);
    return { hist, p0, mu, sdDaily, path, upper, lower, tau, outcome };
  }, [asset, horizon, driftMod, volMult, waveAmp, wavePeriod]);

  const chart = useMemo(() => {
    if (!model) return null;
    const all = [...model.hist, ...model.upper, ...model.lower];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const xMin = -TAIL;
    const xMax = horizon;
    const sx = (t: number) => PAD.l + ((t - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r);
    const sy = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);

    const line = (vals: number[], startT: number) =>
      vals.map((v, i) => `${i === 0 ? "M" : "L"}${sx(startT + i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");

    const bandArea =
      model.upper.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i + 1).toFixed(1)},${sy(v).toFixed(1)}`).join(" ") +
      " " +
      model.lower
        .map((v, i) => `L${sx(horizon - i).toFixed(1)},${sy(v).toFixed(1)}`)
        .join(" ") +
      " Z";

    const gridVals = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);

    return {
      sx,
      sy,
      histLine: line(model.hist, -TAIL + 1),
      projLine: line(model.path, 1),
      bandArea,
      gridVals,
      endX: sx(horizon),
      endY: sy(model.path[model.path.length - 1]),
      startY: sy(model.p0),
      zeroY: sy(model.p0),
    };
  }, [model, horizon]);

  if (!model || !chart) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  const outcome = model.outcome;
  const proj = outcome.expectedPrice; // === model.path[model.path.length - 1] by construction
  const changePct = outcome.expectedChangePct; // === ((proj / model.p0) - 1) * 100, single computation
  const sigmaAnn = model.sdDaily * Math.sqrt(365) * 100;

  const readouts = [
    { label: t("projectedAt", { days: String(horizon), daysShort: t("daysShort") }), value: fmtPrice(proj), tone: changePct >= 0 ? "text-primary" : "text-destructive" },
    { label: t("expectedMove"), value: fmtPct(changePct, 1), tone: changePct >= 0 ? "text-primary" : "text-destructive" },
    { label: t("driftPerDay"), value: `${(outcome.muDaily * 100).toFixed(3)}%`, tone: "text-foreground/85" },
    { label: t("annVol"), value: `${sigmaAnn.toFixed(0)}%`, tone: "text-accent" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected price path with confidence band">
          <defs>
            <linearGradient id="projStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16,185,129,0.16)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.03)" />
            </linearGradient>
          </defs>

          {/* grid + y labels */}
          {chart.gridVals.map((v, i) => {
            const y = chart.sy(v);
            return (
              <g key={i}>
                <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
                <text x={PAD.l - 8} y={y + 3} textAnchor="end" className="tnum fill-muted-foreground text-[10px]">
                  {fmtPrice(v)}
                </text>
              </g>
            );
          })}

          {/* current price reference */}
          <line x1={PAD.l} y1={chart.zeroY} x2={W - PAD.r} y2={chart.zeroY} stroke="rgba(245,158,11,0.4)" strokeDasharray="5 5" />
          <text x={W - PAD.r} y={chart.zeroY - 6} textAnchor="end" className="fill-accent text-[10px] font-semibold">
            {t("now", { price: fmtPrice(model.p0) })}
          </text>

          {/* confidence band */}
          <path d={chart.bandArea} fill="url(#bandFill)" />

          {/* history */}
          <path d={chart.histLine} fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth={1.6} />

          {/* projection */}
          <motion.path
            key={selected}
            d={chart.projLine}
            fill="none"
            stroke="url(#projStroke)"
            strokeWidth={2.4}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />

          {/* end marker */}
          <circle cx={chart.endX} cy={chart.endY} r={10} fill="rgba(245,158,11,0.18)">
            <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.2;0.9" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx={chart.endX} cy={chart.endY} r={4} fill="#f59e0b" />

          {/* x axis labels */}
          <text x={PAD.l} y={H - 8} className="fill-muted-foreground text-[10px]">−60{t("daysShort")}</text>
          <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{t("today")}</text>
          <text x={chart.endX} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">+{horizon}{t("daysShort")}</text>
        </svg>
      </div>

      {/* live function readout — symbolic formula + exact substituted values,
          so every card on screen can be verified against this line */}
      <div className="rounded-xl border border-border bg-card/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        <span className="text-primary">P(t)</span> = P₀ · e^(μ̂·t) · (1 + A·sin(2πt/T) · e^(−t/τ))
        <span className="mx-2 text-border">|</span>
        P₀={fmtPrice(model.p0)} · μ̂={(model.mu * 100).toFixed(3)}%/d · A={waveAmp.toFixed(1)}% · T={wavePeriod}d · τ={model.tau}d · band=±{volMult.toFixed(1)}σ̂√t
        <br />
        <span className="text-primary">P({horizon})</span> = {substitutedExpr(model.p0, model.mu, horizon)} · W = {outcome.waveFactor.toFixed(4)} = {fmtPrice(outcome.expectedPrice)}
        <span className="mx-2 text-border">|</span>
        drift-only: {fmtPrice(outcome.driftPrice)} ({fmtPct(outcome.driftChangePct, 1)}) · cyclical: {fmtPct(outcome.waveContributionPct, 2)}
      </div>

      {/* sliders */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <SliderRow icon label={t("horizon.label")} hint={t("horizon.hint")} display={`${horizon}${t("daysShort")}`} min={30} max={180} step={5} value={horizon} onChange={(v) => setSlider("horizon", v)} />
        <SliderRow label={t("drift.label")} hint={t("drift.hint")} display={`${driftMod >= 0 ? "+" : ""}${driftMod.toFixed(2)} %${t("perDayShort")}`} min={-0.8} max={0.8} step={0.05} value={driftMod} onChange={(v) => setSlider("driftMod", v)} />
        <SliderRow label={t("vol.label")} hint={t("vol.hint")} display={`${volMult.toFixed(2)}×`} min={0.5} max={2} step={0.05} value={volMult} onChange={(v) => setSlider("volMult", v)} />
        <SliderRow label={t("waveAmp.label")} hint={t("waveAmp.hint")} display={`${waveAmp.toFixed(1)}%`} min={0} max={5} step={0.1} value={waveAmp} onChange={(v) => setSlider("waveAmp", v)} />
        <SliderRow label={t("wavePeriod.label")} hint={t("wavePeriod.hint")} display={`${wavePeriod}${t("daysShort")}`} min={7} max={60} step={1} value={wavePeriod} onChange={(v) => setSlider("wavePeriod", v)} />
      </div>

      {/* readouts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {readouts.map((r) => (
          <div key={r.label} className="rounded-lg border border-border bg-card px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</p>
            <p className={`tnum mt-0.5 text-sm font-bold ${r.tone}`}>{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  display,
  min,
  max,
  step,
  value,
  onChange,
  icon,
}: {
  label: string;
  hint: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  icon?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {icon && <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />}
          {label}
          <span className="hidden text-[10px] text-muted-foreground sm:inline">— {hint}</span>
        </span>
        <span className="tnum font-bold text-primary">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={(v) => onChange(v[0])}
        className="mt-2"
      />
    </div>
  );
}
