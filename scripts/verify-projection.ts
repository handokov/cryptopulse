/**
 * Projection math verification — asserts the identities required by the
 * calculation audit:
 *   1. expectedChangePct === ((expectedPrice − p0) / p0) · 100   (exact)
 *   2. expectedPrice === p0 · e^(μ̂·T) · W(T)                     (exact)
 *   3. driftPrice === p0 · e^(μ̂·T), and pct identity for it
 *   4. waveContributionPct === expectedChangePct − driftChangePct
 *   5. buildPath endpoint === projectPrice endpoint
 *   6. mu=0, A=0  →  expectedPrice === p0 (no drift, no wave)
 *   7. the user's reported scenario reproduces exact arithmetic
 * Run: bun scripts/verify-projection.ts
 */
import { buildPath, projectPrice, fmtMu, substitutedExpr } from "../src/lib/projection";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1) synthetic case mirroring the user's report ---------- */
console.log("Case A — lab model: P0=78,688, μ̂=−0.554%/d, T=45, A=1.5%, Tp=21d");
const p0 = 78_688;
const mu = -0.00554;
const T = 45;
const out = projectPrice({
  p0,
  muDaily: mu,
  horizonDays: T,
  waveAmpPct: 1.5,
  wavePeriodDays: 21,
  sdDaily: 0.03,
  volMult: 1,
});

const manualDrift = p0 * Math.exp(mu * T);
const tau = 21 * 2;
const manualWave =
  1 + (1.5 / 100) * Math.sin((2 * Math.PI * T) / 21) * Math.exp(-T / tau);
const manualPrice = manualDrift * manualWave;

check("driftPrice === p0·e^(μ̂·T)", close(out.driftPrice, manualDrift, 1e-6));
check("waveFactor matches closed form", close(out.waveFactor, manualWave, 1e-12));
check("expectedPrice === drift·wave", close(out.expectedPrice, manualPrice, 1e-6));
check(
  "expectedChangePct === ((PT−P0)/P0)·100 exact",
  close(out.expectedChangePct, (out.expectedPrice / p0 - 1) * 100)
);
check(
  "driftChangePct === ((drift−P0)/P0)·100 exact",
  close(out.driftChangePct, (out.driftPrice / p0 - 1) * 100)
);
check(
  "waveContributionPct === expected − drift",
  close(out.waveContributionPct, out.expectedChangePct - out.driftChangePct, 1e-9)
);
console.log(
  `    → drift $${manualDrift.toFixed(2)} (${out.driftChangePct.toFixed(2)}%) · W=${manualWave.toFixed(4)} · final $${manualPrice.toFixed(2)} (${out.expectedChangePct.toFixed(2)}%)`
);

/* ---------- 2) engine case: user's Forward Analysis numbers ---------- */
console.log("Case B — engine (no wave): P0=78,688, μ̂=−0.823%/d, T=45");
const outB = projectPrice({ p0, muDaily: -0.00823, horizonDays: 45 });
check("waveFactor === 1 when wave disabled", outB.waveFactor === 1);
check(
  "−0.823%/d over 45d → ≈−30.96% (user's printed pair reconciles)",
  close(outB.expectedChangePct, (54_325 / 78_688 - 1) * 100, 0.05),
  `got ${outB.expectedChangePct.toFixed(2)}%`
);
check(
  "same μ̂ over 30d would give −21.87% (no hidden T mixing)",
  close(projectPrice({ p0, muDaily: -0.00823, horizonDays: 30 }).expectedChangePct, -21.87, 0.01)
);

/* ---------- 3) path endpoint === projectPrice endpoint ---------- */
console.log("Case C — buildPath endpoint identity");
const built = buildPath({
  p0,
  muDaily: mu,
  horizonDays: T,
  waveAmpPct: 1.5,
  wavePeriodDays: 21,
});
check(
  "path[last] === expectedPrice",
  close(built.path[built.path.length - 1], out.expectedPrice, 1e-9)
);
check("path length === horizon", built.path.length === T);

/* ---------- 4) degenerate cases ---------- */
console.log("Case D — degenerate inputs");
const flat = projectPrice({ p0, muDaily: 0, horizonDays: 45 });
check("μ̂=0, no wave → price unchanged", close(flat.expectedPrice, p0, 1e-9) && flat.expectedChangePct === 0);
const disabledWave = projectPrice({ p0, muDaily: mu, horizonDays: 45, waveAmpPct: 0, wavePeriodDays: 21 });
check("A=0 disables wave entirely", disabledWave.waveFactor === 1 && close(disabledWave.expectedPrice, manualDrift, 1e-9));

/* ---------- 5) display builders ---------- */
console.log("Case E — display builders");
check("fmtMu sign + unit", fmtMu(0.00554) === "+0.554%/d" && fmtMu(-0.00823) === "-0.823%/d");
check(
  "substitutedExpr carries exact p0/μ̂/T (5dp drift)",
  substitutedExpr(78_688, -0.00823, 45) === "$78,688 · e^(-0.82300%×45)"
);

console.log(failures === 0 ? "\nALL IDENTITIES HOLD ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
