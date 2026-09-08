"use client";

import { useEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useLocaleStore } from "@/store/locale-store";
import { ALL_MESSAGES } from "@/i18n/messages";

/**
 * Wraps the app with next-intl's provider using the locale chosen in the
 * language switcher (no URL routing). Remounts on change so every
 * `useTranslations` consumer re-renders with the new catalog, and keeps
 * <html lang> in sync for accessibility/SEO.
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <NextIntlClientProvider key={locale} locale={locale} messages={ALL_MESSAGES[locale]} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
