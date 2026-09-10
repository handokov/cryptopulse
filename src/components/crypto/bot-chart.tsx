"use client";

/**
 * BotChart — v2 phase 2 candlestick card (design notes 26 / 26-b).
 *
 * TradingView lightweight-charts (v5) candles for the bot's symbol on the
 * bot's signal timeframe, with the trigger ladder drawn as price lines:
 *
 *   ENTRY  amber dashed  — draggable. While dragging, TP/SL preview lines
 *                          auto-follow (bands keep their % distance and
 *                          re-anchor to the line, per design item 6).
 *   TP     emerald       — the OPEN position's real target, or the preview
 *                          anchored to the entry line when flat.
 *   SL     red           — the OPEN position's real stop, or the preview.
 *   BUY    muted dashed  — the open position's fill price (context only).
 *
 * Drag semantics: pointer-down within ~14 px of the ENTRY line starts a
 * drag; the chart's own scroll/scale is suspended while dragging; release
 * commits the new level via onEntryLineChange (parent saves). Arming the
 * line happens at the live price (button) — a null line keeps the engine
 * exactly at its pre-v2 behavior (zero-regression default).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CandlestickSeries,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { CandlestickChart, Crosshair, Loader2, MousePointer2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandlesResponse {
  symbol: string;
  tf: string;
  price: number | null;
  candles: Candle[];
  signal: { score: number; entryScore: number; volAnnPct: number; sigmaPct: number };
  bands: { tpPct: number; slPct: number; exitStyle: string; trailArmPct: number | null };
}

export interface BotChartPosition {
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
}

interface BotChartProps {
  symbol: string;
  timeframe: string;
  entryLine: number | null;
  onEntryLineChange: (line: number | null) => void;
  position: BotChartPosition | null;
  /** Bump to force a refetch (e.g. after a manual tick). */
  refreshKey?: number;
}

const COLORS = {
  up: "#10b981",
  down: "#ef4444",
  entry: "#f59e0b",
  tp: "#10b981",
  sl: "#ef4444",
  buy: "#a1a1aa",
  text: "#a1a1aa",
  grid: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
};

/** Compact price formatter that adapts decimals to magnitude. */
function px(n: number): string {
  const abs = Math.abs(n);
  const d = abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return n.toFixed(d);
}

export function BotChart({ symbol, timeframe, entryLine, onEntryLineChange, position, refreshKey = 0 }: BotChartProps) {
  const t = useTranslations("bot");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRefs = useRef<{ entry?: IPriceLine; tp?: IPriceLine; sl?: IPriceLine; buy?: IPriceLine }>({});
  const draggingRef = useRef(false);

  const [data, setData] = useState<CandlesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dragLine, setDragLine] = useState<number | null>(null);

  /* ---------------- data loading (45 s server cache; client 60 s) ---------------- */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/bot/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}`, { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void fetchData();
  }, [fetchData, refreshKey]);

  useEffect(() => {
    const iv = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  /* ---------------- chart lifecycle ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: COLORS.text, fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lineRefs.current = {};
    };
  }, []);

  /* ---------------- candles into the series ---------------- */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data?.candles?.length) return;
    series.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: data.candles.length - 90, to: data.candles.length + 4 });
  }, [data]);

  /* ---------------- price lines (entry / TP / SL / BUY) ----------------
     TP/SL auto-follow: preview lines re-anchor to the active line value on
     every drag frame; with an open position the REAL levels win instead. */
  const activeLine = dragLine ?? entryLine;
  const tpPrice = useMemo(() => {
    if (position) return position.targetPrice;
    if (activeLine != null && data) return activeLine * (1 + data.bands.tpPct / 100);
    return null;
  }, [position, activeLine, data]);
  const slPrice = useMemo(() => {
    if (position) return position.stopPrice;
    if (activeLine != null && data) return activeLine * (1 - data.bands.slPct / 100);
    return null;
  }, [position, activeLine, data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const L = lineRefs.current;
    const put = (kind: "entry" | "tp" | "sl" | "buy", price: number | null, color: string, style: LineStyle, title: string, width: 1 | 2 = 1) => {
      const existing = L[kind];
      if (price == null || !Number.isFinite(price)) {
        if (existing) {
          series.removePriceLine(existing);
          delete L[kind];
        }
        return;
      }
      if (existing) {
        existing.applyOptions({ price, title });
      } else {
        L[kind] = series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title });
      }
    };
    put("entry", activeLine, COLORS.entry, LineStyle.Dashed, "ENTRY", 2);
    put("tp", tpPrice, COLORS.tp, LineStyle.Dotted, "TP");
    put("sl", slPrice, COLORS.sl, LineStyle.Dotted, "SL");
    put("buy", position?.entryPrice ?? null, COLORS.buy, LineStyle.Dashed, "BUY");
  }, [activeLine, tpPrice, slPrice, position]);

  /* ---------------- drag interaction (any-touch line, design 26-b) ---------------- */
  const suspendPan = (suspended: boolean) => {
    chartRef.current?.applyOptions({ handleScroll: !suspended, handleScale: !suspended });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const series = seriesRef.current;
    if (!series || entryLine == null || draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const lineY = series.priceToCoordinate(entryLine);
    if (lineY == null || Math.abs(y - lineY) > 14) return;
    draggingRef.current = true;
    suspendPan(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragLine(entryLine);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const series = seriesRef.current;
    if (!series) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const price = series.coordinateToPrice(y);
    if (price != null && Number.isFinite(price) && price > 0) setDragLine(price);
  };

  const commitDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    suspendPan(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const final = dragLine;
    setDragLine(null);
    if (final != null && Number.isFinite(final) && final > 0) onEntryLineChange(final);
  };

  /* ---------------- pending-entry state (state machine, visible) ---------------- */
  const livePrice = data?.price ?? data?.candles?.[data.candles.length - 1]?.close ?? null;
  const lineTouchedNow =
    activeLine != null && livePrice != null ? Math.abs(livePrice - activeLine) <= activeLine * 0.001 : false;
  const scoreOk = data ? data.signal.score >= data.signal.entryScore : false;
  const distancePct =
    activeLine != null && livePrice != null && activeLine > 0
      ? ((livePrice - activeLine) / activeLine) * 100
      : null;

  const armLine = () => {
    if (livePrice != null && livePrice > 0) onEntryLineChange(livePrice);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      {/* header + legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <CandlestickChart className="h-4 w-4 text-primary" aria-hidden />
          {symbol} · {timeframe}
        </h3>
        {data && (
          <span
            className={`tnum rounded px-1.5 py-0.5 text-[10px] font-bold ${
              scoreOk ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
            title={t("chartScoreTitle")}
          >
            {t("chartScore", { score: data.signal.score.toFixed(2), threshold: data.signal.entryScore.toFixed(2) })}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="inline-block h-0.5 w-3 rounded bg-accent" aria-hidden />
            ENTRY
          </span>
          {tpPrice != null && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="inline-block h-0.5 w-3 rounded bg-primary" aria-hidden />
              TP
            </span>
          )}
          {slPrice != null && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="inline-block h-0.5 w-3 rounded bg-destructive" aria-hidden />
              SL
            </span>
          )}
        </span>
      </div>

      {/* line state chips */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {position ? (
          <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {t("chartPositionOpen", { tp: px(position.targetPrice), sl: px(position.stopPrice) })}
          </span>
        ) : activeLine != null ? (
          lineTouchedNow ? (
            <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
              ● {t("chartAtLine", { line: px(activeLine) })}
            </span>
          ) : (
            <span className="tnum rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-500">
              {t("chartWaitingLine", { line: px(activeLine), dist: Math.abs(distancePct ?? 0).toFixed(2) })}
            </span>
          )
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-accent/40 px-2.5 text-[11px] text-accent hover:bg-accent/10"
            onClick={armLine}
            disabled={livePrice == null}
          >
            <Crosshair className="h-3 w-3" aria-hidden />
            {t("chartArmLine")}
          </Button>
        )}
        {entryLine != null && !position && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onEntryLineChange(null)}
          >
            <X className="h-3 w-3" aria-hidden />
            {t("chartClearLine")}
          </Button>
        )}
        {data && !position && activeLine != null && (
          <span className="tnum text-[10px] text-muted-foreground/80">
            TP {px(tpPrice ?? 0)} · SL {px(slPrice ?? 0)}
          </span>
        )}
        {livePrice != null && <span className="tnum ml-auto text-[11px] font-semibold">${px(livePrice)}</span>}
      </div>

      {/* chart */}
      <div className="relative mt-3">
        <div
          ref={containerRef}
          className={`h-[300px] w-full sm:h-[340px] ${activeLine != null ? "cursor-ns-resize" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commitDrag}
          onPointerCancel={commitDrag}
          role="img"
          aria-label={t("chartAria", { symbol, tf: timeframe })}
        />
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/80">
            <p className="text-xs text-muted-foreground">{t("chartError")}</p>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => void fetchData()}>
              <RefreshCw className="h-3 w-3" aria-hidden />
              {t("chartRetry")}
            </Button>
          </div>
        )}
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
        <MousePointer2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>{entryLine != null ? t("chartDragHint") : t("chartNoLineHint")}</span>
      </p>
    </div>
  );
}
