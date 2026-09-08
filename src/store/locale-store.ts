"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** Client-side locale choice, persisted to localStorage (no URL routing). */
export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "cryptopulse-locale",
      onRehydrateStorage: () => (state) => {
        // guard against stale/invalid persisted values
        if (state && !isLocale(state.locale)) state.locale = DEFAULT_LOCALE;
      },
    }
  )
);
