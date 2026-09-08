"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCryptoStore } from "@/store/crypto-store";
import { fmtPrice, fmtPct } from "@/lib/format";
import { ArrowDown, TrendingUp } from "lucide-react";

/**
 * Hero with a dynamically morphing organic shape rendered on canvas.
 * Two counter-rotating blobs (emerald core + amber halo) breathe with
 * layered sine noise and react softly to the pointer position.
 */
export function MorphingHero() {
  const t = useTranslations("hero");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0.5, y: 0.5, active: false });
  const assets = useCryptoStore((s) => s.assets);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const N = 9; // control points around the blob
    const phases1 = Array.from({ length: N }, (_, i) => (i * 2 * Math.PI) / N);
    const phases2 = Array.from({ length: N }, (_, i) => (i * 2 * Math.PI) / N + 1.7);
    const speeds1 = Array.from({ length: N }, (_, i) => 0.35 + 0.045 * i);
    const speeds2 = Array.from({ length: N }, (_, i) => 0.22 + 0.033 * i);

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      mouse.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        active: true,
      };
    };
    const onLeave = () => {
      mouse.current.active = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    wrap.addEventListener("pointerleave", onLeave);

    /** Smooth closed curve through points via midpoint quadratics. */
    const tracePath = (pts: { x: number; y: number }[]) => {
      ctx.beginPath();
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
      const m0 = mid(pts[N - 1], pts[0]);
      ctx.moveTo(m0.x, m0.y);
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const m = mid(p, pts[(i + 1) % N]);
        ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
      }
      ctx.closePath();
    };

    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2 + (mouse.current.active ? (mouse.current.x - 0.5) * 30 : 0);
      const cy = h / 2 + (mouse.current.active ? (mouse.current.y - 0.5) * 24 : 0);
      const baseR = Math.min(w, h) * 0.31;
      const breathe = 1 + 0.025 * Math.sin(t * 0.7);

      // --- outer amber halo blob (counter-rotating) ---
      const outer: { x: number; y: number }[] = [];
      for (let i = 0; i < N; i++) {
        const ang = phases1[i] - t * 0.12;
        const wob =
          1 +
          0.14 * Math.sin(speeds1[i] * t + phases1[i] * 2.1) +
          0.07 * Math.sin(speeds2[i] * t * 1.3 + phases2[i]);
        const r = baseR * 1.28 * breathe * wob;
        outer.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
      }
      tracePath(outer);
      const halo = ctx.createRadialGradient(cx, cy, baseR * 0.4, cx, cy, baseR * 1.7);
      halo.addColorStop(0, "rgba(245,158,11,0.10)");
      halo.addColorStop(0.75, "rgba(245,158,11,0.05)");
      halo.addColorStop(1, "rgba(245,158,11,0)");
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.strokeStyle = "rgba(245,158,11,0.35)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // --- inner emerald core blob ---
      const core: { x: number; y: number }[] = [];
      for (let i = 0; i < N; i++) {
        const ang = phases2[i] + t * 0.16;
        const wob =
          1 +
          0.16 * Math.sin(speeds2[i] * t + phases2[i] * 1.4) +
          0.08 * Math.sin(speeds1[i] * t * 1.17 + phases1[i]);
        let r = baseR * breathe * wob;
        // soft pointer repulsion
        if (mouse.current.active) {
          const px = cx + Math.cos(ang) * r;
          const py = cy + Math.sin(ang) * r;
          const mx = mouse.current.x * w;
          const my = mouse.current.y * h;
          const d = Math.hypot(px - mx, py - my);
          if (d < 140) {
            const push = (1 - d / 140) * 26;
            const nx = (px - mx) / (d || 1);
            const ny = (py - my) / (d || 1);
            core.push({ x: px + nx * push, y: py + ny * push });
            continue;
          }
        }
        core.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
      }
      tracePath(core);
      const grad = ctx.createRadialGradient(cx - baseR * 0.25, cy - baseR * 0.3, baseR * 0.1, cx, cy, baseR * 1.25);
      grad.addColorStop(0, "rgba(16,185,129,0.32)");
      grad.addColorStop(0.6, "rgba(16,185,129,0.10)");
      grad.addColorStop(1, "rgba(16,185,129,0.02)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "rgba(16,185,129,0.75)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(16,185,129,0.55)";
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // --- vertex nodes ---
      for (const p of core) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(52,211,153,0.95)";
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const chips = assets.slice(0, 4);

  return (
    <section className="relative overflow-hidden" aria-label="Hero">
      <div ref={wrapRef} className="absolute inset-0" aria-hidden="true">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-4 pb-24 pt-28 text-center sm:pt-36">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary"
        >
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-primary" />
          {t("badge")}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl"
        >
          CryptoPulse
          <span className="block bg-gradient-to-r from-primary via-emerald-300 to-accent bg-clip-text text-transparent">
            {t("tagline")}
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href="#markets"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            <TrendingUp className="h-4 w-4" /> {t("ctaMarket")}
          </a>
          <a
            href="#analysis"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card/60 px-6 text-sm font-semibold backdrop-blur transition-colors hover:border-primary/50 hover:text-primary"
          >
            {t("ctaAnalysis")} <ArrowDown className="h-4 w-4" />
          </a>
        </motion.div>

        {/* floating live price chips */}
        <div className="pointer-events-none relative mt-12 h-16 w-full max-w-2xl">
          {chips.map((a, i) => {
            const pos = [
              "left-[2%] top-2 -rotate-3",
              "left-[28%] top-6 rotate-2",
              "right-[28%] top-1 -rotate-2",
              "right-[2%] top-5 rotate-3",
            ][i % 4];
            return (
              <motion.div
                key={a.symbol}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: [0, -7, 0] }}
                transition={{
                  opacity: { duration: 0.5, delay: 0.5 + i * 0.12 },
                  y: { duration: 3.4 + i * 0.5, repeat: Infinity, ease: "easeInOut" },
                }}
                className={`absolute ${pos} flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-2 text-xs backdrop-blur`}
              >
                <span className="font-semibold">{a.symbol}</span>
                <span className="tnum text-foreground/90">{fmtPrice(a.price)}</span>
                <span className={`tnum font-medium ${a.change24h >= 0 ? "text-primary" : "text-destructive"}`}>
                  {fmtPct(a.change24h)}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
