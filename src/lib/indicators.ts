/**
 * Technical indicator math shared by the analysis engine.
 * All functions are pure and safe for server use.
 */

export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

export function emaSeries(values: number[], n: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (n + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function ema(values: number[], n: number): number | null {
  const s = emaSeries(values, n);
  return s.length ? s[s.length - 1] : null;
}

/** Wilder's RSI. */
export function rsi(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(values: number[], fast = 12, slow = 26, signalN = 9): MacdResult | null {
  if (values.length < slow + signalN) return null;
  const ef = emaSeries(values, fast);
  const es = emaSeries(values, slow);
  const line: number[] = [];
  for (let i = 0; i < values.length; i++) line.push(ef[i] - es[i]);
  const sig = emaSeries(line.slice(slow - 1), signalN);
  const m = line[line.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

export interface BollingerResult {
  mid: number;
  upper: number;
  lower: number;
  bandwidth: number;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function bollinger(values: number[], n = 20, k = 2): BollingerResult | null {
  if (values.length < n) return null;
  const window = values.slice(values.length - n);
  const mid = window.reduce((a, b) => a + b, 0) / n;
  const sd = stdev(window);
  return { mid, upper: mid + k * sd, lower: mid - k * sd, bandwidth: (2 * k * sd) / mid };
}

export function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(Math.log(values[i] / values[i - 1]));
  return out;
}

export function percentileRank(values: number[], x: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v <= x).length;
  return (below / values.length) * 100;
}

export interface CycleFit {
  /** Best period found (days). */
  period: number;
  /** Share of detrended price variation the sine explains in this window (0..1). */
  r2: number;
  /** Fitted amplitude as % of price (log-scale amplitude ≈ percent). */
  ampPct: number;
  /** Fitted wave value TODAY as % of price, signed: + above the trend, − below. */
  posPct: number;
  /** Wave direction today: fitted slope > 0 (rising) vs ≤ 0 (falling). */
  rising: boolean;
}

/**
 * Dominant-cycle detection on log prices. Detrends the most recent window
 * (≤ 2·maxT points) with an OLS log-linear trend, then scans periods and fits
 * a·sin(2πt/T) + b·cos(2πt/T) + c — free phase/amplitude — keeping the T with
 * the highest R². Also reports today's position in that wave (b·100 ≈ signed %
 * vs trend) and its direction (sign of a). Descriptive only: on a random walk a
 * window-fitted R² can flatter, so callers must frame it as "variation explained
 * in THIS window", never as predictive power. Pure math, deterministic, O(grid · window).
 */
export function cycleFit(prices: number[], minT = 7, maxT = 60): CycleFit | null {
  const n = prices.length;
  if (n < Math.max(minT * 2 + 2, 16)) return null;
  const w = Math.min(n - 1, maxT * 2); // window length (need ≥ ~2 full cycles)
  const hi = Math.min(maxT, Math.floor(w / 2));
  if (hi < minT) return null;

  const seg = prices.slice(n - 1 - w);
  const logP = seg.map(Math.log);

  // OLS log-linear trend μ̂ over t ∈ [−w, 0]
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

  // detrended residuals around the trend anchored at today's price
  const r: number[] = [];
  for (let i = 0; i <= w; i++) {
    const t = i - w;
    r.push(logP[i] - (logP[w] + mu * t));
  }
  const rBar = r.reduce((a, b) => a + b, 0) / r.length;
  const ssTot = r.reduce((a, b) => a + (b - rBar) ** 2, 0);
  if (ssTot <= 1e-12) return null; // flat series — nothing to explain

  let best: CycleFit | null = null;
  for (let T = minT; T <= hi; T++) {
    // normal equations for [sin, cos, 1]
    let sss = 0;
    let ssc = 0;
    let ss1 = 0;
    let scc = 0;
    let sc1 = 0;
    let bs = 0;
    let bc = 0;
    let b1 = 0;
    for (let i = 0; i <= w; i++) {
      const t = i - w;
      const s = Math.sin((2 * Math.PI * t) / T);
      const c = Math.cos((2 * Math.PI * t) / T);
      sss += s * s;
      ssc += s * c;
      ss1 += s;
      scc += c * c;
      sc1 += c;
      bs += r[i] * s;
      bc += r[i] * c;
      b1 += r[i];
    }
    const s11 = w + 1;
    // Cramer's rule on the 3×3 system [A=sss B=ssc C=ss1; B D=scc E=sc1; C E F=s11]
    // det = A(D·F − E²) − B(B·F − E·C) + C(B·E − D·C)
    const det = sss * (scc * s11 - sc1 * sc1) - ssc * (ssc * s11 - sc1 * ss1) + ss1 * (ssc * sc1 - scc * ss1);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) continue;
    // det_a (1st column → rhs): bs(D·F − E²) − B(bc·F − b1·E) + C(bc·E − D·b1)
    const a =
      (bs * (scc * s11 - sc1 * sc1) - ssc * (bc * s11 - b1 * sc1) + ss1 * (bc * sc1 - scc * b1)) / det;
    // det_b (2nd column → rhs): A(bc·F − b1·E) − bs(B·F − E·C) + C(B·b1 − bc·C)
    const b =
      (sss * (bc * s11 - b1 * sc1) - bs * (ssc * s11 - sc1 * ss1) + ss1 * (ssc * b1 - bc * ss1)) / det;
    const c = (b1 - a * ss1 - b * sc1) / s11;
    let ssRes = 0;
    for (let i = 0; i <= w; i++) {
      const t = i - w;
      const d = r[i] - (a * Math.sin((2 * Math.PI * t) / T) + b * Math.cos((2 * Math.PI * t) / T) + c);
      ssRes += d * d;
    }
    const r2 = Math.max(0, 1 - ssRes / ssTot);
    if (!best || r2 > best.r2) {
      /* Wave position NOW (t=0 is the last point): value = b·cos(0) = b,
         slope ∝ a·cos(0) = a — so b is today's signed offset from trend
         (log ≈ %) and sign(a) is today's direction. */
      best = {
        period: T,
        r2,
        ampPct: Math.sqrt(a * a + b * b) * 100,
        posPct: b * 100,
        rising: a > 0,
      };
    }
  }
  return best;
}
