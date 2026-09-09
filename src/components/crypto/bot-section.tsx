"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, Loader2, Play, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/store/auth-store";

/* ---------------- types (mirror the API contracts) ---------------- */

interface BotConfig {
  id: string | null;
  mode: "MODERATE" | "AGGRESSIVE";
  symbol: string;
  paper: boolean;
  enabled: boolean;
  orderSizeUsdt: number;
  maxTradesPerDay: number;
  dailyLossLimitUsdt: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}

interface BotPosition {
  id: string;
  symbol: string;
  entryPrice: number;
  qty: number;
  sizeUsdt: number;
  paper: boolean;
  stopPrice: number;
  targetPrice: number;
  openedAt: string;
}

interface BotTrade {
  id: string;
  symbol: string;
  action: string;
  paper: boolean;
  sizeUsdt: number | null;
  qty: number | null;
  price: number | null;
  status: string;
  reason: string;
  pnlUsdt: number | null;
  createdAt: string;
}

interface BotSummary {
  tradesToday: number;
  realizedTodayUsdt: number;
  maxTradesPerDay: number | null;
}

interface BotStats {
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  totalPnlUsdt: number;
  avgWinUsdt: number | null;
  avgLossUsdt: number | null;
  bestUsdt: number | null;
  worstUsdt: number | null;
  expectancyUsdt: number | null;
  exitCounts: Record<string, number>;
  dailyPnl: { day: string; pnl: number }[];
}

interface TickResult {
  action: string;
  reason: string;
  score?: number;
  symbol: string;
}

const AUTO_TICK_MS = 5 * 60_000;

export function BotSection() {
  const t = useTranslations("bot");
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);

  const [cfg, setCfg] = useState<BotConfig | null>(null);
  const [positions, setPositions] = useState<BotPosition[]>([]);
  const [trades, setTrades] = useState<BotTrade[]>([]);
  const [summary, setSummary] = useState<BotSummary | null>(null);
  const [stats, setStats] = useState<BotStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [lastTick, setLastTick] = useState<TickResult | null>(null);
  const [preset, setPreset] = useState<{ MODERATE: { takeProfitPct: number; stopLossPct: number; maxTradesPerDay: number; cooldownMin: number }; AGGRESSIVE: { takeProfitPct: number; stopLossPct: number; maxTradesPerDay: number; cooldownMin: number } } | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bot", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCfg(data.config);
        setPositions(data.positions ?? []);
        setTrades(data.trades ?? []);
        setSummary(data.summary ?? null);
        setStats(data.stats ?? null);
        if (data.summary?.presets) setPreset(data.summary.presets);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const runTick = useCallback(
    async (silent: boolean) => {
      setRunning(true);
      try {
        const res = await fetch("/api/bot/tick", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          const first = (data.results?.[0] ?? null) as TickResult | null;
          setLastTick(first);
          if (!silent && first) {
            toast.success(`${first.action} · ${first.reason}`);
          }
          await load();
        } else if (!silent) {
          toast.error(t("saveError"));
        }
      } finally {
        setRunning(false);
      }
    },
    [load, t]
  );

  /* While the page is open and the bot is enabled, tick every 5 minutes. */
  useEffect(() => {
    if (tickTimer.current) clearInterval(tickTimer.current);
    if (cfg?.enabled) {
      tickTimer.current = setInterval(() => void runTick(true), AUTO_TICK_MS);
    }
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
  }, [cfg?.enabled, runTick]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, symbol: cfg.symbol.toUpperCase(), confirmLive }),
      });
      const data = await res.json();
      if (res.ok) {
        setCfg(data.config);
        setConfirmLive(false);
        toast.success(t("saved"));
        await load();
      } else if (data?.error === "confirm_live") {
        toast.error(data.message ?? t("liveWarn"));
      } else {
        toast.error(data?.message ?? t("saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- not signed in ---------------- */
  if (status !== "loading" && !user) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
        <Bot className="h-8 w-8 text-primary" />
        <h3 className="text-lg font-semibold">{t("signInTitle")}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{t("signInBody")}</p>
        <Button onClick={() => setDialogOpen(true)}>{t("signInCta")}</Button>
      </div>
    );
  }

  if (loading && !cfg) {
    return <div className="h-64 animate-pulse rounded-xl border border-border bg-card/50" />;
  }
  if (!cfg) return null;

  const modePreset = preset?.[cfg.mode] ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* status strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("enabled")}</p>
          <p className={`mt-0.5 text-sm font-bold ${cfg.enabled ? "text-primary" : "text-muted-foreground"}`}>
            {cfg.enabled ? "ON" : "OFF"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("paper")}</p>
          <p className={`mt-0.5 text-sm font-bold ${cfg.paper ? "text-accent" : "text-amber-500"}`}>
            {cfg.paper ? t("paperBadge") : t("liveBadge")}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("todayPnl")}</p>
          <p className={`tnum mt-0.5 text-sm font-bold ${(summary?.realizedTodayUsdt ?? 0) >= 0 ? "text-primary" : "text-destructive"}`}>
            {(summary?.realizedTodayUsdt ?? 0) >= 0 ? "+" : ""}
            {(summary?.realizedTodayUsdt ?? 0).toFixed(2)} $
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("tradesToday")}</p>
          <p className="tnum mt-0.5 text-sm font-bold">
            {summary?.tradesToday ?? 0}
            {summary?.maxTradesPerDay ? ` / ${summary.maxTradesPerDay}` : ""}
          </p>
        </div>
      </div>

      {/* server-side execution note — answers "does it stop when I close the tab?" */}
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>{t("alwaysOn")}</span>
      </p>

      {/* configuration */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("mode")}</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["MODERATE", "AGGRESSIVE"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCfg({ ...cfg, mode: m })}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    cfg.mode === m
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:border-foreground/25"
                  }`}
                >
                  <span className={`text-sm font-semibold ${cfg.mode === m ? "text-primary" : ""}`}>
                    {m === "MODERATE" ? t("moderate") : t("aggressive")}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {m === "MODERATE" ? t("moderateHint") : t("aggressiveHint")}
                  </span>
                </button>
              ))}
            </div>
            {modePreset && (
              <p className="tnum mt-1.5 text-[10px] text-muted-foreground/80">
                TP +{modePreset.takeProfitPct}% · SL −{modePreset.stopLossPct}% · max {modePreset.maxTradesPerDay}/day · cooldown {modePreset.cooldownMin}m
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="bot-symbol" className="text-xs">{t("symbol")}</Label>
            <Input
              id="bot-symbol"
              className="mt-1.5 font-mono uppercase"
              value={cfg.symbol}
              onChange={(e) => setCfg({ ...cfg, symbol: e.target.value.toUpperCase() })}
              placeholder="BTCUSDT"
            />
          </div>
          <div>
            <Label htmlFor="bot-size" className="text-xs">{t("orderSize")}</Label>
            <Input
              id="bot-size"
              type="number"
              min={1.5}
              step={0.5}
              className="tnum mt-1.5"
              value={cfg.orderSizeUsdt}
              onChange={(e) => setCfg({ ...cfg, orderSizeUsdt: Number(e.target.value) })}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">{t("minOrderNote")}</p>
          </div>
          <div>
            <Label htmlFor="bot-max" className="text-xs">{t("maxTrades")}</Label>
            <Input
              id="bot-max"
              type="number"
              min={1}
              max={20}
              step={1}
              className="tnum mt-1.5"
              value={cfg.maxTradesPerDay}
              onChange={(e) => setCfg({ ...cfg, maxTradesPerDay: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="bot-loss" className="text-xs">{t("lossLimit")}</Label>
            <Input
              id="bot-loss"
              type="number"
              min={1}
              step={1}
              className="tnum mt-1.5"
              value={cfg.dailyLossLimitUsdt}
              onChange={(e) => setCfg({ ...cfg, dailyLossLimitUsdt: Number(e.target.value) })}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-xs font-medium">{t("paper")}</span>
            <Switch checked={cfg.paper} onCheckedChange={(v) => setCfg({ ...cfg, paper: v })} aria-label={t("paper")} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-xs font-medium">{t("enabled")}</span>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} aria-label={t("enable")} />
          </div>

          {/* advanced exit-ladder overrides */}
          <details className="sm:col-span-2 rounded-lg border border-border/70 px-3 py-2.5">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
              {t("advTitle")}
            </summary>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("advHint", {
                tp: (modePreset?.takeProfitPct ?? preset?.MODERATE.takeProfitPct ?? 1.8).toFixed(1),
                sl: (modePreset?.stopLossPct ?? preset?.MODERATE.stopLossPct ?? 1.2).toFixed(1),
              })}
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bot-tp" className="text-xs">{t("tpOverride")}</Label>
                <Input
                  id="bot-tp"
                  type="number"
                  min={0.3}
                  max={50}
                  step={0.1}
                  className="tnum mt-1.5"
                  value={cfg.takeProfitPct ?? ""}
                  onChange={(e) => setCfg({ ...cfg, takeProfitPct: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="1.8"
                />
              </div>
              <div>
                <Label htmlFor="bot-sl" className="text-xs">{t("slOverride")}</Label>
                <Input
                  id="bot-sl"
                  type="number"
                  min={0.2}
                  max={50}
                  step={0.1}
                  className="tnum mt-1.5"
                  value={cfg.stopLossPct ?? ""}
                  onChange={(e) => setCfg({ ...cfg, stopLossPct: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="1.2"
                />
              </div>
            </div>
          </details>
        </div>

        {!cfg.paper && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-500">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("liveWarn")}
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-foreground/85">
              <input
                type="checkbox"
                checked={confirmLive}
                onChange={(e) => setConfirmLive(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              {t("liveConfirm")}
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("save")}
          </Button>
          <Button variant="outline" onClick={() => void runTick(false)} disabled={running} className="gap-1.5">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? t("running") : t("runNow")}
          </Button>
          {lastTick && (
            <span className="tnum text-[11px] text-muted-foreground">
              {lastTick.action} · {lastTick.reason}
            </span>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/75">{t("autoNote")}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/75">{t("needKeyNote")}</p>
      </div>

      {/* performance report */}
      {stats && stats.closedCount > 0 && (() => {
        let acc = 0;
        for (const d of stats.dailyPnl) {
          acc += d.pnl;
        };
        const maxAbs = Math.max(1e-9, ...stats.dailyPnl.map((d) => Math.abs(d.pnl)));
        return (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("reportTitle")}</h3>
              <span className="text-[10px] text-muted-foreground">{t("reportMode", { count: stats.closedCount })}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("winRate")}</p>
                <p className="tnum mt-0.5 text-sm font-bold">{stats.winRate != null ? `${(stats.winRate * 100).toFixed(0)}%` : "—"}</p>
                <p className="text-[10px] text-muted-foreground">{stats.winCount}W / {stats.lossCount}L</p>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("totalPnl")}</p>
                <p className={`tnum mt-0.5 text-sm font-bold ${stats.totalPnlUsdt >= 0 ? "text-primary" : "text-destructive"}`}>
                  {stats.totalPnlUsdt >= 0 ? "+" : ""}{stats.totalPnlUsdt.toFixed(2)} $
                </p>
                <p className="tnum text-[10px] text-muted-foreground">{t("expectancy", { value: (stats.expectancyUsdt ?? 0).toFixed(3) })}</p>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("avgWin")} / {t("avgLoss")}</p>
                <p className="tnum mt-0.5 text-sm font-bold">
                  <span className="text-primary">+{(stats.avgWinUsdt ?? 0).toFixed(2)}</span>
                  {" / "}
                  <span className="text-destructive">{(stats.avgLossUsdt ?? 0).toFixed(2)}</span>
                </p>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("bestWorst")}</p>
                <p className="tnum mt-0.5 text-sm font-bold">
                  <span className="text-primary">+{(stats.bestUsdt ?? 0).toFixed(2)}</span>
                  {" / "}
                  <span className="text-destructive">{(stats.worstUsdt ?? 0).toFixed(2)}</span>
                </p>
              </div>
            </div>
            {/* 14-day realized PnL bars */}
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("pnl14d")}</p>
              <div className="mt-1.5 flex h-16 items-end gap-1">
                {stats.dailyPnl.map((d) => {
                  const h = Math.max(2, Math.round((Math.abs(d.pnl) / maxAbs) * 100));
                  return (
                    <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(2)} $`}>
                      <div
                        className={`w-full rounded-sm ${d.pnl > 0 ? "bg-primary/80" : d.pnl < 0 ? "bg-destructive/80" : "bg-muted/40"}`}
                        style={{ height: `${d.pnl === 0 ? 2 : h}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 flex justify-between text-[9px] text-muted-foreground/70">
                <span>{stats.dailyPnl[0]?.day.slice(5)}</span>
                <span>{t("cumLabel", { value: acc.toFixed(2) })}</span>
                <span>{stats.dailyPnl[stats.dailyPnl.length - 1]?.day.slice(5)}</span>
              </p>
            </div>
            {/* exit reason breakdown */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(stats.exitCounts).map(([k, v]) => (
                <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  k === "take-profit" ? "bg-primary/10 text-primary" : k === "stop-loss" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                }`}>
                  {t(`exit_${k.replace("-", "_")}` as Parameters<typeof t>[0], { count: v })}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* open positions */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">{t("openPosition")}</h3>
        {positions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("none")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3">{t("symbol")}</th>
                  <th className="py-1.5 pr-3">{t("entry")}</th>
                  <th className="py-1.5 pr-3">{t("target")}</th>
                  <th className="py-1.5 pr-3">{t("stop")}</th>
                  <th className="py-1.5 pr-3">{t("size")}</th>
                  <th className="py-1.5">{t("status")}</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 font-mono">{p.symbol}</td>
                    <td className="py-1.5 pr-3">${p.entryPrice.toPrecision(6)}</td>
                    <td className="py-1.5 pr-3 text-primary">${p.targetPrice.toPrecision(6)}</td>
                    <td className="py-1.5 pr-3 text-destructive">${p.stopPrice.toPrecision(6)}</td>
                    <td className="py-1.5 pr-3">{p.sizeUsdt.toFixed(2)} $</td>
                    <td className="py-1.5">{p.paper ? t("paperBadge") : t("liveBadge")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* trade log */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">{t("trades")}</h3>
        {trades.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("noTrades")}</p>
        ) : (
          <div className="mt-3 max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3">{t("time")}</th>
                  <th className="py-1.5 pr-3">{t("action")}</th>
                  <th className="py-1.5 pr-3">{t("status")}</th>
                  <th className="py-1.5 pr-3">{t("size")}</th>
                  <th className="py-1.5 pr-3">{t("price")}</th>
                  <th className="py-1.5 pr-3">{t("reason")}</th>
                  <th className="py-1.5">{t("pnl")}</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {trades.map((tr) => (
                  <tr key={tr.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {new Date(tr.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className={`py-1.5 pr-3 font-semibold ${tr.action === "BUY" ? "text-primary" : "text-amber-500"}`}>{tr.action}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        tr.status === "FAILED" || tr.status === "REJECTED"
                          ? "bg-destructive/10 text-destructive"
                          : tr.paper
                            ? "bg-accent/10 text-accent"
                            : "bg-amber-500/10 text-amber-500"
                      }`}>
                        {tr.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{tr.sizeUsdt != null ? `${tr.sizeUsdt.toFixed(2)} $` : "—"}</td>
                    <td className="py-1.5 pr-3">{tr.price != null ? `$${tr.price.toPrecision(6)}` : "—"}</td>
                    <td className="max-w-[220px] truncate py-1.5 pr-3 text-muted-foreground" title={tr.reason}>{tr.reason}</td>
                    <td className={`py-1.5 ${(tr.pnlUsdt ?? 0) > 0 ? "text-primary" : (tr.pnlUsdt ?? 0) < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {tr.pnlUsdt != null ? `${tr.pnlUsdt >= 0 ? "+" : ""}${tr.pnlUsdt.toFixed(2)} $` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground/75">{t("disclaimer")}</p>
    </div>
  );
}
