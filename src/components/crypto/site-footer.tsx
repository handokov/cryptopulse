"use client";

import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("footer");

  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-xs text-muted-foreground sm:flex-row">
        <p>
          <span className="font-semibold text-foreground/80">CryptoPulse</span> — {t("about")}
        </p>
        <p className="max-w-md text-center sm:text-right">{t("disclaimer")}</p>
      </div>
    </footer>
  );
}
