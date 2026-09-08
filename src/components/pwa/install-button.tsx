"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Subset of the BeforeInstallPromptEvent we rely on. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPadOS 13+ reports a desktop Safari UA but keeps touch events. */
function looksLikeIos(): boolean {
  const ua = window.navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/i.test(ua) && "ontouchend" in document)
  );
}

/**
 * Header "Install app" action.
 *  - Chromium/Android: captures `beforeinstallprompt`, triggers the native
 *    install sheet on click, disappears once installed.
 *  - iOS Safari (no `beforeinstallprompt`): opens a short
 *    Share → Add to Home Screen walkthrough.
 * Hidden on desktop browsers that cannot install and when already standalone.
 */
export function InstallButton() {
  const t = useTranslations("pwa");
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already running as the installed app

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep Chrome's default mini-infobar out of the way
      setDeferred(e as InstallPromptEvent);
      setHidden(false);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
      toast.success(t("installedTitle"), {
        description: t("installedBody"),
        duration: 6000,
      });
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // iOS Safari never fires beforeinstallprompt → offer the manual walkthrough
    // (deferred so the effect body stays free of synchronous setStates)
    const detect = setTimeout(() => {
      if (looksLikeIos()) setHidden(false);
    }, 0);

    return () => {
      clearTimeout(detect);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [t]);

  const onClick = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") setHidden(true); // appinstalled also fires
      } catch {
        /* user gesture raced with dismissal — nothing to do */
      }
      // prompt() may only be consumed once per event
      setDeferred(null);
    } else if (looksLikeIos()) {
      setIosOpen(true);
    } else {
      setHidden(true); // no prompt & not iOS (e.g. desktop Firefox) — don't nag
    }
  };

  if (hidden) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClick}
        aria-label={t("install")}
        title={t("install")}
        className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left">
              <SquarePlus className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {t("iosTitle")}
            </DialogTitle>
            <DialogDescription className="text-left">{t("iosSubtitle")}</DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
            {(["iosStep1", "iosStep2", "iosStep3"] as const).map((key, i) => (
              <li key={key} className="flex items-start gap-2.5">
                <span className="tnum mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
