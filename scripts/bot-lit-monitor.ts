/**
 * LITUSDT bot monitor — reconstructs what the production bot did and where
 * the open position stands, using ONLY public Bitget data + the exact same
 * strategy code the server runs (src/lib/bot/strategy.ts).
 *
 * What it does:
 *   1. Fetch live ticker + 4H candles (160, engine timeframe) + 5m candles.
 *   2. Compute the composite score EXACTLY like the next cron tick will see.
 *   3. Replay 5-minute ticks (like the cron) over the last ~16 h to find the
 *      window where score >= MODERATE entry (0.55) — i.e. when the BUY fired.
 *   4. Derive entry price at the first qualifying tick after 07:18 UTC
 *      (the cron run that still had zero enabled bots), then compute
 *      TP / SL levels, current PnL% and PnL$ for the likely order size.
 *   5. Fetch exchange rules (minTradeUSDT) to check size clamping.
 *   6. Volatility context: how fast 1.8 % / 1.2 % bands get hit on LIT 4H.
 *
 * Run: bun scripts/bot-lit-monitor.ts
 */

import { computeBotSignal, MODE_PRESETS } from "../src/lib/bot/strategy";
import { stdev, logReturns } from "../src/lib/indicators";

const SYMBOL = "LITUSDT";
const BASE = "https://api.bitget.com";
/** The last cron run (07:18 UTC) answered results:[] — no bot existed yet. */
const ENABLE_AFTER_UTC = Date.parse("2026-09-09T07:18:30Z");
const BANGKOK_OFFSET = 7 * 3600_000; // UTC+7 in September (no DST in Thailand)

const fmtT = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";

const fmtBangkok = (ms: number) =>
  new Date(ms + BANGKOK_OFFSET).toISOString().replace("T", " ").slice(11, 16) + " ICT";

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget code ${body.code}: ${body.msg}`);
  return body.data;
}

async function candles(granularity: string, limit: number): Promise<{ ts: number; close: number }[]> {
  const rows = await jget(
    `/api/v2/spot/market/candles?symbol=${SYMBOL}&granularity=${granularity}&limit=${limit}`
  );
  return rows.map((r: any[]) => ({ ts: Number(r[0]), close: Number(r[4]) }));
}

async function main() {
  console.log(`\n=== CryptoPulse bot monitor — ${SYMBOL} — ${fmtT(Date.now())} ===\n`);

  /* ---- 1. live data ---- */
  const ticker = (await jget(`/api/v2/spot/market/tickers?symbol=${SYMBOL}`))[0];
  const price = Number(ticker.lastPr);
  const change24h = Number(ticker.change24h) * 100;
  const high24h = Number(ticker.high24h);
  const low24h = Number(ticker.low24h);
  console.log(`Harga live        : ${price}  (24h ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%, range ${low24h}–${high24h})`);

  const rules = (await jget(`/api/v2/spot/public/symbols?symbol=${SYMBOL}`))[0];
  const minTradeUSDT = Number(rules.minTradeUSDT);
  console.log(`Aturan exchange   : minTradeUSDT = ${minTradeUSDT}, base = ${rules.baseCoin ?? "?"}, qtyPrecision = ${rules.quantityPrecision}`);

  const bars4h = await candles("4h", 160);
  const bars5m = await candles("5min", 200); // ~16.6 jam terakhir
  console.log(`Candles           : ${bars4h.length} × 4H, ${bars5m.length} × 5m\n`);

  /* ---- 2. score SNAPSHOT now (what the next tick sees) ---- */
  const closes4h = bars4h.map((b) => b.close);
  const sig = computeBotSignal(closes4h); // last 4H row IS the forming bar — same as engine
  const mode = "MODERATE" as const;
  const P = MODE_PRESETS[mode];
  console.log("--- SKOR SAAT INI (persis seperti tick server berikutnya) ---");
  console.log(`score = ${sig.score}  (entry MODERATE ≥ ${P.entryScore}, exit-flip ≤ −${P.exitScore})`);
  console.log(`  trend=${sig.trend} momentum=${sig.momentum} cycle=${sig.cycle} (R²=${sig.cycleR2}, pos=${sig.cyclePosPct?.toFixed(1)}%, rising=${sig.cycleRising})`);
  console.log(`  drift/bar=${sig.driftPctPerBar.toFixed(4)}% volAnn=${sig.volAnnPct.toFixed(0)}% bars=${sig.bars}`);
  const inEntryZone = sig.score >= P.entryScore;
  console.log(`  → ${inEntryZone ? "masih di zona BELI (score ≥ 0.55)" : "di luar zona entry"}\n`);

  /* ---- 3. replay ticks 5-menit (≈ cron) untuk mencari BUY ---- */
  // Tick pada waktu T (emulasi engine):
  //   closes = semua bar 4H yang SUDAH selesai sebelum T  +  bar berjalan dg close = harga 5m terakhir ≤ T
  const closes5mAsc = [...bars5m].sort((a, b) => a.ts - b.ts);
  const windowStart = closes5mAsc[0].ts;
  const step = 5 * 60_000;
  const qualifying: { t: number; score: number; price: number }[] = [];
  for (let t = windowStart + step; t <= Date.now(); t += step) {
    const last5m = closes5mAsc.filter((b) => b.ts + 5 * 60_000 <= t).pop();
    if (!last5m) continue;
    const completed4h = bars4h.filter((b) => b.ts + 4 * 3600_000 <= t).map((b) => b.close);
    if (completed4h.length < 40) continue;
    const closes = [...completed4h, last5m.close];
    let s: number;
    try { s = computeBotSignal(closes).score; } catch { continue; }
    if (s >= P.entryScore) qualifying.push({ t, score: s, price: last5m.close });
  }

  console.log("--- REPLAY 5-MENIT (±16 jam terakhir): tick dg score ≥ 0.55 ---");
  if (qualifying.length === 0) {
    console.log("  (tidak ada — berarti entry terjadi sebelum jendela 5m ini)");
  } else {
    // group into contiguous windows
    const windows: { from: number; to: number; scores: number[]; prices: number[] }[] = [];
    for (const q of qualifying) {
      const last = windows[windows.length - 1];
      if (last && q.t - last.to <= step * 2) { last.to = q.t; last.scores.push(q.score); last.prices.push(q.price); }
      else windows.push({ from: q.t, to: q.t, scores: [q.score], prices: [q.price] });
    }
    for (const w of windows) {
      console.log(`  ${fmtT(w.from)} (${fmtBangkok(w.from)}) → ${fmtT(w.to)} : score max ${Math.max(...w.scores).toFixed(2)}, harga ${Math.min(...w.prices)}–${Math.max(...w.prices)}`);
    }
  }

  /* ---- 4. entry kandidat = tick pertama ≥0.55 SETELAH 07:18 UTC ---- */
  const postEnable = qualifying.filter((q) => q.t >= ENABLE_AFTER_UTC);
  const entryTick = postEnable[0] ?? qualifying[qualifying.length - 1] ?? null;
  console.log("");
  if (!entryTick) {
    console.log("Tidak bisa menentukan entry dari data 5m — tampilkan angka resmi dari kartu Bot (kolom Entry).");
    return;
  }
  const entry = entryTick.price;
  console.log("--- POSISI (estimasi entry = tick BUY pertama setelah bot aktif) ---");
  console.log(`Tick BUY kandidat : ${fmtT(entryTick.t)} (${fmtBangkok(entryTick.t)} Bangkok), score ${entryTick.score.toFixed(2)}, harga ${entry}`);

  // Ukuran order: max(orderSizeUsdt user, exchange min). Coba kedua skenario.
  const sizes = [Math.max(1.5, minTradeUSDT), minTradeUSDT > 1.5 ? minTradeUSDT : 5];
  const tp = entry * (1 + P.takeProfitPct / 100);
  const sl = entry * (1 - P.stopLossPct / 100);
  const pnlPct = ((price - entry) / entry) * 100;
  console.log(`TP (MODERATE +1.8%) : ${tp.toPrecision(6)}`);
  console.log(`SL (MODERATE −1.2%) : ${sl.toPrecision(6)}`);
  console.log(`Harga sekarang      : ${price}  → PnL ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`);
  console.log(`Jarak ke TP: ${(((tp - price) / price) * 100).toFixed(2)}%  |  jarak ke SL: ${(((price - sl) / price) * 100).toFixed(2)}%`);
  for (const s of [...new Set(sizes)]) {
    const pnlUsd = (pnlPct / 100) * s;
    console.log(`  jika order $${s.toFixed(2)} → PnL mengambang ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(3)} (TP +$${((P.takeProfitPct / 100) * s).toFixed(3)} / SL −$${((P.stopLossPct / 100) * s).toFixed(3)})`);
  }

  /* ---- 5. konteks volatilitas: seberapa cepat band 1.8/1.2 tersentuh ---- */
  const rets = logReturns(closes4h);
  const sdBar = stdev(rets.slice(-90)); // per 4H bar
  const avgAbsMove = rets.slice(-90).map(Math.abs).reduce((a, b) => a + b, 0) / Math.min(90, rets.length) * 100;
  console.log("\n--- KONTEKS VOLATILITAS (4H) ---");
  console.log(`σ per bar 4H   : ${(sdBar * 100).toFixed(2)}%  (vol annualized ≈ ${sig.volAnnPct.toFixed(0)}%)`);
  console.log(`|move| rata2   : ${avgAbsMove.toFixed(2)}% per bar 4H`);
  const barsTo = (dist: number) => Math.ceil((dist / (sdBar * 100)) ** 2);
  console.log(`Estimasi kasar waktu sentuhan (random-walk): TP ±1.8% ≈ ${barsTo(1.8)} bar 4H (~${(barsTo(1.8) * 4 / 24).toFixed(1)} hari), SL ±1.2% ≈ ${barsTo(1.2)} bar 4H (~${(barsTo(1.2) * 4 / 24).toFixed(1)} hari)`);
  console.log("\nCatatan: angka entry di atas REKONSTRUKSI dari data publik. Angka RESMI (entry, TP, SL, qty) tampil di kartu Bot → posisi terbuka; setelah posisi tutup, laporan kinerja menghitung PnL final.");
}

main().catch((e) => { console.error("MONITOR FAILED:", e.message); process.exit(1); });
