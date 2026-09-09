/**
 * Verification of the bot strategy (src/lib/bot/strategy.ts) with synthetic
 * 4H-bar series.
 *
 * Cases:
 *   1. Uptrend (drift + mild sine)  → score comfortably above MODERATE entry.
 *   2. Downtrend                    → score comfortably below −MODERATE entry.
 *   3. Pure seeded random walk      → |score| below MODERATE entry (no trade).
 *   4. Flat-ish series              → |score| small.
 *   5. Preset sanity: AGGRESSIVE enters earlier, targets further, wider stop,
 *      trades more often, shorter cooldown.
 *   6. Determinism: identical input → identical output.
 *
 * Run: bun scripts/verify-bot-strategy.ts
 */
import { computeBotSignal, MODE_PRESETS, shouldExit } from "../src/lib/bot/strategy";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 14), 1 | t)) >>> 0;
    return t / 4294967296;
  };
}
const gauss = (rng: () => number) => {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

const N = 160;
const mk = (driftPerBar: number, amp: number, period: number, sigma: number, seed: number) => {
  const rng = mulberry32(seed);
  let cum = 0;
  const closes: number[] = [];
  for (let t = 0; t < N; t++) {
    cum += gauss(rng) * sigma;
    closes.push(100 * Math.exp(driftPerBar * t + amp * Math.sin((2 * Math.PI * t) / period) + cum));
  }
  return closes;
};

/* --- case 1: uptrend --- */
{
  const s = computeBotSignal(mk(0.0015, 0.008, 40, 0.004, 11));
  console.log(`case1 uptrend  → score=${s.score} trend=${s.trend} mom=${s.momentum} drift=${s.driftPctPerBar.toFixed(4)}%/bar vol=${s.volAnnPct.toFixed(0)}%`);
  if (s.score < MODE_PRESETS.MODERATE.entryScore) throw new Error("case1: uptrend did not reach MODERATE entry");
}

/* --- case 2: downtrend --- */
{
  const s = computeBotSignal(mk(-0.0015, 0.008, 40, 0.004, 12));
  console.log(`case2 downtrend→ score=${s.score}`);
  if (s.score > -MODE_PRESETS.MODERATE.entryScore) throw new Error("case2: downtrend should be bearish");
}

/* --- case 3: pure noise → no trade --- */
{
  const s = computeBotSignal(mk(0, 0, 1, 0.008, 13));
  console.log(`case3 noise    → score=${s.score} (MODERATE entry ${MODE_PRESETS.MODERATE.entryScore})`);
  if (Math.abs(s.score) >= MODE_PRESETS.MODERATE.entryScore) {
    throw new Error("case3: noise triggered a MODERATE entry — thresholds too loose");
  }
}

/* --- case 4: flat --- */
{
  const s = computeBotSignal(mk(0, 0.0005, 40, 0.0008, 14));
  console.log(`case4 flat     → score=${s.score}`);
  if (Math.abs(s.score) > 0.2) throw new Error("case4: flat series produced a strong signal");
}

/* --- case 5: exit ladder + preset sanity --- */
{
  const sig = computeBotSignal(mk(0, 0, 1, 0.003, 15));
  const price = 100;
  const exitTp = shouldExit(sig, 100, price * 1.05, 103, 97, "MODERATE");
  const exitSl = shouldExit(sig, 100, price * 0.95, 103, 97, "MODERATE");
  const hold = shouldExit(sig, 100, 101, 103, 97, "MODERATE");
  console.log(`case5 exits    → tp=${exitTp.exit} sl=${exitSl.exit} hold=${hold.exit}`);
  if (exitTp.exit !== "take-profit" || exitSl.exit !== "stop-loss" || hold.exit !== null) {
    throw new Error("case5: exit ladder broken");
  }
  const m = MODE_PRESETS.MODERATE;
  const a = MODE_PRESETS.AGGRESSIVE;
  if (!(a.entryScore < m.entryScore && a.takeProfitPct > m.takeProfitPct && a.stopLossPct > m.stopLossPct && a.maxTradesPerDay > m.maxTradesPerDay && a.cooldownMin < m.cooldownMin)) {
    throw new Error("case5: preset ordering broken");
  }
}

/* --- case 6: determinism --- */
{
  const c = mk(0.0008, 0.006, 34, 0.005, 16);
  const a = JSON.stringify(computeBotSignal(c));
  const b = JSON.stringify(computeBotSignal(c));
  if (a !== b) throw new Error("case6: non-deterministic");
  console.log("case6 determinism ✓");
}

console.log("ALL BOT-STRATEGY CHECKS PASSED");
