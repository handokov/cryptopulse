"use client";

import { useEffect, useRef } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useLocaleStore } from "@/store/locale-store";
import { ALL_MESSAGES } from "@/i18n/messages";
import { LOCALES, type Locale } from "@/i18n/config";

/**
 * Wraps the app with next-intl's provider using the locale chosen in the
 * language switcher (no URL routing). Remounts on change so every
 * `useTranslations` consumer re-renders with the new catalog, and keeps
 * <html lang> in sync for accessibility/SEO.
 *
 * On the very first visit (nothing persisted yet) the locale is
 * auto-detected from the browser's navigator.language.
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const detectedRef = useRef(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  /* First-visit browser-locale auto-detection. */
  useEffect(() => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    try {
      if (localStorage.getItem("cryptopulse-locale")) return;
      const nav = (navigator.language || "").toLowerCase();
      if (!nav) return;
      const hit = LOCALES.find((l) => l.code !== "en" && nav.startsWith(l.code));
      if (hit) useLocaleStore.getState().setLocale(hit.code as Locale);
    } catch {
      /* storage/navigator unavailable — keep default */
    }
  }, []);

  return (
    <NextIntlClientProvider key={locale} locale={locale} messages={ALL_MESSAGES[locale]} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
