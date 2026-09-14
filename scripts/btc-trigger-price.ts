/**
 * Read-only educational simulation for the user's BTC bot (AGGRESSIVE, 15M,
 * entry line armed at 76,600.88). Question: "at what PRICE would the bot
 * trigger?" The bot needs BOTH on the same tick:
 *   (1) score >= 0.40   (2) price touches the line.
 * The score is NOT a price — it's a strength reading over the last 160 15m
 * bars. This script quantifies:
 *   A. score if price jumped to X right now (single-bar replacement scan)
 *   B. price/time where the score crosses 0.40 during steady rallies of
 *      various speeds (forward simulation, window slides)
 * Run: bun scripts/btc-trigger-price.ts
 */
import { computeBotSignal } from "../src/lib/bot/strategy";
import { barsPerYearFor } from "../src/lib/bot/bitget-trade";

const BASE = "https://api.bitget.com";
const LINE = 76600.88;

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget ${body.code}`);
  return body.data;
}

async function main() {
  const rows = await jget(`/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=15min&limit=160`);
  const closes = rows.map((r: any[]) => Number(r[4])).filter((v: number) => v > 0);
  const bpy = barsPerYearFor("15M");
  const now = closes[closes.length - 1];
  const base = computeBotSignal(closes, bpy);
  console.log(`BTC 15m — harga terakhir ${now} — score baseline ${base.score.toFixed(3)} (butuh >= 0.40)`);
  console.log(`  trend ${base.trend.toFixed(2)}, momentum ${base.momentum.toFixed(2)}, cycle ${base.cycle.toFixed(2)}\n`);

  const scoreAt = (series: number[]) => computeBotSignal(series, bpy).score;

  /* score if the CURRENT price were X (replace the forming bar's close) */
  console.log("--- A. Score kalau harga 'langsung lompat' ke X (1 candle) ---");
  const at = (x: number) => scoreAt([...closes.slice(0, -1), x]);
  for (const pct of [-3, -2, -1, -0.24, 0, +1, +2, +3, +5, +8, +12]) {
    const x = now * (1 + pct / 100);
    console.log(`  X = ${x.toFixed(0).padStart(7)} (${pct >= 0 ? "+" : ""}${pct}%)  → score ${at(x).toFixed(3)}${at(x) >= 0.4 ? "  ← TERPICU" : ""}`);
  }
  const lineScore = at(LINE);
  console.log(`  X = ${LINE.toFixed(2)} (garis entry-mu) → score ${lineScore.toFixed(3)}\n`);

  /* find the single-bar price that reaches 0.40, if any */
  let found: number | null = null;
  for (let pct = 0.5; pct <= 30; pct += 0.1) {
    if (at(now * (1 + pct / 100)) >= 0.4) { found = now * (1 + pct / 100); break; }
  }
  console.log(found
    ? `  → Lompatan instan mencapai 0.40 pada ~$${found.toFixed(0)} (+${(((found - now) / now) * 100).toFixed(1)}% dalam SATU candle 15m — ekstrem)`
    : `  → TIDAK ADA harga tunggal: bahkan lompatan +30% dalam 1 candle belum mencapai score 0.40 — trend/momentum dari 159 candle sebelumnya menahan.\n(Score butuh KUAT YANG BERTAHAN, bukan satu lonjakan.)`);

  /* steady rally simulation: price rises r% per 15m bar, window slides */
  console.log("\n--- B. Simulasi rally stabil (naik r% per candle 15m) ---");
  for (const r of [0.1, 0.2, 0.3, 0.5]) {
    let hit: { price: number; bars: number; score: number } | null = null;
    let series = [...closes];
    for (let i = 1; i <= 96; i++) { // up to 24h
      const p = now * Math.pow(1 + r / 100, i);
      series = [...series.slice(1), p];
      const s = scoreAt(series);
      if (s >= 0.4) { hit = { price: p, bars: i, score: s }; break; }
    }
    console.log(hit
      ? `  +${r}%/15m (≈+${(r * 4).toFixed(1)}%/jam): score tembus 0.40 setelah ${hit.bars} candle (${(hit.bars * 15 / 60).toFixed(1)} jam) di harga ~$${hit.price.toFixed(0)} (+${(((hit.price - now) / now) * 100).toFixed(1)}%)`
      : `  +${r}%/15m: belum tembus dalam 24 jam`);
  }

  /* what a dip to the line does to the score */
  console.log("\n--- C. Kalau harga JUSTU turun menyentuh garis 76600.88 ---");
  console.log(`  score saat garis tersentuh ≈ ${lineScore.toFixed(3)} → ${lineScore >= 0.4 ? "BUY terjadi (kedua syarat terpenuhi)" : "garis tersentuh TAPI score belum 0.40 → tetap HOLD"}`);
  console.log("\nCatatan: simulasi membekukan 159 candle sebelumnya — angka bergeser seiring candle baru terbentuk. Ini ilustrasi mekanisme, bukan prediksi.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
