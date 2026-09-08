"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth-store";
import { fmtPrice } from "@/lib/format";

/* ---------------- types (mirror the /api/alerts contract) ---------------- */

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

/* ---------------- tiny avatar (mirrors the portfolio CoinAvatar) ---------------- */

function MiniAvatar({ image, symbol }: { image: string | null; symbol: string }) {
  if (image) {
    return <img src={image} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded-full" />;
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary"
      aria-hidden="true"
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

/* ---------------- AlertsBell (header trigger) ---------------- */

export function AlertsBell() {
  const tA = useTranslations("alerts");
  const tAuth = useTranslations("auth");
  const status = useAuthStore((s) => s.status);
  const setDialogOpen = useAuthStore((s) => s.setDialogOpen);

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);
  /** ids already announced — guards against duplicate trigger toasts across polls */
  const seenTriggered = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as AlertsPayload;
      setAlerts(json.alerts ?? []);
      // a re-armed alert may trigger again later → forget it so the next crossing notifies anew
      for (const a of json.alerts ?? []) {
        if (!a.triggered) seenTriggered.current.delete(a.id);
      }
      for (const item of json.newlyTriggered ?? []) {
        if (seenTriggered.current.has(item.id)) continue;
        seenTriggered.current.add(item.id);
        toast(tA("notifyTitle"), {
          description: tA("notifyBody", { name: item.name, target: fmtPrice(item.targetPrice) }),
          duration: 8000,
        });
      }
    } catch {
      /* the bell never nags about its own network failures */
    }
  }, [tA]);

  /* initial fetch + silent 60s polling while authenticated (skips hidden tabs) */
  useEffect(() => {
    if (status !== "authenticated") {
      seenTriggered.current.clear();
      return;
    }
    // deferred so the fetch does not run synchronously within the effect body
    const kick = setTimeout(() => void load(), 0);
    const iv = setInterval(() => {
      if (document.hidden) return;
      void load();
    }, 60000);
    return () => {
      clearTimeout(kick);
      clearInterval(iv);
    };
  }, [status, load]);

  /* derive the visible list so a stale fetch never renders after logout */
  const visibleAlerts = status === "authenticated" ? alerts : [];
  const triggeredCount = visibleAlerts.reduce((n, a) => (a.triggered ? n + 1 : n), 0);

  if (status === "loading") {
    return <Skeleton className="h-9 w-9 rounded-full" aria-hidden="true" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tA("bellAria")}
          className="relative h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {triggeredCount > 0 && (
            <span className="tnum absolute -right-0.5 -top-0.5 grid h-4 min-w-4 animate-pulse place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-black">
              {triggeredCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl border-border p-0">
        {status !== "authenticated" ? (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">{tA("bellSignIn")}</p>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                setDialogOpen(true);
              }}
              className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/25"
            >
              {tAuth("signIn")}
            </Button>
          </div>
        ) : visibleAlerts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{tA("bellEmpty")}</p>
        ) : (
          <ul className="nice-scroll max-h-72 divide-y divide-border/40 overflow-y-auto px-2 py-1">
            {visibleAlerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 px-1.5 py-2.5">
                <MiniAvatar image={a.image} symbol={a.symbol} />
                <span className="truncate text-xs font-bold text-foreground">{a.symbol}</span>
                {a.direction === "above" ? (
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className="tnum ml-auto shrink-0 text-xs text-muted-foreground">{fmtPrice(a.targetPrice)}</span>
                {a.triggered ? (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                    {tA("statusTriggered")}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                    {tA("statusActive")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <a
          href="#portfolio"
          onClick={() => setOpen(false)}
          className="flex items-center justify-center gap-1.5 border-t border-border/60 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
        >
          {tA("manage")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </PopoverContent>
    </Popover>
  );
}
