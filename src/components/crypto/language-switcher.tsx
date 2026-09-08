"use client";

import { LOCALES, localeFlag } from "@/i18n/config";
import { useLocaleStore } from "@/store/locale-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Languages } from "lucide-react";

/** Circular flag icon (SVG via flag-icons). size in px. */
export function FlagIcon({ country, size = 18 }: { country: string; size?: number }) {
  return (
    <span
      className={`fi fi-${country} fis rounded-full shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.18)]`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("language")}
        className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Languages className="hidden h-3.5 w-3.5 text-primary sm:block" />
        <FlagIcon country={localeFlag(locale)} size={16} />
        <span className="hidden sm:inline">{locale.toUpperCase()}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => setLocale(l.code)}
            className="flex cursor-pointer items-center gap-2.5"
            aria-current={l.code === locale}
          >
            <FlagIcon country={l.flag} size={17} />
            <span className="flex-1 text-sm">{l.label}</span>
            {l.code === locale && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
