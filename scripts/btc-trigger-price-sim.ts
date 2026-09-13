/**
 * btc-trigger-price-sim.ts — READ-ONLY simulation (no DB writes, no web changes).
 *
 * QUESTION (from user): if NO entry line is set on BTCUSDT, at roughly what
 * price would the bot trigger a BUY?
 *
 * MECHANIC: with no entry line the line-gate is OFF, so the ONLY gate is
 * score ≥ entryScore (AGGRESSIVE = 0.40). At that moment the bot fires a
 * MARKET BUY at whatever the live price is. So "trigger price" = the price
 * level where the composite score crosses 0.40.
 *
 * METHOD: the score is NOT a static function of one price level — it reads
 * the SHAPE of the recent 15M close series (EMA20/60 gap, RSI14, cycle fit,
 * 30-bar drift, 90-bar vol). So we take the REAL candles the engine sees,
 * append hypothetical future bars in several recovery shapes, and scan for
 * the minimal price X where computeBotSignal crosses 0.40:
 *
 *   A  spike1   — 1 bar straight to X (violent V)
 *   B  spike2   — 2 bars to X (~30 min)
 *   C  climb4   — 4 bars to X (~1 hour, steady)
 *   D  climb8   — 8 bars to X (~2 hours, slow grind)
 *   E  dipThenV — 1 bar dips −1% first, then 3 bars up to X
 *
 * All math below is an EXACT replica of src/lib/indicators.ts + strategy.ts
 * so results match the live engine bit-for-bit.
 */

const BASE = "https://api.bitget.com";
const SYMBOL = "BTCUSDT";
const TF = "15min";
const LIMIT = 200; // engine fetches 160; we take a bit more for stable EMAs
const BARS_PER_YEAR_15M = Math.round((365 * 24 * 60) / 15); // 35,040

/* ---------------- exact replicas (indicators.ts) ---------------- */

function ema(series: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}

function rsi(series: number[], period = 14): number {
  if (series.length < period + 2) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
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

interface CycleFit {
  period: number;
  r2: number;
  ampPct: number;
  posPct: number;
  rising: boolean;
}

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
  let stt = 0;
  let stl = 0;
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
      const d = r[i] - (a * Math.sin((2 * Math.PI * t) / T) + b * Math.cos((2 * Math.PI * t) / T) + 0);
      ssRes += d * d;
    }
    const r2 = Math.max(0, 1 - ssRes / ssTot);
    if (!best || r2 > best.r2) {
      best = { period: T, r2, ampPct: Math.sqrt(a * a + b * b) * 100, posPct: b * 100, rising: a > 0 };
    }
  }
  return best;
}

/* ---------------- exact replica (strategy.ts) ---------------- */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const tanh = (x: number) => Math.tanh(x);

interface Signal {
  score: number;
  trend: number;
  momentum: number;
  cycle: number;
  cycleR2: number;
  driftPctPerBar: number;
  volAnnPct: number;
}

function computeBotSignal(closes: number[]): Signal {
  if (closes.length < 40) throw new Error("need ≥40 bars");
  const rets = logReturns(closes);

  const emaFast = ema(closes, 20);
  const emaSlow = ema(closes, 60);
  const trend = tanh(((emaFast - emaSlow) / emaSlow) * 200);

  const r = rsi(closes, 14);
  const momentum = tanh((r - 50) / 18);

  let cycle = 0;
  let cycleR2 = 0;
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
  if (volAnnPct > 400) score *= 0.5;
  score = clamp(score, -1, 1);

  return {
    score: Math.round(score * 1000) / 1000,
    trend: Math.round(trend * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    cycle: Math.round(cycle * 1000) / 1000,
    cycleR2: Math.round(cycleR2 * 1000) / 1000,
    driftPctPerBar: muEff * 100,
    volAnnPct,
  };
}

/* ---------------- market data ---------------- */

async function fetchCloses(): Promise<{ closes: number[]; last: number }> {
  const res = await fetch(`${BASE}/api/v2/spot/market/candles?symbol=${SYMBOL}&granularity=${TF}&limit=${LIMIT}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { code?: string; data?: unknown[][] };
  if (body.code !== "00000" || !Array.isArray(body.data)) throw new Error("bad candles payload");
  const rows = body.data
    .map((r) => ({ time: Number(r[0]), close: Number(r[4]) }))
    .filter((c) => c.time > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
  const closes = rows.map((r) => r.close);
  return { closes, last: closes[closes.length - 1] };
}

/* ---------------- scenario shapes ---------------- */

type Shape = (base: number[], x: number) => number[];

const spike1: Shape = (base, x) => [x];
const spike2: Shape = (base, x) => {
  const last = base[base.length - 1];
  return [last + (x - last) * 0.5, x];
};
const climb4: Shape = (base, x) => {
  const last = base[base.length - 1];
  return Array.from({ length: 4 }, (_, i) => last + ((x - last) * (i + 1)) / 4);
};
const climb8: Shape = (base, x) => {
  const last = base[base.length - 1];
  return Array.from({ length: 8 }, (_, i) => last + ((x - last) * (i + 1)) / 8);
};
const dipThenV: Shape = (base, x) => {
  const last = base[base.length - 1];
  const dip = last * 0.99;
  return [dip, dip + (x - dip) / 3, dip + (2 * (x - dip)) / 3, x];
};

/* ---------------- main ---------------- */

async function main() {
  const { closes, last } = await fetchCloses();
  const now = computeBotSignal(closes);

  console.log(`=== BTCUSDT 15M — read-only trigger simulation ===`);
  console.log(`bars: ${closes.length} | last close: $${last.toFixed(2)}`);
  console.log(`CURRENT score (engine-replica): ${now.score.toFixed(3)}`);
  console.log(
    `  trend ${now.trend.toFixed(3)} | momentum ${now.momentum.toFixed(3)} | cycle ${now.cycle.toFixed(3)} (r2 ${now.cycleR2.toFixed(2)}) | drift ${now.driftPctPerBar.toFixed(4)}%/bar | vol ${now.volAnnPct.toFixed(0)}%`
  );
  console.log(`gate (no line): score >= 0.40 (AGGRESSIVE) -> instant market BUY\n`);

  const scenarios: { name: string; note: string; shape: Shape }[] = [
    { name: "A spike1  ", note: "1 bar langsung tembus (V violent)", shape: spike1 },
    { name: "B spike2  ", note: "2 bar (~30 mnt) naik ke X", shape: spike2 },
    { name: "C climb4  ", note: "4 bar (~1 jam) naik stabil ke X", shape: climb4 },
    { name: "D climb8  ", note: "8 bar (~2 jam) naik pelan ke X", shape: climb8 },
    { name: "E dipThenV", note: "dip -1% dulu, lalu rebound 3 bar ke X", shape: dipThenV },
  ];

  // scan X from -6% to +10% in 0.05% steps
  const lo = last * 0.94;
  const hi = last * 1.10;
  const step = last * 0.0005;

  console.log(`scenario | trigger price X (score>=0.40) | vs now | score@X | components`);
  console.log(`---------+-------------------------------+--------+---------+-----------`);

  for (const sc of scenarios) {
    let found: { x: number; sig: Signal } | null = null;
    for (let x = lo; x <= hi; x += step) {
      const fut = sc.shape(closes, x);
      const sig = computeBotSignal([...closes, ...fut]);
      if (sig.score >= 0.4) { found = { x, sig }; break; }
    }
    if (!found) {
      console.log(`${sc.name} | tidak tercapai di range -6%..+10% | - | - | ${sc.note}`);
      continue;
    }
    const pct = ((found.x - last) / last) * 100;
    console.log(
      `${sc.name} | $${found.x.toFixed(0)} | ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% | ${found.sig.score.toFixed(3)} | trend ${found.sig.trend.toFixed(2)} mom ${found.sig.momentum.toFixed(2)} cyc ${found.sig.cycle.toFixed(2)} drift ${found.sig.driftPctPerBar.toFixed(3)}`
    );
  }

  // Also report the 0.55 (MODERATE) level for scenario C as an extra reference
  let modX: number | null = null;
  for (let x = lo; x <= hi; x += step) {
    const sig = computeBotSignal([...closes, ...climb4(closes, x)]);
    if (sig.score >= 0.55) { modX = x; break; }
  }
  console.log("");
  if (modX) {
    console.log(`Referensi MODERATE (skor>=0.55, climb 1 jam): ~$${modX.toFixed(0)} (${(((modX - last) / last) * 100).toFixed(1)}% dari sekarang)`);
  }
  console.log(`\nCatatan: skor bergantung BENTUK pergerakan (seberapa cepat & seberapa rapi naiknya),`);
  console.log(`bukan satu level harga ajaib. Angka di atas = estimasi per bentuk skenario.`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
