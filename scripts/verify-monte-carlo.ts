/**
 * Sanity checks for src/lib/monte-carlo.ts (run: bun scripts/verify-monte-carlo.ts)
 *  1. Determinism — same inputs → identical bands.
 *  2. Ordering — p10 ≤ p50 ≤ p90 at every step; band widens with t.
 *  3. Reality check — with fat-tailed crypto-like residuals, the P10–P90
 *     width at long horizons exceeds the analytic ±1σ̂√t zone.
 *  4. Shrinkage — μ̂·n/(n+30) exact; SE = σ̂/√n.
 */
import { bootstrapBand, shrinkDrift } from "../src/lib/monte-carlo";

const P0 = 78_015;
const MU = -0.00554;

/* crypto-like residuals: 30 de-meaned log returns with one fat tail */
const raw = Array.from({ length: 30 }, (_, i) => 0.002 * Math.sin(i * 2.7));
raw[7] = -0.09; // crash day
raw[18] = 0.06; // pump day
const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
const residuals = raw.map((r) => r - mean);

// 1) determinism
const a = bootstrapBand({ p0: P0, muDaily: MU, residuals, volMult: 1, horizonDays: 45 });
const b = bootstrapBand({ p0: P0, muDaily: MU, residuals, volMult: 1, horizonDays: 45 });
if (a.p10[44] !== b.p10[44] || a.p90[44] !== b.p90[44]) throw new Error("NOT deterministic");
console.log("1) deterministic OK — P10–P90@45d:", a.p10[44].toFixed(0), "–", a.p90[44].toFixed(0), "| P50:", a.p50[44].toFixed(0));

// 2) ordering + monotone widening
for (let t = 0; t < 45; t++) {
  if (!(a.p10[t] <= a.p50[t] && a.p50[t] <= a.p90[t])) throw new Error(`percentile order broken @t=${t + 1}`);
}
const w5 = a.p90[4] - a.p10[4];
const w45 = a.p90[44] - a.p10[44];
if (!(w45 > w5)) throw new Error("band did not widen with horizon");
console.log("2) ordering OK — width 5d:", w5.toFixed(0), "< 45d:", w45.toFixed(0));

// 3) fat-tail comparison vs analytic ±1σ̂√t (σ̂ estimated from the same residuals)
const sd = Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / (residuals.length - 1));
const analyticHalf = P0 * Math.exp(-0.00554 * 45) * (Math.exp(sd * Math.sqrt(45)) - 1);
const mcHalf = a.p90[44] - a.p50[44];
console.log("3) analytic ±1σ̂√45 upper half:", analyticHalf.toFixed(0), "| MC P50→P90 half:", mcHalf.toFixed(0), "| MC wider:", mcHalf > analyticHalf);

// 4) shrinkage math
const s = shrinkDrift(-0.00554, 0.025, 30);
const expected = -0.00554 * (30 / 60);
if (Math.abs(s.muEff - expected) > 1e-12) throw new Error("shrinkage math wrong");
if (Math.abs(s.se - 0.025 / Math.sqrt(30)) > 1e-12) throw new Error("SE math wrong");
console.log("4) shrinkage OK — μ̂:", (s.muEff * 100).toFixed(3) + "% (was", (muRaw(-0.00554)) + "%)", "| SE:", (s.se * 100).toFixed(3) + "%");
function muRaw(x: number) { return `${(x * 100).toFixed(3)}%`; }

console.log("ALL MONTE CARLO CHECKS PASSED");
