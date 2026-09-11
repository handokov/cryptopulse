/**
 * Task 21 targeted verification: USER TP/SL overrides on BotConfig.
 *
 * 1. Create temp user + paper config with takeProfitPct=3.0, stopLossPct=0.8.
 * 2. Force entry (entryScore=-2) → BUY → the OPEN position's target/stop
 *    must derive from the USER override, not the MODERATE preset (1.8/1.2).
 * 3. Null the overrides → force entry again → position must use presets.
 * 4. Cleanup (cascade).
 *
 * Run: bun scripts/verify-bot-tpsl.ts
 */
import { db } from "../src/lib/db";
import { runBotTicks } from "../src/lib/bot/engine";
import { MODE_PRESETS } from "../src/lib/bot/strategy";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

const stamp = Date.now();
const user = await db.user.create({
  data: { email: `tpsl-${stamp}@verify.local`, name: "TP/SL Verifier", passwordHash: "x".repeat(64) },
});

try {
  const config = await db.botConfig.create({
    data: {
      userId: user.id,
      mode: "MODERATE",
      symbol: "BTCUSDT",
      paper: true,
      enabled: false,
      orderSizeUsdt: 1.5,
      takeProfitPct: 3.0,
      stopLossPct: 0.8,
    },
  });

  /* 1. forced entry WITH overrides */
  MODE_PRESETS.MODERATE.entryScore = -2;
  let res = await runBotTicks({ userId: user.id, force: true });
  assert(res[0]?.action === "BUY", `forced BUY with overrides (got ${res[0]?.action})`);
  let pos = await db.botPosition.findFirst({ where: { configId: config.id, status: "OPEN" } });
  assert(!!pos, "position OPEN");
  if (pos) {
    const tp = (pos.targetPrice / pos.entryPrice - 1) * 100;
    const sl = (1 - pos.stopPrice / pos.entryPrice) * 100;
    assert(Math.abs(tp - 3.0) < 1e-6, `override TP applied: target = +${tp.toFixed(2)}% (want 3.00%)`);
    assert(Math.abs(sl - 0.8) < 1e-6, `override SL applied: stop = −${sl.toFixed(2)}% (want 0.80%)`);
  }

  /* 2. clear overrides → preset must take over */
  await db.botPosition.update({ where: { id: pos!.id }, data: { status: "CANCELED" } }); // move out of the way
  await db.botConfig.update({ where: { id: config.id }, data: { takeProfitPct: null, stopLossPct: null } });
  res = await runBotTicks({ userId: user.id, force: true });
  assert(res[0]?.action === "BUY", `forced BUY with null overrides (got ${res[0]?.action})`);
  const pos2 = await db.botPosition.findFirst({
    where: { configId: config.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
  if (pos2) {
    const tp = (pos2.targetPrice / pos2.entryPrice - 1) * 100;
    const sl = (1 - pos2.stopPrice / pos2.entryPrice) * 100;
    assert(Math.abs(tp - 1.8) < 1e-6, `preset TP fallback: target = +${tp.toFixed(2)}% (want 1.80%)`);
    assert(Math.abs(sl - 1.2) < 1e-6, `preset SL fallback: stop = −${sl.toFixed(2)}% (want 1.20%)`);
  }
  MODE_PRESETS.MODERATE.entryScore = 0.55;
} finally {
  await db.user.delete({ where: { id: user.id } });
  const left = await db.botTrade.count({ where: { userId: user.id } });
  assert(left === 0, "cascade cleanup left 0 rows");
}

console.log(failures === 0 ? "\nALL TP/SL OVERRIDE CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
