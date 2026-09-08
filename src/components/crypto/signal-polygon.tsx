"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCryptoStore, FACTOR_META } from "@/store/crypto-store";
import { useAssetSignals } from "@/hooks/use-asset-signals";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Sparkles, RotateCcw, MousePointer2 } from "lucide-react";

const SIZE = 440;
const C = SIZE / 2;
const R = 158;
const MIN_VALUE = 6;

const clampV = (x: number) => Math.min(Math.max(x, MIN_VALUE), 100);

function vertexPos(i: number, value: number) {
  const theta = ((-90 + i * 60) * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const r = (value / 100) * R;
  return { x: C + ux * r, y: C + uy * r, ux, uy };
}

/**
 * Signal Polygon — drag the six vertices to tune factor weights.
 * Every adjustment reads back its value in real time and re-scores the
 * composite instantly. Panel sliders mirror the same state for
 * keyboard/precision control.
 */
export function SignalPolygon() {
  const tFactors = useTranslations("factors");
  const t = useTranslations("polygon");
  const factors = useCryptoStore((s) => s.factors);
  const setFactor = useCryptoStore((s) => s.setFactor);
  const setAllFactors = useCryptoStore((s) => s.setAllFactors);
  const selected = useCryptoStore((s) => s.selected);
  const signals = useAssetSignals(selected);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const valueOf = useCallback((i: number) => factors[FACTOR_META[i].key], [factors]);

  /* ---- pointer drag math ---- */
  const updateFromPointer = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      const svg = svgRef.current;
      if (svg == null || dragIndex.current == null) return;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * SIZE;
      const y = ((e.clientY - rect.top) / rect.height) * SIZE;
      const i = dragIndex.current;
      const theta = ((-90 + i * 60) * Math.PI) / 180;
      const proj = (x - C) * Math.cos(theta) + (y - C) * Math.sin(theta);
      setFactor(FACTOR_META[i].key, clampV((proj / R) * 100));
    },
    [setFactor]
  );

  useEffect(() => {
    const move = (e: PointerEvent) => updateFromPointer(e);
    const up = () => {
      dragIndex.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [updateFromPointer]);

  const vertices = useMemo(
    () =>
      FACTOR_META.map((f, i) => ({
        key: f.key,
        label: tFactors(`${f.key}.label`),
        ...vertexPos(i, factors[f.key]),
      })),
    [factors, tFactors]
  );

  const polygonPath = useMemo(
    () => vertices.map((v, i) => `${i === 0 ? "M" : "L"}${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(" ") + " Z",
    [vertices]
  );

  /* ---- live composite (mirrors the server blend for the 3 indicator axes) ---- */
  const composite = useMemo(() => {
    const ind: Record<string, number> = {
      momentum: signals.momentum,
      trend: signals.trend,
      volatility: signals.volatility,
    };
    let wSum = 0;
    let acc = 0;
    for (const f of FACTOR_META) {
      const w = factors[f.key] / 100;
      wSum += w;
      const s = ind[f.key] ?? factors[f.key];
      acc += w * s;
    }
    return wSum > 0 ? acc / wSum : 50;
  }, [factors, signals]);

  const autoTune = () => {
    setAllFactors({
      ...factors,
      momentum: Math.round(signals.momentum),
      trend: Math.round(signals.trend),
      volatility: Math.round(signals.volatility),
    });
  };

  const scoreColor = composite >= 62 ? "text-primary" : composite <= 38 ? "text-destructive" : "text-accent";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="relative mx-auto w-full max-w-[440px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full touch-none select-none"
          role="application"
          aria-label={t("aria")}
        >
          <defs>
            <radialGradient id="polyFill" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="rgba(16,185,129,0.34)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.10)" />
            </radialGradient>
          </defs>

          {/* rings */}
          {[0.25, 0.5, 0.75, 1].map((k) => (
            <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="rgba(255,255,255,0.07)" strokeDasharray={k === 1 ? "0" : "3 5"} />
          ))}

          {/* axes */}
          {FACTOR_META.map((f, i) => {
            const tip = vertexPos(i, 100);
            return <line key={f.key} x1={C} y1={C} x2={tip.x} y2={tip.y} stroke="rgba(255,255,255,0.09)" />;
          })}

          {/* polygon */}
          <path d={polygonPath} fill="url(#polyFill)" stroke="rgba(16,185,129,0.85)" strokeWidth={2} className="transition-all duration-75" />

          {/* axis labels */}
          {vertices.map((v) => {
            const anchor = v.x > C + 8 ? "start" : v.x < C - 8 ? "end" : "middle";
            const lx = C + (v.x - C) * 1.24;
            const ly = C + (v.y - C) * 1.24 + (v.y > C ? 12 : -6);
            return (
              <text key={v.key} x={lx} y={ly} textAnchor={anchor} className="fill-muted-foreground text-[12px] font-medium">
                {v.label}
              </text>
            );
          })}

          {/* vertices + live value readouts */}
          {vertices.map((v, i) => {
            const isDrag = dragging === i;
            const valColor = factors[v.key] >= 60 ? "#34d399" : factors[v.key] >= 40 ? "#f59e0b" : "#f43f5e";
            return (
              <g key={v.key}>
                {isDrag && <circle cx={v.x} cy={v.y} r={16} fill="rgba(245,158,11,0.18)" />}
                <circle cx={v.x} cy={v.y} r={isDrag ? 8 : 6} fill={isDrag ? "#f59e0b" : "rgba(16,185,129,0.9)"} stroke="rgba(10,14,18,0.9)" strokeWidth={2} style={{ cursor: "grab" }} />
                <circle
                  cx={v.x}
                  cy={v.y}
                  r={20}
                  fill="transparent"
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    dragIndex.current = i;
                    setDragging(i);
                    updateFromPointer(e);
                  }}
                />
                <text x={v.x} y={v.y - 14} textAnchor="middle" className="tnum text-[13px] font-bold" fill={valColor}>
                  {Math.round(factors[v.key])}
                </text>
              </g>
            );
          })}
        </svg>

        <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <MousePointer2 className="h-3.5 w-3.5" />
          {t("dragHint")}
        </p>
      </div>

      {/* readout panel */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("composite")}</span>
            <span className={`tnum text-2xl font-bold ${scoreColor}`}>{composite.toFixed(1)}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={`h-full rounded-full ${dragging !== null ? "pulse-emerald rounded-full" : ""}`}
              style={{ background: "linear-gradient(90deg,#f59e0b,#10b981)" }}
              animate={{ width: `${composite}%` }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("compositeHint", { symbol: selected })}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          {FACTOR_META.map((f) => (
            <div key={f.key}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{tFactors(`${f.key}.label`)}</span>
                <span className="tnum font-bold text-foreground/85">{Math.round(factors[f.key])}</span>
              </div>
              <Slider
                value={[factors[f.key]]}
                min={0}
                max={100}
                step={1}
                aria-label={tFactors(`${f.key}.label`)}
                onValueChange={(v) => setFactor(f.key, v[0])}
                className="mt-1.5"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">{tFactors(`${f.key}.hint`)}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={autoTune} disabled={!signals.hasData}>
            <Sparkles className="h-3.5 w-3.5" /> {t("autoTune")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("resetAria")}
            onClick={() =>
              setAllFactors({ momentum: 50, trend: 50, volume: 50, volatility: 50, sentiment: 50, liquidity: 50 })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
