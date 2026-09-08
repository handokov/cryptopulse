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
