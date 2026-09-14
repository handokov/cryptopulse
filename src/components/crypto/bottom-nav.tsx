"use client";

/**
 * Mobile bottom navigation — CMC/CoinGecko-style fixed tab bar.
 * Mobile-only (lg:hidden, same breakpoint where the desktop header nav appears).
 * Scroll-spy: the tab whose section covers the 40%-viewport probe line lights up.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TrendingUp, ListOrdered, Radar, Newspaper, Wallet, Bot } from "lucide-react";

const TABS = [
  { id: "markets", keys: ["markets"], icon: TrendingUp },
  { id: "top100", keys: ["top100"], icon: ListOrdered },
  { id: "labs", keys: ["labs", "analysis"], icon: Radar },
  { id: "news", keys: ["news"], icon: Newspaper },
  { id: "portfolio", keys: ["portfolio"], icon: Wallet },
  { id: "bot", keys: ["bot"], icon: Bot },
] as const;

export function BottomNav() {
  const t = useTranslations("navtab");
  const [active, setActive] = useState<string>("markets");

  useEffect(() => {
    const sections = TABS.flatMap((tb) => tb.keys)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;

    const pick = () => {
      /* bottom of page → last tab (Trading Bot) */
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive("bot");
        return;
      }
      const probe = window.innerHeight * 0.4;
      let current = sections[0].id;
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          current = s.id;
          break;
        }
      }
      setActive(TABS.find((tb) => (tb.keys as readonly string[]).includes(current))?.id ?? "markets");
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, []);

  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/90 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-6">
        {TABS.map((tb) => {
          const on = active === tb.id;
          const Icon = tb.icon;
          return (
            <a
              key={tb.id}
              href={`#${tb.id}`}
              aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[9px] font-medium leading-none transition-colors ${
                on ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={on ? 2.4 : 1.8} aria-hidden />
              {t(tb.id)}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
