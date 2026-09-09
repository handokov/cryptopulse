/**
 * Verification of cycleFit (src/lib/indicators.ts) with synthetic series.
 *
 * Cases:
 *   1. Sine (A=2%, T=21d) + drift + seeded noise → period must land near 21,
 *      R² must be high, amplitude near 2%.
 *   2. Pure seeded random walk (no sine) → R² must stay low (no fake strong
 *      cycle); the detected period is meaningless by design.
 *   3. Flat series → null. 4. Too-short series → null.
 *   5. Determinism: identical inputs → identical outputs.
 *
 * Run: bun scripts/verify-cycle-fit.ts
 */
import { cycleFit } from "../src/lib/indicators";

/* deterministic PRNG (same family as monte-carlo.ts) */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng: () => number) => {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

const N = 120;

/* --- case 1: sine 3% @ 21d + drift 0.05%/d + noise σ=0.4%/d ---
   Signal strength matters: a detrended random walk leaves a Brownian-bridge
   residual (SS ≈ σ²·w²/6) that easily swamps a modest sine (SS ≈ A²/2·w).
   With realistic crypto noise the honest R² IS low — that is the point of
   the badge. Here we just prove the estimator recovers a STRONG sine. */
{
  const rng = mulberry32(20260909);
  let cum = 0;
  const prices: number[] = [];
  for (let t = 0; t < N; t++) {
    cum += gauss(rng) * 0.004;
    prices.push(100 * Math.exp(0.0005 * t + 0.03 * Math.sin((2 * Math.PI * t) / 21) + cum));
  }
  const fit = cycleFit(prices, 7, 60);
  if (!fit) throw new Error("case1: expected a fit");
  console.log(
    `case1 sine@21d  → T*=${fit.period}d R²=${fit.r2.toFixed(3)} A*=${fit.ampPct.toFixed(2)}%`,
  );
  if (fit.period < 19 || fit.period > 23) throw new Error("case1: period missed the 21d sine");
  if (fit.r2 < 0.5) throw new Error("case1: R² too low for a dominant sine");
  if (fit.ampPct < 2.2 || fit.ampPct > 4.2) throw new Error("case1: amplitude far from 3%");
}

/* --- case 2: pure random walk (no cycle) — realistic crypto noise --- */
{
  const rng = mulberry32(42);
  let cum = 0;
  const prices: number[] = [];
  for (let t = 0; t < N; t++) {
    cum += gauss(rng) * 0.012;
    prices.push(100 * Math.exp(0.0003 * t + cum));
  }
  const fit = cycleFit(prices, 7, 60);
  if (!fit) throw new Error("case2: expected a fit object (fit always runs on a valid series)");
  console.log(
    `case2 noise-only → T*=${fit.period}d R²=${fit.r2.toFixed(3)} A*=${fit.ampPct.toFixed(2)}% (spurious-fit guard)`,
  );
  if (fit.r2 >= 0.5) throw new Error("case2: random walk produced a suspiciously strong cycle R²");
}

/* --- case 3: flat series → null --- */
{
  const fit = cycleFit(Array(120).fill(100), 7, 60);
  console.log(`case3 flat      → ${fit === null ? "null ✓" : "NOT NULL ✗"}`);
  if (fit !== null) throw new Error("case3: flat series must return null");
}

/* --- case 4: too short (7d sparkline) → null --- */
{
  const rng = mulberry32(7);
  const short = Array.from({ length: 8 }, (_, i) => 100 * (1 + (gauss(rng) * 0.02 * i) / 10));
  const fit = cycleFit(short, 7, 60);
  console.log(`case4 short(8)  → ${fit === null ? "null ✓" : "NOT NULL ✗"}`);
  if (fit !== null) throw new Error("case4: short series must return null");
}

/* --- case 5: determinism --- */
{
  const rng = mulberry32(99);
  let cum = 0;
  const prices: number[] = [];
  for (let t = 0; t < N; t++) {
    cum += gauss(rng) * 0.008;
    prices.push(100 * Math.exp(0.0004 * t + 0.015 * Math.sin((2 * Math.PI * t) / 34) + cum));
  }
  const a = cycleFit(prices, 7, 60);
  const b = cycleFit(prices, 7, 60);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("case5: non-deterministic output");
  console.log(
    `case5 determinism → ${a ? `T*=${a.period}d R²=${a.r2.toFixed(3)} (identical twice) ✓` : "null"}`,
  );
}

/* --- cases 6-7: wave position NOW (posPct + rising) ---
   The fit anchors t=0 at the LAST point, so today's wave value is b and the
   direction is sign(a). With T=20, N=120, φ as chosen, the analytic wave at
   the final point is 3%·sin(2π·119/20 + φ): φ=0 → below trend AND rising
   (climbing out of a trough); φ=π → above trend AND falling (rolling off a
   peak). Tiny noise keeps the phase estimate clean. */
{
  const mk = (phi: number) => {
    const rng = mulberry32(777);
    let cum = 0;
    const prices: number[] = [];
    for (let t = 0; t < N; t++) {
      cum += gauss(rng) * 0.001;
      prices.push(100 * Math.exp(0.0002 * t + 0.03 * Math.sin((2 * Math.PI * t) / 20 + phi) + cum));
    }
    return prices;
  };
  const below = cycleFit(mk(0), 7, 60);
  if (!below) throw new Error("case6: expected a fit");
  console.log(
    `case6 trough-side → pos=${below.posPct.toFixed(2)}% rising=${below.rising} (expect <0, true)`,
  );
  if (below.posPct >= 0 || below.posPct < -2.2) throw new Error("case6: posPct out of range");
  if (!below.rising) throw new Error("case6: wave should be rising out of the trough");

  const above = cycleFit(mk(Math.PI), 7, 60);
  if (!above) throw new Error("case7: expected a fit");
  console.log(
    `case7 peak-side  → pos=${above.posPct.toFixed(2)}% rising=${above.rising} (expect >0, false)`,
  );
  if (above.posPct <= 0 || above.posPct > 2.2) throw new Error("case7: posPct out of range");
  if (above.rising) throw new Error("case7: wave should be falling off the peak");
}

console.log("ALL CYCLE-FIT CHECKS PASSED");
