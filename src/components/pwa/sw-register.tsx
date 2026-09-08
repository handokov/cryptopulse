"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/**
 * Registers the service worker after load and surfaces
 * offline/online transitions as toasts. Renders nothing.
 */
export function SwRegister() {
  const t = useTranslations("pwa");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW is a progressive enhancement — never block the app */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  useEffect(() => {
    const onOffline = () => toast(t("offline"), { icon: "⚠️", duration: 6000 });
    const onOnline = () => toast.success(t("online"), { duration: 4000 });
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [t]);

  return null;
}
