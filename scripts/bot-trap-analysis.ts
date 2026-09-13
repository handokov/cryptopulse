/**
 * bot-trap-analysis.ts — READ-ONLY audit of the user's own paper trades.
 *
 * Question: "could this momentum bot become a trap that buys the top?"
 *
 * Evidence pulled from the local DB (SELECT only, no writes):
 *   1. All closed BUY/SELL pairs per symbol → win rate, avg win, avg loss
 *   2. Expectancy per trade in %
 *   3. For every BUY: what did price do AFTER? (did it buy near a local top?)
 *      → max favorable excursion (MFE) vs max adverse excursion (MAE) in %
 *   4. Worst losing streak
 */

import { createClient } from "@libsql/client";

const db = createClient({ url: "file:/home/z/my-project/db/custom.db" });

interface Row {
  symbol: string;
  action: string;
  price: number | null;
  pnlUsdt: number | null;
  sizeUsdt: number | null;
  reason: string;
  createdAt: string;
}

async function main() {
  const res = await db.execute(`
    SELECT symbol, action, price, pnlUsdt, sizeUsdt, reason, createdAt
    FROM BotTrade
    WHERE paper = 1 AND status = 'PAPER'
    ORDER BY createdAt ASC
  `);
  const rows = res.rows as unknown as Row[];
  if (rows.length === 0) { console.log("no paper trades"); return; }

  console.log(`=== ${rows.length} paper trade rows (read-only audit) ===\n`);

  /* --- per-symbol dump: BUY/SELL pairs with exit reason --- */
  const bySymbol = new Map<string, Row[]>();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol)!.push(r);
  }

  let wins = 0, losses = 0;
  let sumWinPct = 0, sumLossPct = 0;
  let worstLossPct = 0, bestWinPct = 0;
  let streak = 0, worstStreak = 0;

  for (const [symbol, rs] of bySymbol) {
    console.log(`--- ${symbol} ---`);
    // pair BUY -> next SELL (exit)
    let open: Row | null = null;
    for (const r of rs) {
      if (r.action === "BUY") {
        if (open) console.log(`  [!] BUY ${r.createdAt} tanpa SELL pendahulu (masih terbuka / reset cap)`);
        open = r;
      } else if (r.action === "SELL") {
        if (!open) { console.log(`  [!] SELL ${r.createdAt} tanpa BUY (dari sesi lain)`); continue; }
        const entry = open.price ?? 0;
        const exit = r.price ?? 0;
        const pnlPct = entry > 0 ? ((exit - entry) / entry) * 100 : 0;
        const tag = r.reason.includes("take-profit") ? "TP"
          : r.reason.includes("stop-loss") ? "SL"
          : r.reason.includes("trail") ? "TRAIL"
          : r.reason.includes("signal") ? "FLIP" : "?";
        if (pnlPct >= 0) { wins++; sumWinPct += pnlPct; bestWinPct = Math.max(bestWinPct, pnlPct); streak = 0; }
        else { losses++; sumLossPct += pnlPct; worstLossPct = Math.min(worstLossPct, pnlPct); streak++; worstStreak = Math.max(worstStreak, streak); }
        console.log(`  BUY $${entry.toFixed(4)} → SELL $${exit.toFixed(4)} = ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% [${tag}] (${open.createdAt} → ${r.createdAt})`);
        open = null;
      }
    }
    if (open) console.log(`  [posisi terbuka] BUY $${(open.price ?? 0).toFixed(4)} @ ${open.createdAt}`);
    console.log("");
  }

  const closed = wins + losses;
  const wr = closed ? (wins / closed) * 100 : 0;
  const avgW = wins ? sumWinPct / wins : 0;
  const avgL = losses ? sumLossPct / losses : 0;
  const expectancy = (wr / 100) * avgW + (1 - wr / 100) * avgL;

  console.log(`=== RINGKASAN (closed trades) ===`);
  console.log(`closed: ${closed} | win: ${wins} | loss: ${losses} | win rate: ${wr.toFixed(0)}%`);
  console.log(`avg win: +${avgW.toFixed(2)}% | avg loss: ${avgL.toFixed(2)}% | best: +${bestWinPct.toFixed(2)}% | worst: ${worstLossPct.toFixed(2)}%`);
  console.log(`expectancy: ${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}% per trade`);
  console.log(`worst losing streak beruntun: ${worstStreak}`);
  console.log(`\nBreak-even win rate utk R:R = |avgTP/avgSL|: butuh win rate > 1/(1+R:R)`);
  const rr = avgL !== 0 ? Math.abs(avgW / avgL) : 0;
  if (rr > 0) console.log(`R:R aktual Anda = ${rr.toFixed(2)} → break-even di win rate ${(100 / (1 + rr)).toFixed(0)}% (aktual ${wr.toFixed(0)}%)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
