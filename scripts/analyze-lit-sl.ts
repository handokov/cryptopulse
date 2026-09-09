/**
 * LITUSDT SL post-mortem — what ACTUALLY happened vs what indicator-based
 * exits would have done. Public Bitget data only + the real strategy code.
 *
 *  A. official-style reconstruction of the SL trade (entry 5.265 @ 07:20Z)
 *  B. full 5m path since entry: highest gain, then the drop into the stop
 *  C. counterfactuals:
 *     1) FIXED 1.8/1.2 (current MODERATE preset)
 *     2) VOL-scaled: SL=0.8σ, TP=1.2σ (σ = stdev of 4H log returns, 90 bars)
 *     3) VOL-scaled + trailing stop: trail 0.8σ from peak, armed at +1.0σ
 *  D. re-entry check: after SL close + 45 min cooldown, is score ≥ 0.55 again?
 *
 * Run: bun scripts/analyze-lit-sl.ts
 */

import { computeBotSignal, MODE_PRESETS } from "../src/lib/bot/strategy";
import { stdev, logReturns } from "../src/lib/indicators";

const SYMBOL = "LITUSDT";
const BASE = "https://api.bitget.com";
const BANGKOK_OFFSET = 7 * 3600_000;

const fmtT = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(5, 16) + "Z";
const fmtICT = (ms: number) => new Date(ms + BANGKOK_OFFSET).toISOString().replace("T", " ").slice(11, 16);

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget code ${body.code}: ${body.msg}`);
  return body.data;
}

async function candles(g: string, limit: number): Promise<{ ts: number; close: number; low: number; high: number }[]> {
  const rows = await jget(`/api/v2/spot/market/candles?symbol=${SYMBOL}&granularity=${g}&limit=${limit}`);
  return rows.map((r: any[]) => ({ ts: Number(r[0]), close: Number(r[4]), low: Number(r[3]), high: Number(r[2]) }));
}

interface Exit { t: number; price: number; reason: string; pnlPct: number }

/** Walk the 5m path; first touch decides. Lows for stops, highs for TP (engine sees ticker). */
function simulate(
  path: { ts: number; close: number; low: number; high: number }[],
  entry: number,
  entryT: number,
  slPct: number,
  tpPct: number,
  trail?: { armPct: number; trailPct: number }
): Exit | null {
  let highest = entry;
  let trailStop: number | null = null;
  for (const p of path) {
    if (p.ts < entryT) continue;
    /* TP dicek dulu (urutan engine: exits first, TP sebelum SL) */
    if (p.high >= entry * (1 + tpPct / 100)) return { t: p.ts, price: entry * (1 + tpPct / 100), reason: "take-profit", pnlPct: tpPct };
    if (trail) {
      highest = Math.max(highest, p.high);
      const gainPct = ((highest - entry) / entry) * 100;
      if (gainPct >= trail.armPct) trailStop = Math.max(trailStop ?? 0, highest * (1 - trail.trailPct / 100));
      const fixedStop = entry * (1 - slPct / 100);
      const effStop = Math.max(fixedStop, trailStop ?? 0);
      if (p.low <= effStop) {
        const isTrail = trailStop !== null && trailStop > fixedStop;
        return { t: p.ts, price: effStop, reason: isTrail ? "trail-stop" : "stop-loss", pnlPct: ((effStop - entry) / entry) * 100 };
      }
    } else if (p.low <= entry * (1 - slPct / 100)) {
      return { t: p.ts, price: entry * (1 - slPct / 100), reason: "stop-loss", pnlPct: -slPct };
    }
  }
  const now = path[path.length - 1].close;
  return { t: Date.now(), price: now, reason: "still-open", pnlPct: ((now - entry) / entry) * 100 };
}

async function main() {
  console.log(`\n=== LITUSDT SL post-mortem — ${fmtT(Date.now())} (${fmtICT(Date.now())} ICT) ===\n`);
  const ticker = (await jget(`/api/v2/spot/market/tickers?symbol=${SYMBOL}`))[0];
  const price = Number(ticker.lastPr);
  const bars4h = await candles("4h", 160);
  const bars5m = (await candles("5min", 200)).sort((a, b) => a.ts - b.ts);

  /* entry dari rekonstruksi tick 07:20Z */
  const entryT = Date.parse("2026-09-09T07:20:00Z");
  const entryTick = bars5m.filter((b) => b.ts >= entryT - 60_000)[0];
  const entry = 5.265; // tick BUY kandidat (rekonstruksi monitor 08:08Z)
  console.log(`Entry (rekonstruksi) : ${entry} @ ${fmtT(entryT)}`);
  console.log(`Harga sekarang       : ${price}\n`);

  /* σ 4H — window yang sama dengan engine (90 bar terakhir) */
  const closes4h = bars4h.map((b) => b.close);
  const sig = computeBotSignal(closes4h);
  const sdBar = stdev(logReturns(closes4h.slice(-91))) * 100;
  console.log(`σ 4H (90 bar)        : ${sdBar.toFixed(2)}% per bar (volAnn ${sig.volAnnPct.toFixed(0)}%)`);
  console.log(`Skor sekarang        : ${sig.score} (trend ${sig.trend}, momentum ${sig.momentum})\n`);

  /* jalur sejak entry */
  const path = bars5m.filter((b) => b.ts >= entryT);
  const hi = path.reduce((a, b) => (b.close > a.close ? b : a));
  const lo = path.reduce((a, b) => (b.close < a.close ? b : a));
  console.log("--- JALUR 5M SEJAK 07:15Z (close | low) ---");
  for (const b of bars5m.filter((x) => x.ts >= Date.parse("2026-09-09T07:15:00Z"))) {
    console.log(`  ${fmtT(b.ts)} (${fmtICT(b.ts)} ICT)  close ${b.close.toFixed(3)}  low ${b.low.toFixed(3)}`);
  }
  console.log("");

  /* scan: entry di tick mana yang konsisten dgn "SL terpicu"? */
  console.log("--- SCAN ENTRY KANDIDAT (SL 1.2% terpicu?) ---");
  for (const cand of path.filter((b) => b.ts <= Date.parse("2026-09-09T08:20:00Z"))) {
    const stop = cand.close * 0.988;
    const after = path.filter((b) => b.ts > cand.ts);
    const hit = after.find((b) => b.low <= stop);
    const tpHit = after.find((b) => b.high >= cand.close * 1.018);
    if (hit && (!tpHit || hit.ts < tpHit.ts)) {
      console.log(`  entry @ ${fmtT(cand.ts)} = ${cand.close.toFixed(3)} → SL ${stop.toFixed(4)} TERPICU @ ${fmtT(hit.ts)} (low ${hit.low})`);
    }
  }
  console.log("");
  console.log("--- JALUR 5M SEJAK ENTRY ---");
  console.log(`Tertinggi : ${hi.close} @ ${fmtT(hi.ts)} (${(((hi.close - entry) / entry) * 100).toFixed(2)}%)`);
  console.log(`Terendah  : ${lo.close} @ ${fmtT(lo.ts)} (${(((lo.close - entry) / entry) * 100).toFixed(2)}%)`);
  const fixedSL = entry * 0.988;
  /* engine membaca TICKER di tick 5-menit — ticker bisa jauh di bawah close candle.
     Deteksi paling dekat dengan kenyataan: candle LOW ≤ stop (wick sesaat pun cukup). */
  const slTick = path.find((b) => b.low <= fixedSL);
  const slTickClose = path.find((b) => b.close <= fixedSL);
  if (slTick) {
    console.log(`SL 1.2% TERPICU: candle low ${slTick.low} @ ${fmtT(slTick.ts)} (${fmtICT(slTick.ts)} ICT) — ticker saat tick ≤ ${fixedSL.toFixed(4)}`);
    console.log(`  (close-based: ${slTickClose ? `close ${slTickClose.close} @ ${fmtT(slTickClose.ts)}` : "tidak pernah — berarti wick sesaat"})`);
    console.log(`  loss resmi ≈ −1.2% ≈ −$${((P.stopLossPct / 100) * 1.5).toFixed(3)} @ order $1.5 (exitPrice = ticker di tick SL)\n`);
  } else {
    console.log(`SL 1.2% belum tersentuh bahkan pada low 5m — kemungkinan entry resmi lebih tinggi dari 5.265. Cek kolom Entry di kartu Bot.\n`);
  }

  /* counterfactual */
  const P = MODE_PRESETS.MODERATE;
  console.log("--- COUNTERFACTUAL (jalur yang sama, aturan exit berbeda) ---");
  const scenarios: { name: string; sl: number; tp: number; trail?: { armPct: number; trailPct: number } }[] = [
    { name: "1) FIXED 1.8/1.2 (sekarang)", sl: P.stopLossPct, tp: P.takeProfitPct },
    { name: `2) VOL: SL=0.8σ=${(0.8 * sdBar).toFixed(2)}%, TP=1.2σ=${(1.2 * sdBar).toFixed(2)}%`, sl: 0.8 * sdBar, tp: 1.2 * sdBar },
    { name: `3) VOL + TRAIL (arm +${sdBar.toFixed(2)}%, trail 0.8σ=${(0.8 * sdBar).toFixed(2)}%)`, sl: 0.8 * sdBar, tp: 1.2 * sdBar, trail: { armPct: 1.0 * sdBar, trailPct: 0.8 * sdBar } },
  ];
  for (const s of scenarios) {
    const out = simulate(path, entry, entryT, s.sl, s.tp, s.trail);
    const pnl = ((out!.price - entry) / entry) * 100;
    console.log(`${s.name}`);
    console.log(`   → exit ${out!.reason} @ ${fmtT(out!.t)} price ${out!.price.toFixed(3)} → PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}% ($${((pnl / 100) * 1.5).toFixed(3)} @ $1.5)`);
  }

  /* re-entry check */
  console.log("\n--- RE-ENTRY? (setelah SL + cooldown 45 menit, score ≥ 0.55) ---");
  if (!slTick) { console.log("SL belum terjadi — skip."); return; }
  const cooldownEnd = slTick.ts + 45 * 60_000;
  const closes5mAsc = bars5m;
  let reT: number | null = null;
  for (let t = Math.max(cooldownEnd, closes5mAsc[0].ts + 5 * 60_000); t <= Date.now(); t += 5 * 60_000) {
    const last5m = closes5mAsc.filter((b) => b.ts + 5 * 60_000 <= t).pop();
    if (!last5m) continue;
    const done4h = bars4h.filter((b) => b.ts + 4 * 3600_000 <= t).map((b) => b.close);
    if (done4h.length < 40) continue;
    try {
      const s = computeBotSignal([...done4h, last5m.close]).score;
      if (s >= 0.55) { reT = t; console.log(`Tick pertama layak BUY lagi: ${fmtT(t)} (${fmtICT(t)} ICT), score ${s.toFixed(2)}, harga ${last5m.close}`); break; }
    } catch { continue; }
  }
  if (!reT) console.log("Belum ada tick dengan score ≥ 0.55 setelah cooldown → kemungkinan TIDAK ada re-entry.");
  console.log("\nCatatan: cek kartu Bot untuk posisi resmi — kalau ada re-entry, akan tampil posisi terbuka baru.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
