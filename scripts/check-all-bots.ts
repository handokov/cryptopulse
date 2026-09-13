/**
 * Read-only health check for ALL 5 user bots: LIT, BTC, HYPE, KII, ZEC.
 * For each symbol: live price + 24h change + composite score on 15M / 1H / 4H.
 * Decision logic that works WITHOUT knowing each bot's exact config:
 *   score < 0.40  → below BOTH thresholds (AGGRESSIVE 0.40 / MODERATE 0.55)
 *                   → "not triggered" is CORRECT for any config.
 *   score ≥ 0.40  → config matters → flag for manual check.
 * Run: bun scripts/check-all-bots.ts
 */
import { computeBotSignal } from "../src/lib/bot/strategy";
import { barsPerYearFor } from "../src/lib/bot/bitget-trade";

const BASE = "https://api.bitget.com";
const SYMBOLS = ["LITUSDT", "BTCUSDT", "HYPEUSDT", "KIIUSDT", "ZECUSDT"];
const TFS: { tf: string; g: string }[] = [
  { tf: "15M", g: "15min" },
  { tf: "1H", g: "1h" },
  { tf: "4H", g: "4h" },
];

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget code ${body.code}: ${body.msg}`);
  return body.data;
}

const fmtAgo = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
};

async function main() {
  console.log(`=== cek 5 bot — ${new Date().toISOString().slice(0, 16)}Z — entry AGGRESSIVE ≥ 0.40 / MODERATE ≥ 0.55 ===\n`);
  for (const sym of SYMBOLS) {
    try {
      const tk = (await jget(`/api/v2/spot/market/tickers?symbol=${sym}`))[0];
      const price = Number(tk.lastPr);
      const chg = (Number(tk.change24h) * 100).toFixed(2);
      let line = `${sym.padEnd(9)} $${price < 1 ? price.toPrecision(4) : price.toFixed(price >= 100 ? 2 : 3).padStart(9)}  24h ${Number(chg) >= 0 ? "+" : ""}${chg.padStart(6)}%  |`;
      let verdict = "semua < 0.40 → belum terpicu = BENAR utk mode apa pun";
      let flagged = false;
      for (const { tf, g } of TFS) {
        try {
          const rows = await jget(`/api/v2/spot/market/candles?symbol=${sym}&granularity=${g}&limit=160`);
          const closes = rows.map((r: any[]) => Number(r[4])).filter((v: number) => v > 0);
          if (closes.length < 40) {
            line += ` ${tf}: data pendek (${closes.length} bar — listing baru?) |`;
            flagged = true;
            continue;
          }
          const sig = computeBotSignal(closes, barsPerYearFor(tf));
          const mark = sig.score >= 0.55 ? "▲" : sig.score >= 0.4 ? "△" : "·";
          line += ` ${tf} ${sig.score.toFixed(2)}${mark} |`;
          if (sig.score >= 0.4) flagged = true;
        } catch (e) {
          line += ` ${tf}: ERR |`;
        }
      }
      console.log(line);
      console.log(`${"".padEnd(9)}  → ${flagged ? "⚠️ ada score ≥ 0.40 — perlu tahu mode/TF bot utk memastikan" : verdict}\n`);
    } catch (e) {
      console.log(`${sym.padEnd(9)} — GAGAL: ${(e as Error).message}\n`);
    }
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
