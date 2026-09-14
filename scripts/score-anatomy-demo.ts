/**
 * score-anatomy-demo.ts — READ-ONLY demo (no DB, no web changes).
 *
 * QUESTION: "is 0.40 too high? a token rose 5% but score still < 0.40"
 *
 * POINT: the score measures the QUALITY/REGIME of the trend, not the size of
 * one candle. Same +5% in different SHAPES and different PRIOR CONTEXTS gives
 * wildly different scores. We replicate computeBotSignal exactly and feed it
 * synthetic but realistic 15M series:
 *
 *   prior context: DOWNTREND (−0.15%/bar × 140 bars)  vs  SIDEWAYS base
 *   pump shapes  : +5% in 1 bar | over 8 bars | over 16 bars | spike-then-flat
 */

const BARS_PER_YEAR_15M = Math.round((365 * 24 * 60) / 15);

/* ---- exact replicas (indicators.ts + strategy.ts) ---- */

function ema(series: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}

function rsi(series: number[], period = 14): number {
  if (series.length < period + 2) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL <= 1e-12) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(Math.log(values[i] / values[i - 1]));
  return out;
}

interface CycleFit { period: number; r2: number; ampPct: number; posPct: number; rising: boolean; }

function cycleFit(prices: number[], minT = 6, maxT = 30): CycleFit | null {
  const n = prices.length;
  if (n < Math.max(minT * 2 + 2, 16)) return null;
  const w = Math.min(n - 1, maxT * 2);
  const hi = Math.min(maxT, Math.floor(w / 2));
  if (hi < minT) return null;
  const seg = prices.slice(n - 1 - w);
  const logP = seg.map(Math.log);
  const meanT = -w / 2;
  const meanL = logP.reduce((a, b) => a + b, 0) / logP.length;
  let stt = 0, stl = 0;
  for (let i = 0; i <= w; i++) {
    const t = i - w;
    stt += (t - meanT) ** 2;
    stl += (t - meanT) * (logP[i] - meanL);
  }
  const mu = stl / stt;
  const r: number[] = [];
  for (let i = 0; i <= w; i++) {
    const t = i - w;
    r.push(logP[i] - (logP[w] + mu * t));
  }
  const rBar = r.reduce((a, b) => a + b, 0) / r.length;
  const ssTot = r.reduce((a, b) => a + (b - rBar) ** 2, 0);
  if (ssTot <= 1e-12) return null;
  let best: CycleFit | null = null;
  for (let T = minT; T <= hi; T++) {
    let sss = 0, ssc = 0, ss1 = 0, scc = 0, sc1 = 0, bs = 0, bc = 0, b1 = 0;
    for (let i = 0; i <= w; i++) {
      const t = i - w;
      const s = Math.sin((2 * Math.PI * t) / T);
      const c = Math.cos((2 * Math.PI * t) / T);
      sss += s * s; ssc += s * c; ss1 += s; scc += c * c; sc1 += c;
      bs += r[i] * s; bc += r[i] * c; b1 += r[i];
    }
    const s11 = w + 1;
    const det = sss * (scc * s11 - sc1 * sc1) - ssc * (ssc * s11 - sc1 * ss1) + ss1 * (ssc * sc1 - scc * ss1);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) continue;
    const a = (bs * (scc * s11 - sc1 * sc1) - ssc * (bc * s11 - b1 * sc1) + ss1 * (bc * sc1 - scc * b1)) / det;
    const b = (sss * (bc * s11 - b1 * sc1) - bs * (ssc * s11 - sc1 * ss1) + ss1 * (ssc * b1 - bc * ss1)) / det;
    let ssRes = 0;
    for (let i = 0; i <= w; i++) {
      const t = i - w;
      const d = r[i] - (a * Math.sin((2 * Math.PI * t) / T) + b * Math.cos((2 * Math.PI * t) / T));
      ssRes += d * d;
    }
    const r2 = Math.max(0, 1 - ssRes / ssTot);
    if (!best || r2 > best.r2) best = { period: T, r2, ampPct: Math.sqrt(a * a + b * b) * 100, posPct: b * 100, rising: a > 0 };
  }
  return best;
}

const tanh = (x: number) => Math.tanh(x);

function computeBotSignal(closes: number[]) {
  const rets = logReturns(closes);
  const emaFast = ema(closes, 20);
  const emaSlow = ema(closes, 60);
  const trend = tanh(((emaFast - emaSlow) / emaSlow) * 200);
  const r = rsi(closes, 14);
  const momentum = tanh((r - 50) / 18);
  let cycle = 0, cycleR2 = 0;
  const fit = closes.length >= 40 ? cycleFit(closes, 6, 30) : null;
  if (fit) {
    cycleR2 = fit.r2;
    if (fit.posPct < 0 && fit.rising) cycle = fit.r2 * 0.8;
    else if (fit.posPct > 0 && !fit.rising) cycle = -fit.r2 * 0.8;
  }
  const w = rets.slice(-30);
  const muRaw = w.reduce((a, b) => a + b, 0) / (w.length || 1);
  const muEff = muRaw * (w.length / (w.length + 30));
  const drift = tanh(muEff * 1500);
  const sd = stdev(rets.slice(-90));
  const volAnnPct = sd * Math.sqrt(BARS_PER_YEAR_15M) * 100;
  let score = 0.4 * trend + 0.3 * momentum + 0.15 * cycle + 0.15 * drift;
  const chaos = volAnnPct > 400;
  if (chaos) score *= 0.5;
  return {
    score: Math.round(score * 1000) / 1000,
    trend: Math.round(trend * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    cycle: Math.round(cycle * 1000) / 1000,
    rsi: Math.round(r),
    emaGapPct: ((emaFast - emaSlow) / emaSlow) * 100,
    volAnnPct: Math.round(volAnnPct),
    chaos,
  };
}

/* ---- synthetic series builders (deterministic) ---- */

function downtrendBase(n = 140): number[] {
  const out: number[] = [];
  let p = 1.0;
  for (let i = 0; i < n; i++) { out.push(p); p *= 0.9985; } // −0.15%/bar
  return out;
}

function sidewaysBase(n = 140): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1.0 * (1 + 0.004 * Math.sin(i / 2.5) + 0.001 * Math.sin(i * 1.7)));
  return out;
}

function appendShape(base: number[], shape: number[]): number[] {
  const last = base[base.length - 1];
  return [...base, ...shape.map((r) => last * r)];
}

const spike1 = [1.05];
const climb8 = Array.from({ length: 8 }, (_, i) => Math.pow(1.05, (i + 1) / 8));
const climb16 = Array.from({ length: 16 }, (_, i) => Math.pow(1.05, (i + 1) / 16));
const spikeThenFlat = [1.05, ...Array(12).fill(1.05)];
const climb8ThenFlat = [...climb8, ...Array(12).fill(1.05)];

/* ---- main ---- */

const cases: { ctx: string; base: number[]; shape: string; shapeArr: number[] }[] = [
  { ctx: "DOWNTREND", base: downtrendBase(), shape: "+5% 1 bar (spike)", shapeArr: spike1 },
  { ctx: "DOWNTREND", base: downtrendBase(), shape: "+5% 8 bar (2 jam)", shapeArr: climb8 },
  { ctx: "DOWNTREND", base: downtrendBase(), shape: "+5% 16 bar (4 jam)", shapeArr: climb16 },
  { ctx: "DOWNTREND", base: downtrendBase(), shape: "+5% spike lalu 12 bar flat", shapeArr: spikeThenFlat },
  { ctx: "SIDEWAYS ", base: sidewaysBase(), shape: "+5% 1 bar (spike)", shapeArr: spike1 },
  { ctx: "SIDEWAYS ", base: sidewaysBase(), shape: "+5% 8 bar (2 jam)", shapeArr: climb8 },
  { ctx: "SIDEWAYS ", base: sidewaysBase(), shape: "+5% 16 bar (4 jam)", shapeArr: climb16 },
  { ctx: "SIDEWAYS ", base: sidewaysBase(), shape: "+5% 8 bar lalu 12 bar flat", shapeArr: climb8ThenFlat },
];

console.log(`=== Skor untuk KENAIKAN YANG SAMA (+5%) dalam bentuk & konteks berbeda (15M) ===\n`);
console.log(`konteks  | bentuk kenaikan              | skor   | trend | mom  | RSI  | gap EMA | vol  | catatan`);
console.log(`---------+------------------------------+--------+-------+------+------+---------+------+--------`);

for (const c of cases) {
  const closes = appendShape(c.base, c.shapeArr);
  const s = computeBotSignal(closes);
  const verdict = s.score >= 0.4 ? "ENTRY" : s.score >= 0.55 ? "ENTRY+" : "di bawah ambang";
  console.log(
    `${c.ctx} | ${c.shape.padEnd(28)} | ${s.score.toFixed(3).padEnd(6)} | ${s.trend.toFixed(2)}  | ${s.momentum.toFixed(2)} | ${String(s.rsi).padEnd(4)} | ${s.emaGapPct.toFixed(2)}%  | ${s.volAnnPct}%${s.chaos ? "*" : " "} | ${verdict}`
  );
}
console.log(`\n* = chaos filter aktif (vol > 400%/thn) → skor otomatis dipangkas setengah`);

/* ---- ingredient table: what combos cross 0.40 ---- */
console.log(`\n=== "Bahan" yang dibutuhkan agar skor >= 0.40 (tanpa bantuan cycle/drift) ===`);
for (const [t, m] of [[0.2, 0.9], [0.4, 0.7], [0.6, 0.5], [0.8, 0.3], [0.3, 0.3], [0.5, 0.5]] as [number, number][]) {
  const sc = 0.4 * t + 0.3 * m;
  const rsiNeeded = 50 + 18 * Math.atanh(m);
  const gapNeeded = (Math.atanh(t) / 200) * 100;
  console.log(`trend ${t.toFixed(1)} (EMA gap ~${gapNeeded.toFixed(2)}%) + momentum ${m.toFixed(1)} (RSI ~${rsiNeeded.toFixed(0)}) → skor ${sc.toFixed(3)} ${sc >= 0.4 ? "✓ masuk" : "✗ kurang"}`);
}
