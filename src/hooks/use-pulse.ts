"use client";

import { useEffect, useState } from "react";
import { useCryptoStore } from "@/store/crypto-store";

/**
 * Returns true for a short window every time the global pulse token fires
 * (asset selection / query / analysis run) — used to apply one-shot
 * flash-pulse feedback across panels.
 */
export function usePulse(duration = 1000): boolean {
  const token = useCryptoStore((s) => s.pulseToken);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (token === 0) return;
    // deferred flip-on avoids synchronous setState inside the effect body
    const t1 = setTimeout(() => setOn(true), 0);
    const t2 = setTimeout(() => setOn(false), duration);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [token, duration]);

  return on;
}
