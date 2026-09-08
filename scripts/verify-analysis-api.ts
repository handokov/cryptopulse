/**
 * End-to-end API verification: POST /api/analysis and assert the response
 * is internally consistent with the printed strings.
 * Run: bun scripts/verify-analysis-api.ts
 */
interface Step {
  id: number;
  formula: string;
  detail: string;
}
interface AnalysisResponse {
  symbol: string;
  targets: { entry: number; target1: number; target2: number; stop: number };
  projection: { horizonDays: number; expectedPrice: number; expectedChangePct: number };
  steps: Step[];
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const close = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;

const res = await fetch("http://localhost:3000/api/analysis", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ symbol: "BTC", horizon: 45, factors: { momentum: 70, volume: 50, volatility: 50, sentiment: 50, liquidity: 50, trend: 70 }, locale: "en" }),
});
check("API 200", res.ok, `status ${res.status}`);
const data = (await res.json()) as AnalysisResponse;

const { projection, targets, steps } = data;
console.log(`  entry=$${targets.entry.toFixed(2)} · T=${projection.horizonDays}d · E=$${projection.expectedPrice.toFixed(2)} (${projection.expectedChangePct.toFixed(2)}%)`);

/* identity 1: pct strictly from price */
check(
  "expectedChangePct === ((E−entry)/entry)·100",
  close(projection.expectedChangePct, (projection.expectedPrice / targets.entry - 1) * 100, 1e-9)
);

/* identity 2: step-10 formula string carries the same numbers */
const s10 = steps.find((s) => s.formula.includes("E[C_T]"));
check("step 10 exists with substituted formula", !!s10, s10?.formula ?? "missing");
if (s10) {
  const m = s10.formula.match(/e\^\((-?[\d.]+)%×(\d+)\)\s*=\s*\$([\d,]+)/);
  check("formula parse: e^(μ̂%×T) = $price", !!m, s10.formula);
  if (m) {
    const driftPct = parseFloat(m[1]);
    const T = parseInt(m[2]);
    const printedPrice = parseFloat(m[3].replace(/,/g, ""));
    const recomputed = targets.entry * Math.exp(driftPct / 100 * T);
    check(
      "formula's printed price ≈ entry·e^(μ̂·T) (fmtPrice rounding)",
      close(recomputed, printedPrice, 1.5),
      `recomputed ${recomputed.toFixed(2)} vs printed ${printedPrice}`
    );
    check("formula T === projection.horizonDays", T === projection.horizonDays);
    check(
      "printed price ≈ projection.expectedPrice (fmtPrice rounding)",
      close(printedPrice, projection.expectedPrice, 1.5)
    );
  }
  /* identity 3: the natural-language detail agrees with the formula line */
  const dm = s10.detail.match(/([-+]?[\d.]+)%/);
  const pm = s10.detail.match(/\$([\d,]+(?:\.\d+)?)/);
  const cm = s10.detail.match(/([-+][\d.]+%)\)/);
  if (dm && pm && cm) {
    const drift = parseFloat(dm[1]) / 100;
    const price = parseFloat(pm[1].replace(/,/g, ""));
    const change = parseFloat(cm[1]);
    check(
      "detail change === ((price−entry)/entry)·100",
      close(change, (price / targets.entry - 1) * 100, 0.011),
      `detail: ${s10.detail}`
    );
    /* drift printed at 5dp → recomputation error ≤ entry·5e-8·T + price rounding */
    const tol = targets.entry * 5e-8 * projection.horizonDays + 2;
    check("detail price ≈ entry·e^(drift·T)", close(targets.entry * Math.exp(drift * projection.horizonDays), price, tol));
  } else {
    check("detail contains drift/price/change", false, s10.detail);
  }
}

/* identity 4: targets are positive and the stop sits on the correct side of
   entry for the emitted action (SHORT stops live above by design) */
const action = (data as unknown as { verdict: { action: string } }).verdict.action;
const dir = action === "SHORT" ? -1 : 1;
check("targets positive", [targets.target1, targets.target2, targets.stop].every((v) => v > 0));
check(
  `stop on the correct side of entry for ${action}`,
  dir === 1 ? targets.stop < targets.entry : targets.stop > targets.entry,
  `stop ${targets.stop.toFixed(2)} vs entry ${targets.entry.toFixed(2)}`
);

console.log(failures === 0 ? "\nAPI VERIFICATION PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
