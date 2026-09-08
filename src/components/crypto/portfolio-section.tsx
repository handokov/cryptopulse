"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Check,
  ChevronsUpDown,
  CircleAlert,
  History,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuthStore } from "@/store/auth-store";
import { useLocaleStore } from "@/store/locale-store";
import { ExchangeConnections } from "@/components/crypto/exchange-connections";
import type { Locale } from "@/i18n/config";
import { fmtPrice, fmtCompactUsd, fmtPct, fmtPctPlain } from "@/lib/format";

/* ---------------- types (mirror the API contracts) ---------------- */

interface Holding {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  image: string | null;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  createdAt: string;
  currentPrice: number | null;
  change24h: number | null;
  costBasis: number;
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  weight: number | null;
}

interface Computed {
  totalValue: number;
  totalCost: number;
  totalPnl: number | null;
  totalPnlPct: number | null;
  change24hPct: number | null;
  profitableCount: number;
  losingCount: number;
  positionCount: number;
  topHolding: { symbol: string; name: string; weight: number } | null;
  priceStale: boolean;
}

interface PortfolioPayload {
  holdings: Holding[];
  computed: Computed;
}

interface Top100Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
}

interface Top100Payload {
  coins: Top100Coin[];
}

interface CoinOption {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number;
}

interface HistorySnapshot {
  date: string;
  totalValue: number;
  totalCost: number;
}

interface HistoryPayload {
  snapshots: HistorySnapshot[];
}

interface AlertItem {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  image: string | null;
  direction: "above" | "below";
  targetPrice: number;
  triggered: boolean;
  triggeredAt: string | null;
  createdAt: string;
  currentPrice: number | null;
}

interface AlertsPayload {
  alerts: AlertItem[];
  newlyTriggered: Array<{ id: string; symbol: string; name: string; targetPrice: number }>;
}

/* ---------------- constants ---------------- */

const PALETTE = [
  "#10b981",
  "#34d399",
  "#f59e0b",
  "#fbbf24",
  "#2dd4bf",
  "#a3e635",
  "#4ade80",
  "#fb923c",
  "#84cc16",
  "#f97316",
];

/* ---------------- small helpers ---------------- */

function dateLocale(l: Locale): string {
  switch (l) {
    case "id":
      return "id-ID";
    case "zh":
      return "zh-CN";
    case "es":
      return "es-ES";
    case "pt":
      return "pt-BR";
    case "ja":
      return "ja-JP";
    default:
      return "en-US";
  }
}

/** Parse a "YYYY-MM-DD" string as UTC to avoid timezone off-by-one on the axes. */
function parseUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function fmtWeight(w: number): string {
  return `${w.toFixed(1)}%`;
}

function CoinAvatar({ image, symbol, size = "h-6 w-6" }: { image: string | null; symbol: string; size?: string }) {
  if (image) {
    return <img src={image} alt="" loading="lazy" className={`${size} shrink-0 rounded-full`} />;
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary`}
      aria-hidden="true"
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

/** Searchable top-100 coin picker, shared by the add/edit dialog and the alerts form. */
function CoinPicker({
  coin,
  options,
  open,
  onOpenChange,
  onPick,
  disabled = false,
  labels,
}: {
  coin: CoinOption | null;
  options: Top100Coin[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (c: Top100Coin) => void;
  disabled?: boolean;
  labels: { select: string; search: string; empty: string };
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={labels.select}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 disabled:cursor-default disabled:opacity-70"
        >
          {coin ? (
            <span className="flex min-w-0 items-center gap-2">
              <CoinAvatar image={coin.image} symbol={coin.symbol} />
              <span className="min-w-0 text-left">
                <span className="block truncate font-medium leading-tight text-foreground">{coin.name}</span>
                <span className="block text-xs uppercase leading-tight text-muted-foreground">{coin.symbol}</span>
              </span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.select}</span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder={labels.search} />
          <CommandList className="max-h-64 overflow-y-auto">
            <CommandEmpty>{labels.empty}</CommandEmpty>
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.symbol}`}
                  onSelect={() => onPick(c)}
                  className="gap-2 text-sm"
                >
                  <CoinAvatar image={c.image} symbol={c.symbol} size="h-5 w-5" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs uppercase text-muted-foreground">{c.symbol}</span>
                  {coin?.id === c.id && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PctChip({ value }: { value: number }) {
  return (
    <span
      className={`tnum inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        value >= 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
      }`}
    >
      {fmtPct(value)}
    </span>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tnum mt-1.5 truncate text-lg font-bold ${valueClass ?? "text-foreground"}`}>{value}</p>
      {sub != null ? <div className="mt-1.5">{sub}</div> : null}
    </div>
  );
}

/* ---------------- recharts tooltips ---------------- */

interface DonutDatum {
  name: string;
  value: number;
  weight: number;
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: DonutDatum }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1 text-xs">
      <span className="font-semibold text-foreground">{datum.name}</span>{" "}
      <span className="tnum text-muted-foreground">{fmtCompactUsd(datum.value)}</span>
    </div>
  );
}

interface PnlDatum {
  symbol: string;
  pnlPct: number;
  /** Stable key: holdings can share a symbol across lots/sources. */
  coinId: string;
  cost: number;
  pnl: number;
}

function PnlTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: PnlDatum }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1 text-xs">
      <span className="font-semibold text-foreground">{datum.symbol}</span>{" "}
      <span className="tnum text-muted-foreground">{fmtPct(datum.pnlPct)}</span>
    </div>
  );
}

interface HistoryDatum {
  date: string;
  totalValue: number;
  totalCost: number;
}

function HistoryTooltip({
  active,
  payload,
  fmtDate,
}: {
  active?: boolean;
  payload?: Array<{ payload?: HistoryDatum }>;
  fmtDate: (iso: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-border bg-popover/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{fmtDate(datum.date)}</p>
      <p className="tnum font-semibold text-foreground">{fmtCompactUsd(datum.totalValue)}</p>
    </div>
  );
}

/* ---------------- main component ---------------- */

export function PortfolioSection() {
  const t = useTranslations("portfolio");
  const tA = useTranslations("alerts");
  const tAuth = useTranslations("auth");
  const status = useAuthStore((s) => s.status);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);
  const locale = useLocaleStore((s) => s.locale);

  /* portfolio data */
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  /* add / edit dialog */
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [coin, setCoin] = useState<CoinOption | null>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [date, setDate] = useState("");
  const [coinPickerOpen, setCoinPickerOpen] = useState(false);
  const [coinOptions, setCoinOptions] = useState<Top100Coin[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<"validation" | "error" | null>(null);

  /* delete dialog */
  const [deleting, setDeleting] = useState<Holding | null>(null);
  const [deletingPending, setDeletingPending] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  /* demo load */
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoPending, setDemoPending] = useState(false);

  /* portfolio value history */
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyRange, setHistoryRange] = useState<7 | 30>(30);

  /* price alerts */
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [alertCoin, setAlertCoin] = useState<CoinOption | null>(null);
  const [alertTarget, setAlertTarget] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [alertPickerOpen, setAlertPickerOpen] = useState(false);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<"validation" | "limit" | "duplicate" | "error" | null>(null);
  const [alertActionId, setAlertActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (!res.ok) throw new Error(`portfolio fetch failed: ${res.status}`);
      setData((await res.json()) as PortfolioPayload);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /* (re)load whenever the session flips to authenticated */
  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const loadHistory = useCallback(
    async (silent = false) => {
      if (!silent) setHistoryLoading(true);
      try {
        const res = await fetch(`/api/portfolio/history?days=${historyRange}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
        const json = (await res.json()) as HistoryPayload;
        setHistory(json.snapshots ?? []);
        setHistoryLoaded(true);
        setHistoryError(false);
      } catch {
        if (!silent) setHistoryError(true);
      } finally {
        if (!silent) setHistoryLoading(false);
      }
    },
    [historyRange]
  );

  /* initial + range-change history load (silent refetches keep the current chart mounted) */
  useEffect(() => {
    if (status === "authenticated") void loadHistory();
  }, [status, loadHistory]);

  const loadAlerts = useCallback(async (silent = false) => {
    if (!silent) setAlertsLoading(true);
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`alerts fetch failed: ${res.status}`);
      const json = (await res.json()) as AlertsPayload;
      setAlerts(json.alerts ?? []);
      setAlertsError(false);
      /* Only the request that flips an alert's triggered flag receives it in
         newlyTriggered — the bell and this card poll independently, so toast
         here too: exactly one of the two fetchers ever sees each crossing. */
      for (const item of json.newlyTriggered ?? []) {
        toast(tA("notifyTitle"), {
          description: tA("notifyBody", { name: item.name, target: fmtPrice(item.targetPrice) }),
          duration: 8000,
        });
      }
    } catch {
      if (!silent) setAlertsError(true);
    } finally {
      if (!silent) setAlertsLoading(false);
    }
  }, [tA]);

  /* initial load + silent 60s polling while authenticated (skips hidden tabs) */
  useEffect(() => {
    if (status !== "authenticated") return;
    void loadAlerts();
    const iv = setInterval(() => {
      if (document.hidden) return;
      void loadAlerts(true);
    }, 60000);
    return () => clearInterval(iv);
  }, [status, loadAlerts]);

  /* refetch the portfolio AND its value history after any holding mutation */
  const refreshAll = useCallback(() => {
    void load();
    void loadHistory(true);
  }, [load, loadHistory]);

  const runDemoLoad = useCallback(async () => {
    if (demoPending) return;
    setDemoPending(true);
    try {
      const res = await fetch("/api/portfolio/demo", { method: "POST" });
      if (res.status === 201) {
        setDemoOpen(false);
        toast.success(t("demoDone"));
        void load();
        void loadHistory(true);
      } else if (res.status === 409) {
        setDemoOpen(false);
        toast.warning(t("demoNotEmpty"));
      } else {
        toast.error(t("error"));
      }
    } catch {
      toast.error(t("error"));
    } finally {
      setDemoPending(false);
    }
  }, [demoPending, t, load, loadHistory]);

  /* fetch the top-100 coin universe the first time any coin picker opens */
  useEffect(() => {
    if ((!dialogMode && !alertPickerOpen) || coinOptions.length > 0) return;
    void (async () => {
      try {
        const res = await fetch("/api/market/top100", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Top100Payload;
        setCoinOptions(json.coins ?? []);
      } catch {
        /* picker stays empty → CommandEmpty shows */
      }
    })();
  }, [dialogMode, alertPickerOpen, coinOptions.length]);

  const holdings = useMemo(() => data?.holdings ?? [], [data]);
  const computed = data?.computed ?? null;

  const valued = useMemo(
    () => holdings.filter((h): h is Holding & { currentValue: number } => h.currentValue != null),
    [holdings]
  );
  const withPnl = useMemo(
    () => holdings.filter((h): h is Holding & { pnlPct: number } => h.pnlPct != null),
    [holdings]
  );
  const best = useMemo(
    () => (withPnl.length ? withPnl.reduce((a, b) => (b.pnlPct > a.pnlPct ? b : a)) : null),
    [withPnl]
  );
  const worst = useMemo(
    () => (withPnl.length ? withPnl.reduce((a, b) => (b.pnlPct < a.pnlPct ? b : a)) : null),
    [withPnl]
  );
  const uniqueSymbols = useMemo(() => new Set(holdings.map((h) => h.coinId)).size, [holdings]);

  /* Charts aggregate per coin: duplicate symbols across lots (manual vs
     exchange-imported) would collide React keys and double-count rows. */
  const donutData = useMemo<DonutDatum[]>(() => {
    const byCoin = new Map<string, DonutDatum>();
    for (const h of valued) {
      const cur = byCoin.get(h.coinId);
      if (cur) {
        cur.value += h.currentValue;
        cur.weight += h.weight ?? 0;
      } else {
        byCoin.set(h.coinId, { name: h.symbol, value: h.currentValue, weight: h.weight ?? 0 });
      }
    }
    return [...byCoin.values()];
  }, [valued]);
  const barData = useMemo<PnlDatum[]>(() => {
    const byCoin = new Map<
      string,
      { symbol: string; cost: number; pnl: number }
    >();
    for (const h of valued) {
      const cost = h.quantity * h.purchasePrice;
      const pnl = h.pnl ?? 0;
      const cur = byCoin.get(h.coinId);
      if (cur) {
        cur.cost += cost;
        cur.pnl += pnl;
      } else {
        byCoin.set(h.coinId, { symbol: h.symbol, cost, pnl });
      }
    }
    return [...byCoin.entries()].map(([coinId, d]) => ({
      coinId,
      symbol: d.symbol,
      cost: d.cost,
      pnl: d.pnl,
      pnlPct: d.cost > 0 ? (d.pnl / d.cost) * 100 : 0,
    }));
  }, [valued]);

  /* insight lines — only built when data is present */
  const insightLines = useMemo(() => {
    const lines: Array<{ color: string; text: string }> = [];
    if (!computed) return lines;
    if (computed.totalPnlPct != null) {
      lines.push({
        color: computed.totalPnlPct >= 0 ? "bg-primary" : "bg-destructive",
        text:
          computed.totalPnlPct >= 0
            ? t("insightOverallPositive", { pct: fmtPct(computed.totalPnlPct) })
            : t("insightOverallNegative", { pct: fmtPct(computed.totalPnlPct) }),
      });
    }
    if (computed.positionCount > 0) {
      lines.push({
        color: "bg-amber-400",
        text: t("insightProfit", { count: computed.profitableCount, total: computed.positionCount }),
      });
    }
    if (computed.topHolding) {
      lines.push(
        computed.topHolding.weight > 40
          ? {
              color: "bg-amber-400",
              text: t("insightConcentrated", {
                name: computed.topHolding.symbol,
                pct: fmtPctPlain(computed.topHolding.weight),
              }),
            }
          : {
              color: "bg-primary",
              text: t("insightTop", {
                name: computed.topHolding.symbol,
                pct: fmtPctPlain(computed.topHolding.weight),
              }),
            }
      );
    }
    if (computed.positionCount >= 3) {
      lines.push({
        color: "bg-amber-400",
        text: t("insightDiversified", { count: computed.positionCount, assets: uniqueSymbols }),
      });
    }
    if (best) {
      lines.push({ color: "bg-primary", text: t("insightBest", { name: best.symbol, pct: fmtPct(best.pnlPct) }) });
    }
    if (worst) {
      lines.push({
        color: worst.pnlPct < 0 ? "bg-destructive" : "bg-primary",
        text: t("insightWorst", { name: worst.symbol, pct: fmtPct(worst.pnlPct) }),
      });
    }
    return lines;
  }, [computed, uniqueSymbols, best, worst, t]);

  /* ---- form helpers ---- */

  const resetForm = useCallback(() => {
    setCoin(null);
    setQuantity("");
    setPrice("");
    setPriceTouched(false);
    setDate("");
    setCoinPickerOpen(false);
    setFormError(null);
    setSaving(false);
  }, []);

  const openAdd = useCallback(() => {
    setEditing(null);
    setDialogMode("add");
    resetForm();
    setDate(new Date().toISOString().slice(0, 10));
  }, [resetForm]);

  const openEdit = useCallback(
    (h: Holding) => {
      setEditing(h);
      setDialogMode("edit");
      resetForm();
      setCoin({ id: h.coinId, symbol: h.symbol, name: h.name, image: h.image, price: h.currentPrice ?? h.purchasePrice });
      setQuantity(String(h.quantity));
      setPrice(String(h.purchasePrice));
      setPriceTouched(true);
      setDate(h.purchaseDate.slice(0, 10));
    },
    [resetForm]
  );

  const closeForm = useCallback(() => {
    setDialogMode(null);
    setEditing(null);
    resetForm();
  }, [resetForm]);

  const pickCoin = useCallback(
    (c: Top100Coin) => {
      setCoin({ id: c.id, symbol: c.symbol, name: c.name, image: c.image, price: c.price });
      if (dialogMode === "add" && !priceTouched && c.price > 0) {
        setPrice(String(Math.round(c.price * 1e6) / 1e6));
      }
      setCoinPickerOpen(false);
    },
    [dialogMode, priceTouched]
  );

  const saveHolding = useCallback(async () => {
    if (!dialogMode || saving) return;
    const q = Number(quantity);
    const p = Number(price);
    if (!coin || !quantity || !price || !date || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p <= 0) {
      setFormError("validation");
      return;
    }
    setSaving(true);
    setFormError(null);
    const isEdit = dialogMode === "edit" && editing != null;
    try {
      const res = await fetch(isEdit ? `/api/portfolio/${(editing as Holding).id}` : "/api/portfolio", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { quantity: q, purchasePrice: p, purchaseDate: new Date(date).toISOString() }
            : {
                coinId: coin.id,
                symbol: coin.symbol,
                name: coin.name,
                image: coin.image ?? undefined,
                quantity: q,
                purchasePrice: p,
                purchaseDate: new Date(date).toISOString(),
              }
        ),
      });
      if (res.ok) {
        closeForm();
        void refreshAll();
      } else {
        setFormError("error");
      }
    } catch {
      setFormError("error");
    } finally {
      setSaving(false);
    }
  }, [dialogMode, saving, quantity, price, date, coin, editing, closeForm, refreshAll]);

  const confirmDelete = useCallback(async () => {
    if (!deleting || deletingPending) return;
    setDeletingPending(true);
    setDeleteError(false);
    try {
      const res = await fetch(`/api/portfolio/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setDeleting(null);
      void refreshAll();
    } catch {
      setDeleteError(true);
    } finally {
      setDeletingPending(false);
    }
  }, [deleting, deletingPending, refreshAll]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "medium" }),
    [locale]
  );

  /* history axis: "Aug 14" style ticks (UTC-anchored) */
  const historyTickFormatter = useMemo(
    () => new Intl.DateTimeFormat(dateLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }),
    [locale]
  );
  /* history tooltip: fully localized long date */
  const historyTooltipFormatter = useMemo(
    () => new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "medium", timeZone: "UTC" }),
    [locale]
  );

  /* ---- price alert helpers ---- */

  const pickAlertCoin = useCallback((c: Top100Coin) => {
    setAlertCoin({ id: c.id, symbol: c.symbol, name: c.name, image: c.image, price: c.price });
    if (c.price > 0) setAlertTarget(String(Math.round(c.price * 1e6) / 1e6));
    setAlertError(null);
    setAlertPickerOpen(false);
  }, []);

  const createAlert = useCallback(async () => {
    if (alertSaving) return;
    const target = Number(alertTarget);
    if (!alertCoin || !alertTarget || !Number.isFinite(target) || target <= 0) {
      setAlertError("validation");
      return;
    }
    setAlertSaving(true);
    setAlertError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coinId: alertCoin.id,
          symbol: alertCoin.symbol,
          name: alertCoin.name,
          image: alertCoin.image ?? undefined,
          targetPrice: target,
          direction: alertDirection,
        }),
      });
      if (res.status === 201) {
        setAlertTarget(""); // keep the coin selected for quick follow-ups
        void loadAlerts(true);
      } else {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (json?.error === "validation") setAlertError("validation");
        else if (json?.error === "limit") setAlertError("limit");
        else if (json?.error === "duplicate") setAlertError("duplicate");
        else setAlertError("error");
      }
    } catch {
      setAlertError("error");
    } finally {
      setAlertSaving(false);
    }
  }, [alertSaving, alertTarget, alertCoin, alertDirection, loadAlerts]);

  const rearmAlert = useCallback(
    async (a: AlertItem) => {
      if (alertActionId) return;
      setAlertActionId(a.id);
      try {
        const res = await fetch(`/api/alerts/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggered: false }),
        });
        if (res.ok) {
          toast.success(tA("rearmed"));
          void loadAlerts(true);
        }
      } catch {
        /* keep the row as-is; the next poll will reconcile */
      } finally {
        setAlertActionId(null);
      }
    },
    [alertActionId, loadAlerts, tA]
  );

  const deleteAlert = useCallback(
    async (a: AlertItem) => {
      if (alertActionId) return;
      setAlertActionId(a.id);
      try {
        const res = await fetch(`/api/alerts/${a.id}`, { method: "DELETE" });
        if (res.ok) void loadAlerts(true);
      } catch {
        /* keep the row as-is; the next poll will reconcile */
      } finally {
        setAlertActionId(null);
      }
    },
    [alertActionId, loadAlerts]
  );

  /* ---------------- gating ---------------- */

  if (status === "loading") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-semibold text-foreground">{t("signInCta")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("signInHint")}</p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-primary/15 text-primary hover:bg-primary/25"
        >
          {t("openAuth")}
        </Button>
      </div>
    );
  }

  /* ---------------- authenticated ---------------- */

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-8 text-center">
        <CircleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t("error")}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  const isEmpty = computed != null && computed.positionCount === 0 && !loading;

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{t("holdingsTitle")}</p>
          {computed && (
            <span className="tnum rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {t("holdingsCount", { count: computed.positionCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {computed && (
            <span className="tnum hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex">
              {computed.priceStale ? (
                t("pricedStale")
              ) : (
                <>
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                  {t("pricedLive")}
                </>
              )}
            </span>
          )}
          {computed && computed.positionCount === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDemoOpen(true)}
              className="gap-1.5 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t("demoLoad")}
            </Button>
          )}
          <Button
            size="sm"
            onClick={openAdd}
            className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/25"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("addHolding")}
          </Button>
        </div>
      </div>

      {/* summary cards */}
      {computed && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label={t("totalValue")}
            value={fmtCompactUsd(computed.totalValue)}
            sub={computed.change24hPct != null ? <PctChip value={computed.change24hPct} /> : null}
          />
          <StatCard label={t("totalCost")} value={fmtCompactUsd(computed.totalCost)} />
          <StatCard
            label={t("unrealizedPnl")}
            value={fmtCompactUsd(computed.totalPnl ?? 0)}
            valueClass={(computed.totalPnl ?? 0) >= 0 ? "text-primary" : "text-destructive"}
            sub={computed.totalPnlPct != null ? <PctChip value={computed.totalPnlPct} /> : null}
          />
          <StatCard
            label={t("return24h")}
            value={computed.change24hPct != null ? fmtPct(computed.change24hPct) : "—"}
            valueClass={
              computed.change24hPct != null
                ? computed.change24hPct >= 0
                  ? "text-primary"
                  : "text-destructive"
                : undefined
            }
          />
          <StatCard label={t("positions")} value={computed.positionCount} />
          <StatCard
            label={t("bestPerformer")}
            value={best ? best.symbol : "—"}
            sub={
              best ? (
                <span className="tnum text-[10px] font-semibold text-primary">{fmtPct(best.pnlPct)}</span>
              ) : null
            }
          />
        </div>
      )}

      {/* portfolio value history */}
      <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">{t("historyTitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-muted-foreground sm:block">{t("historyDesc")}</p>
            <div className="flex items-center gap-1" role="group" aria-label={t("historyTitle")}>
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setHistoryRange(d)}
                  aria-pressed={historyRange === d}
                  className={`tnum rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    historyRange === d
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {d === 7 ? t("history7d") : t("history30d")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {historyError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
            <CircleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("historyError")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadHistory()}
              className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
            >
              {t("retry")}
            </Button>
          </div>
        ) : !historyLoaded && historyLoading ? (
          <Skeleton className="h-[230px] w-full rounded-xl" />
        ) : history.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p className="max-w-md text-sm text-muted-foreground">{t("historyEmpty")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={history} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => historyTickFormatter.format(parseUtc(value))}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={28}
                className="tnum"
              />
              <YAxis
                width={56}
                tickFormatter={(value: number) => fmtCompactUsd(value)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                className="tnum"
              />
              <Tooltip
                content={<HistoryTooltip fmtDate={(iso) => historyTooltipFormatter.format(parseUtc(iso))} />}
                cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="totalValue"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#history-fill)"
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* holdings / empty state */}
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
          <h3 className="font-semibold text-foreground">{t("empty")}</h3>
          <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button
            size="sm"
            onClick={openAdd}
            className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/25"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("addHolding")}
          </Button>
        </div>
      ) : (
        computed && (
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("coin")}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("quantity")}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("purchaseDate")}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("purchasePrice")}
                    </th>
                    <th scope="col" className="hidden py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                      {t("costBasis")}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("currentPrice")}
                    </th>
                    <th scope="col" className="hidden py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                      {t("currentValue")}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("pnl")}
                    </th>
                    <th scope="col" className="hidden py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                      {t("allocation")}
                    </th>
                    <th scope="col" className="py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {holdings.map((h) => {
                    const pnlUp = (h.pnl ?? 0) >= 0;
                    return (
                      <tr key={h.id} className="transition-colors hover:bg-white/5">
                        <td className="py-2.5 pr-3">
                          <span className="flex items-center gap-2">
                            <CoinAvatar image={h.image} symbol={h.symbol} />
                            <span className="min-w-0">
                              <span className="block truncate font-bold leading-tight text-foreground">{h.symbol}</span>
                              <span className="block truncate text-xs leading-tight text-muted-foreground">{h.name}</span>
                            </span>
                          </span>
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right">{h.quantity.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td>
                        <td className="tnum py-2.5 pr-3 text-left text-muted-foreground">
                          {dateFormatter.format(new Date(h.purchaseDate))}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right">{fmtPrice(h.purchasePrice)}</td>
                        <td className="tnum hidden py-2.5 pr-3 text-right text-muted-foreground lg:table-cell">
                          {fmtCompactUsd(h.costBasis)}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right">
                          {h.currentPrice != null ? fmtPrice(h.currentPrice) : "—"}
                        </td>
                        <td className="tnum hidden py-2.5 pr-3 text-right md:table-cell">
                          {h.currentValue != null ? fmtCompactUsd(h.currentValue) : "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          {h.pnl != null ? (
                            <span className="flex flex-col items-end gap-0.5">
                              <span className={`tnum font-semibold ${pnlUp ? "text-primary" : "text-destructive"}`}>
                                {fmtCompactUsd(h.pnl)}
                              </span>
                              {h.pnlPct != null && <PctChip value={h.pnlPct} />}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="hidden py-2.5 pr-3 md:table-cell">
                          {h.weight != null ? (
                            <span className="flex flex-col gap-1">
                              <span className="tnum text-xs text-muted-foreground">{fmtWeight(h.weight)}</span>
                              <span className="h-1 w-16 overflow-hidden rounded bg-white/10">
                                <span
                                  className="block h-1 rounded bg-primary/70"
                                  style={{ width: `${Math.min(h.weight, 100)}%` }}
                                />
                              </span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <span className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("editHolding")}
                              onClick={() => openEdit(h)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("delete")}
                              onClick={() => {
                                setDeleting(h);
                                setDeleteError(false);
                              }}
                              className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* charts row */}
      {valued.length >= 1 && computed && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* allocation donut */}
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <p className="mb-3 text-sm font-semibold text-foreground">{t("allocationTitle")}</p>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {donutData.map((d, i) => (
                    <Cell key={`${d.name}-${i}`} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--foreground)"
                  fontSize={18}
                  fontWeight={700}
                >
                  {fmtCompactUsd(computed.totalValue)}
                </text>
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {donutData.map((d, i) => (
                <span key={`${d.name}-${i}`} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-foreground">{d.name}</span>
                  <span className="tnum">{fmtWeight(d.weight)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* pnl bars */}
          <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
            <p className="mb-3 text-sm font-semibold text-foreground">{t("pnlTitle")}</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                <XAxis type="number" hide domain={["auto", "auto"]} />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  width={52}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<PnlTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="pnlPct" radius={3} barSize={16}>
                  {barData.map((d) => (
                    <Cell key={d.coinId} fill={d.pnlPct >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* price alerts */}
      <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
        <div className="mb-4 flex items-start gap-2">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">{tA("title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tA("desc")}</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* create form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createAlert();
            }}
            className="flex flex-col gap-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {tA("newAlert")}
            </p>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {tA("coin")}
              </Label>
              <CoinPicker
                coin={alertCoin}
                options={coinOptions}
                open={alertPickerOpen}
                onOpenChange={setAlertPickerOpen}
                onPick={pickAlertCoin}
                labels={{ select: tA("selectCoin"), search: tA("searchCoin"), empty: tA("noCoins") }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {tA("direction")}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAlertDirection("above")}
                  aria-pressed={alertDirection === "above"}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    alertDirection === "above"
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  {tA("above")}
                </button>
                <button
                  type="button"
                  onClick={() => setAlertDirection("below")}
                  aria-pressed={alertDirection === "below"}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    alertDirection === "below"
                      ? "border-destructive/40 bg-destructive/15 text-destructive"
                      : "border-border bg-background/60 text-muted-foreground hover:border-destructive/30 hover:text-foreground"
                  }`}
                >
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                  {tA("below")}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="alert-target"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {tA("target")}
              </Label>
              <Input
                id="alert-target"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={alertTarget}
                onChange={(e) => {
                  setAlertTarget(e.target.value);
                  setAlertError(null);
                }}
                placeholder={alertCoin && alertCoin.price > 0 ? fmtPrice(alertCoin.price) : undefined}
                className="h-9 border-border bg-background/60 text-sm"
              />
            </div>

            {alertError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {alertError === "validation"
                  ? tA("errValidation")
                  : alertError === "limit"
                    ? tA("errLimit")
                    : alertError === "duplicate"
                      ? tA("errDuplicate")
                      : tA("errGeneric")}
              </div>
            )}

            <Button
              type="submit"
              disabled={alertSaving || !alertCoin || !(Number(alertTarget) > 0)}
              className="h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {alertSaving ? tA("creating") : tA("create")}
            </Button>
          </form>

          {/* alert list */}
          <div className="flex flex-col">
            {alertsError ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
                <CircleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{tA("error")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadAlerts()}
                  className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  {t("retry")}
                </Button>
              </div>
            ) : alertsLoading && alerts.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">{tA("empty")}</p>
              </div>
            ) : (
              <ul className="nice-scroll max-h-96 divide-y divide-border/40 overflow-y-auto pr-1">
                {alerts.map((a) => {
                  const distancePct =
                    !a.triggered && a.currentPrice != null && a.targetPrice > 0
                      ? (Math.abs(a.currentPrice - a.targetPrice) / a.targetPrice) * 100
                      : null;
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <CoinAvatar image={a.image} symbol={a.symbol} size="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-bold text-foreground">{a.symbol}</span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">{a.name}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              a.direction === "above"
                                ? "bg-primary/10 text-primary"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {a.direction === "above" ? (
                              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                            )}
                            {a.direction === "above" ? tA("above") : tA("below")}
                          </span>
                          <span className="tnum text-xs text-muted-foreground">{fmtPrice(a.targetPrice)}</span>
                          <span className="tnum text-xs text-muted-foreground">
                            {tA("now")}: {a.currentPrice != null ? fmtPrice(a.currentPrice) : "—"}
                          </span>
                          {distancePct != null && (
                            <span className="tnum rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {tA("toTarget", {
                                pct:
                                  Math.abs(distancePct) >= 1000
                                    ? ">999%"
                                    : fmtPct(distancePct),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {a.triggered ? (
                          <span className="inline-flex animate-pulse items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                            {tA("statusTriggered")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {tA("statusActive")}
                          </span>
                        )}
                        <div className="flex items-center">
                          {a.triggered && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tA("rearm")}
                              disabled={alertActionId === a.id}
                              onClick={() => void rearmAlert(a)}
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tA("delete")}
                            disabled={alertActionId === a.id}
                            onClick={() => void deleteAlert(a)}
                            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* insights */}
      {insightLines.length > 0 && (
        <div className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">{t("insightsTitle")}</p>
          </div>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {insightLines.map((line, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${line.color}`} aria-hidden="true" />
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* exchange connections (import assets from Binance / Bitget / Tokocrypto) */}
      <ExchangeConnections onChanged={refreshAll} />

      {/* ---------------- add / edit dialog ---------------- */}
      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="rounded-2xl border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight">
              {dialogMode === "edit" ? t("editHolding") : t("addHolding")}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveHolding();
            }}
            className="flex flex-col gap-3"
          >
            {/* coin picker */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("coin")}
              </Label>
              <CoinPicker
                coin={coin}
                options={coinOptions}
                open={coinPickerOpen}
                onOpenChange={setCoinPickerOpen}
                onPick={pickCoin}
                disabled={dialogMode === "edit"}
                labels={{ select: t("selectCoin"), search: t("searchCoin"), empty: t("noCoins") }}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="holding-quantity"
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t("quantity")}
                </Label>
                <Input
                  id="holding-quantity"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-9 border-border bg-background/60 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="holding-price"
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t("purchasePrice")}
                </Label>
                <Input
                  id="holding-price"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceTouched(true);
                  }}
                  className="h-9 border-border bg-background/60 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="holding-date"
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t("purchaseDate")}
                </Label>
                <Input
                  id="holding-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9 border-border bg-background/60 text-sm"
                />
              </div>
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {formError === "validation" ? tAuth("errValidation") : t("error")}
              </div>
            )}

            <Button
              type="submit"
              disabled={saving}
              className="h-9 w-full bg-primary/15 text-sm font-semibold text-primary hover:bg-primary/25"
            >
              {saving ? t("saving") : t("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------- delete confirmation ---------------- */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(false);
          }
        }}
      >
        <AlertDialogContent className="rounded-2xl border-border sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">{t("confirmDelete")}</AlertDialogTitle>
          </AlertDialogHeader>
          {deleteError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {t("error")}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingPending}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- demo load confirmation ---------------- */}
      <AlertDialog open={demoOpen} onOpenChange={setDemoOpen}>
        <AlertDialogContent className="rounded-2xl border-border sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">{t("demoConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {t("demoConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" disabled={demoPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={demoPending}
              onClick={(e) => {
                e.preventDefault();
                void runDemoLoad();
              }}
              className="bg-primary/15 text-primary hover:bg-primary/25"
            >
              {demoPending ? t("demoLoading") : t("demoConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
