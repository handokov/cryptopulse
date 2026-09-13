/**
 * Read-only verification after user clarification: the Sep-11 trades in the
 * screenshot were HYPEUSDT (not LITUSDT). Three paper bots exist: LIT, BTC,
 * HYPE. User asks: is the bot's math correct, and why are LIT/BTC quiet?
 *
 *  1. Verify all 8 HYPE fills (from the screenshot, ICT times) against the
 *     real Bitget 5m candles at those instants — fill must sit inside [L, H].
 *  2. Current signal scores: LIT 4H (MODERATE, entry 0.55), BTC 4H, HYPE
 *     15M (AGGRESSIVE, entry 0.40) + HYPE 4H for context.
 *  3. Replay HYPE 15M score since Sep 12 00:00 UTC (after the daily-cap
 *     reset) — expect NO ticks ≥ 0.40, which would prove "not triggered"
 *     is correct engine behavior, not a dead cron.
 *
 * Run: bun scripts/verify-hype-and-quiet-bots.ts
 */
import { computeBotSignal, MODE_PRESETS } from "../src/lib/bot/strategy";
import { barsPerYearFor } from "../src/lib/bot/bitget-trade";

const BASE = "https://api.bitget.com";

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget code ${body.code}: ${body.msg}`);
  return body.data;
}

async function candles(symbol: string, g: string, limit: number, endTime?: number) {
  const endQ = endTime ? `&endTime=${endTime}` : "";
  const rows = await jget(`/api/v2/spot/market/candles?symbol=${symbol}&granularity=${g}&limit=${limit}${endQ}`);
  return rows.map((r: any[]) => ({ ts: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))
    .sort((a: any, b: any) => a.ts - b.ts);
}

const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";

/* Screenshot fills — times shown in the UI are Bangkok ICT (UTC+7). */
const FILLS = [
  { t: Date.parse("2026-09-11T13:00:00Z"), side: "BUY",  px: 81.9370 },
  { t: Date.parse("2026-09-11T13:40:00Z"), side: "SELL", px: 81.0760 },
  { t: Date.parse("2026-09-11T13:45:00Z"), side: "BUY",  px: 81.4480 },
  { t: Date.parse("2026-09-11T13:55:00Z"), side: "SELL", px: 82.9400 },
  { t: Date.parse("2026-09-11T14:00:00Z"), side: "BUY",  px: 83.4730 },
  { t: Date.parse("2026-09-11T14:45:00Z"), side: "SELL", px: 82.6130 },
  { t: Date.parse("2026-09-11T14:50:00Z"), side: "BUY",  px: 82.7290 },
  { t: Date.parse("2026-09-11T15:54:00Z"), side: "SELL", px: 82.3280 },
];

async function verifyHypeFills() {
  console.log("=== 1. VERIFIKASI FILL HYPEUSDT vs CANDLE BITGET 5M ===");
  const end = Date.parse("2026-09-11T16:00:00Z");
  const c5 = await candles("HYPEUSDT", "5min", 100, end);
  let inside = 0;
  for (const f of FILLS) {
    const bar = c5.find((b: any) => b.ts <= f.t && f.t < b.ts + 5 * 60_000);
    if (!bar) { console.log(`  ${f.side} ${f.px} @ ${fmt(f.t)} — candle 5m tidak ditemukan`); continue; }
    const ok = f.px >= bar.l * 0.999 && f.px <= bar.h * 1.001;
    if (ok) inside++;
    const dev = ((f.px - bar.c) / bar.c) * 100;
    console.log(`  ${f.side} ${f.px.toFixed(4).padStart(9)} @ ${fmt(f.t)} | candle L ${bar.l}–H ${bar.h} (C ${bar.c}) → ${ok ? "DI DALAM range ✓" : "DI LUAR range ✗"} (dev vs close ${dev >= 0 ? "+" : ""}${dev.toFixed(2)}%)`);
  }
  console.log(`  → ${inside}/${FILLS.length} fill berada di dalam range harga pasar saat itu\n`);
}

async function scoreSnapshot(name: string, symbol: string, tf: string, entry: number) {
  const g = { "15M": "15min", "4H": "4h" }[tf] ?? "4h";
  const bars = await candles(symbol, g, 160);
  const sig = computeBotSignal(bars.map((b: any) => b.c), barsPerYearFor(tf));
  console.log(`  ${name.padEnd(10)} ${symbol.padEnd(9)} TF ${tf.padEnd(4)} → score ${sig.score.toFixed(3).padStart(7)} (entry ≥ ${entry}) → ${sig.score >= entry ? "DI ZONA ENTRY" : "belum terpicu"}`);
  console.log(`            trend ${sig.trend.toFixed(2)}, momentum ${sig.momentum.toFixed(2)}, cycle ${sig.cycle.toFixed(2)}, volAnn ${sig.volAnnPct.toFixed(0)}%`);
  return sig;
}

async function replayHype() {
  console.log("\n=== 3. REPLAY HYPE 15M sejak reset cap harian (Sep 12 00:00 UTC) ===");
  const [b15, b5] = await Promise.all([candles("HYPEUSDT", "15min", 500), candles("HYPEUSDT", "5min", 500)]);
  const completed15 = b15; // filtered per tick below
  const start = Date.parse("2026-09-12T00:00:00Z");
  const step = 5 * 60_000;
  const entryScore = 0.40;
  const bpy = barsPerYearFor("15M");
  let ticks = 0, maxScore = -Infinity, maxT = 0;
  const qualifying: { t: number; s: number }[] = [];
  for (let t = start + step; t <= Date.now(); t += step) {
    const done = completed15.filter((b: any) => b.ts + 15 * 60_000 <= t).map((b: any) => b.c);
    const last5 = [...b5].reverse().find((b: any) => b.ts + 5 * 60_000 <= t);
    if (done.length < 40 || !last5) continue;
    let s: number;
    try { s = computeBotSignal([...done, last5.c], bpy).score; } catch { continue; }
    ticks++;
    if (s > maxScore) { maxScore = s; maxT = t; }
    if (s >= entryScore) qualifying.push({ t, s });
  }
  console.log(`  ${ticks} tick dievaluasi (proxy 5m untuk harga ticker)`);
  console.log(`  score maksimum sejak reset: ${maxScore.toFixed(3)} @ ${fmt(maxT)}`);
  if (qualifying.length === 0) {
    console.log(`  → TIDAK ADA tick dengan score ≥ ${entryScore} — bot HYPE memang BENAR tidak entry (bukan cron mati)`);
  } else {
    for (const q of qualifying.slice(0, 20)) console.log(`  tick ≥ entry: ${fmt(q.t)} score ${q.s.toFixed(3)}`);
  }
}

async function main() {
  console.log(`=== CryptoPulse verify — ${fmt(Date.now())} ===\n`);
  await verifyHypeFills();

  console.log("=== 2. SKOR TERKINI PER BOT (snapshot = yang dilihat tick berikutnya) ===");
  const t = await jget("/api/v2/spot/market/tickers?symbol=HYPEUSDT");
  console.log(`  HYPE live $${Number(t[0].lastPr)} (24h ${(Number(t[0].change24h) * 100).toFixed(2)}%)\n`);
  await scoreSnapshot("LIT (MODERATE)", "LITUSDT", "4H", MODE_PRESETS.MODERATE.entryScore);
  await scoreSnapshot("BTC (default)", "BTCUSDT", "4H", MODE_PRESETS.MODERATE.entryScore);
  await scoreSnapshot("HYPE (AGGRESSIVE)", "HYPEUSDT", "15M", MODE_PRESETS.AGGRESSIVE.entryScore);
  await scoreSnapshot("HYPE (konteks 4H)", "HYPEUSDT", "4H", 99);

  await replayHype();
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
