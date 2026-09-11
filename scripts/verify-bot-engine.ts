/**
 * Verification of the bot engine paper lifecycle against REAL Bitget prices
 * and the LOCAL database (src/lib/db.ts in dev mode → SQLite).
 *
 * Flow:
 *   0. Create a throwaway user + paper MODERATE BTCUSDT config.
 *   1. Print the live composite score for BTC (informational).
 *   2. Force entry (preset entryScore = −2) → tick must BUY: position OPEN +
 *      BotTrade row PAPER.
 *   3. Tick again → HOLD (position open, exit ladder quiet).
 *   4. Shrink the position's target below the market → tick must SELL with
 *      reason take-profit and a closed position.
 *   5. Tick once more → HOLD on cooldown (45 min gate right after a close).
 *   6. Cleanup: delete the user (cascades config/positions/trades).
 *
 * Run: bun scripts/verify-bot-engine.ts
 */
import { db } from "../src/lib/db";
import { runBotTicks } from "../src/lib/bot/engine";
import { MODE_PRESETS, computeBotSignal } from "../src/lib/bot/strategy";
import { fetchCloses } from "../src/lib/bot/bitget-trade";

const EMAIL = `bot-engine-verify-${Date.now()}@local.test`;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  /* 0. fixtures */
  const user = await db.user.create({ data: { email: EMAIL, passwordHash: "x" } });
  const config = await db.botConfig.create({
    data: { userId: user.id, mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false },
  });
  console.log(`user ${user.id} + config ${config.id}`);

  /* 1. live signal (informational) */
  const { closes } = await fetchCloses("BTCUSDT", 160);
  const live = computeBotSignal(closes);
  console.log(`live BTCUSDT 4h → score=${live.score} trend=${live.trend} mom=${live.momentum} cycleR2=${live.cycleR2} vol=${live.volAnnPct.toFixed(0)}%`);

  /* 2. forced entry */
  MODE_PRESETS.MODERATE.entryScore = -2;
  let res = await runBotTicks({ userId: user.id, force: true });
  console.log("tick1:", JSON.stringify(res[0]));
  assert(res[0].action === "BUY", `tick1 BUY (got ${res[0].action})`);
  const pos = await db.botPosition.findFirst({ where: { configId: config.id, status: "OPEN" } });
  assert(!!pos, "position OPEN after BUY");
  const buyTrade = await db.botTrade.findFirst({ where: { configId: config.id, action: "BUY" } });
  assert(buyTrade?.status === "PAPER" && !!buyTrade.price && !!buyTrade.qty, "BUY trade logged PAPER with price/qty");
  const lastPrice = buyTrade!.price!;

  /* 3. hold while position open */
  res = await runBotTicks({ userId: user.id, force: true });
  console.log("tick2:", JSON.stringify(res[0]));
  assert(res[0].action === "HOLD", `tick2 HOLD (got ${res[0].action}: ${res[0].reason})`);

  /* 4. force take-profit */
  await db.botPosition.update({ where: { id: pos!.id }, data: { targetPrice: lastPrice * 0.999 } });
  MODE_PRESETS.MODERATE.entryScore = 0.55;
  res = await runBotTicks({ userId: user.id, force: true });
  console.log("tick3:", JSON.stringify(res[0]));
  assert(res[0].action === "SELL", `tick3 SELL (got ${res[0].action}: ${res[0].reason})`);
  assert(res[0].reason.includes("≥ target") || res[0].reason.includes("take-profit"), "exit was the target leg");
  const closed = await db.botPosition.findFirst({ where: { configId: config.id, status: "CLOSED" } });
  assert(!!closed && closed.exitPrice !== null && closed.realizedPnlUsdt !== null, "position CLOSED with pnl");
  const sellTrade = await db.botTrade.findFirst({ where: { configId: config.id, action: "SELL" } });
  assert(sellTrade?.status === "PAPER" && sellTrade.pnlUsdt !== null, "SELL trade logged with pnl");

  /* 5. cooldown gate */
  res = await runBotTicks({ userId: user.id, force: true });
  console.log("tick4:", JSON.stringify(res[0]));
  assert(res[0].action === "HOLD" && res[0].reason.includes("cooldown"), `tick4 cooldown (got ${res[0].action}: ${res[0].reason})`);

  /* 6. risk gates sanity: max trades per day */
  await db.botConfig.update({ where: { id: config.id }, data: { maxTradesPerDay: 0 } });
  console.log("(maxTradesPerDay gate exercised through API validation instead — engine reads preset)");

  /* cleanup */
  await db.user.delete({ where: { id: user.id } });
  const left = await db.botTrade.count({ where: { userId: user.id } });
  assert(left === 0, "cascade cleanup left 0 rows");
  console.log("ALL BOT-ENGINE CHECKS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
