/**
 * Task 23 verification: VOL exit style (volatility-scaled bands + trailing).
 *
 * 1. volBands math — exact scaling + clamps (MODERATE & AGGRESSIVE).
 * 2. shouldExit honors effStopPrice (trail) without breaking TP priority.
 * 3. Engine integration on real Bitget data (BTCUSDT, paper):
 *    T1 forced BUY with exitStyle=VOL → bands match volBands(σ from signal)
 *    T2 highestPrice initialized to entry
 *    T3 armed trail below trigger → HOLD, highestPrice persisted
 *    T4 armed trail above trigger → SELL "trail-stop" with positive PnL
 *    T5 user TP override beats VOL band
 * 4. Cascade cleanup.
 *
 * Run: bun scripts/verify-bot-exits.ts
 */
import { db } from "../src/lib/db";
import { runBotTicks } from "../src/lib/bot/engine";
import { computeBotSignal, MODE_PRESETS, shouldExit, volBands, SIGMA_REF_PCT, type BotSignal } from "../src/lib/bot/strategy";
import { fetchCloses, fetchTickerPrice, BARS_PER_YEAR } from "../src/lib/bot/bitget-trade";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1. volBands math ---------- */
console.log("--- volBands math ---");
const vbLIT = volBands(2.94, "MODERATE");
assert(near(vbLIT.slPct, 1.2 * (2.94 / SIGMA_REF_PCT)) && near(vbLIT.tpPct, 1.8 * (2.94 / SIGMA_REF_PCT)),
  `MODERATE σ=2.94 → SL ${vbLIT.slPct.toFixed(3)}% / TP ${vbLIT.tpPct.toFixed(3)}% (want 2.352 / 3.528)`);
assert(near(vbLIT.trailArmPct, 2.94) && near(vbLIT.trailPct, vbLIT.slPct), "trail arm = σ, trail dist = SL band");
const vbCalm = volBands(0.5, "MODERATE");
assert(vbCalm.slPct === 1.0 && vbCalm.tpPct === 1.5, `calm asset clamps: SL ${vbCalm.slPct} / TP ${vbCalm.tpPct} (want 1 / 1.5)`);
const vbWild = volBands(50, "MODERATE");
assert(vbWild.slPct === 12.0 && vbWild.tpPct === 18.0, `wild asset clamps: SL ${vbWild.slPct} / TP ${vbWild.tpPct} (want 12 / 18)`);
const vbAggr = volBands(2.94, "AGGRESSIVE");
assert(near(vbAggr.slPct, 1.8 * (2.94 / SIGMA_REF_PCT)) && near(vbAggr.tpPct, 2.6 * (2.94 / SIGMA_REF_PCT)),
  `AGGRESSIVE σ=2.94 → SL ${vbAggr.slPct.toFixed(3)}% / TP ${vbAggr.tpPct.toFixed(3)}%`);

/* ---------- 2. shouldExit effStopPrice ---------- */
console.log("--- shouldExit effStopPrice ---");
const dummy = { score: 0.6 } as BotSignal;
const r1 = shouldExit(dummy, 100, 99.5, 101.8, 98.8, "MODERATE"); // above effStop
assert(r1.exit === null, `price above effStop → hold (got ${r1.exit})`);
const r2 = shouldExit(dummy, 100, 99.3, 101.8, 98.8, "MODERATE", 99.4); // below effStop, above fixed
assert(r2.exit === "stop-loss", `price below trail → stop (got ${r2.exit})`);
const r3 = shouldExit(dummy, 100, 101.9, 101.8, 98.8, "MODERATE", 99.4);
assert(r3.exit === "take-profit", `TP still wins over trail (got ${r3.exit})`);

/* ---------- 3. engine integration (real data) ---------- */
console.log("--- engine integration (BTCUSDT paper) ---");
const stamp = Date.now();
const user = await db.user.create({
  data: { email: `volexit-${stamp}@verify.local`, name: "VOL Exit Verifier", passwordHash: "x".repeat(64) },
});

try {
  const config = await db.botConfig.create({
    data: { userId: user.id, mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 1.5, exitStyle: "VOL" },
  });

  MODE_PRESETS.MODERATE.entryScore = -2;
  let res = await runBotTicks({ userId: user.id, force: true });
  assert(res[0]?.action === "BUY", `T1 forced BUY (got ${res[0]?.action}: ${res[0]?.reason})`);
  assert((res[0]?.reason ?? "").includes("[VOL σ"), "T1 entry reason carries VOL band audit note");

  let pos = await db.botPosition.findFirst({ where: { configId: config.id, status: "OPEN" } });
  assert(!!pos, "T1 position OPEN");
  if (pos) {
    const { closes } = await fetchCloses("BTCUSDT", 160);
    const sig = computeBotSignal(closes);
    const sigma = sig.volAnnPct / Math.sqrt(BARS_PER_YEAR);
    const exp = volBands(sigma, "MODERATE");
    const tpPct = (pos.targetPrice / pos.entryPrice - 1) * 100;
    const slPct = (1 - pos.stopPrice / pos.entryPrice) * 100;
    assert(near(tpPct, exp.tpPct, 1e-6), `T1 VOL TP band: +${tpPct.toFixed(3)}% (want ${exp.tpPct.toFixed(3)}%)`);
    assert(near(slPct, exp.slPct, 1e-6), `T1 VOL SL band: −${slPct.toFixed(3)}% (want ${exp.slPct.toFixed(3)}%)`);
    assert(near(pos.highestPrice ?? 0, pos.entryPrice, 1e-9), "T2 highestPrice initialized to entry");

    /* Seed a REAL profit cushion: entry 10 % below market, target far above,
       stop far below. Trailing now trades off genuine unrealized profit —
       exactly how a live position behaves mid-rally. */
    const px0 = await fetchTickerPrice("BTCUSDT");
    await db.botPosition.update({
      where: { id: pos.id },
      data: {
        entryPrice: px0 * 0.9,
        stopPrice: px0 * 0.45,
        targetPrice: px0 * 1.05,
        highestPrice: px0 * 1.001,
        qty: 1.5 / (px0 * 0.9),
      },
    });
    const entry = px0 * 0.9;

    /* T3: trail armed but below trigger → HOLD + highestPrice persisted */
    const px3 = await fetchTickerPrice("BTCUSDT");
    await db.botPosition.update({ where: { id: pos.id }, data: { highestPrice: px3 * 1.001 } });
    res = await runBotTicks({ userId: user.id, force: true });
    assert(res[0]?.action === "HOLD", `T3 armed-but-safe trail holds (got ${res[0]?.action}: ${res[0]?.reason})`);
    const pos3 = await db.botPosition.findUnique({ where: { id: pos.id } });
    assert(!!pos3 && pos3.status === "OPEN", "T3 position still OPEN");
    assert(!!pos3 && pos3.highestPrice! >= px3 * 1.001 - 1e-6, `T3 highestPrice persisted (${pos3?.highestPrice?.toFixed(2)})`);

    /* T4: peak pushed above the trail trigger → SELL trail-stop at market,
       locking ~+11 % of the real cushion */
    const px4 = await fetchTickerPrice("BTCUSDT");
    await db.botPosition.update({ where: { id: pos.id }, data: { highestPrice: px4 * 1.011 } });
    res = await runBotTicks({ userId: user.id, force: true });
    assert(res[0]?.action === "SELL", `T4 trail exit fires (got ${res[0]?.action}: ${res[0]?.reason})`);
    assert((res[0]?.reason ?? "").startsWith("trail-stop"), `T4 reason is trail-stop (${res[0]?.reason.slice(0, 60)})`);
    assert((res[0]?.pnlUsdt ?? 0) > 0, `T4 trail locks profit (pnl ${res[0]?.pnlUsdt?.toFixed(3)} $)`);
    const pos4 = await db.botPosition.findUnique({ where: { id: pos.id } });
    assert(pos4?.status === "CLOSED" && (pos4.exitReason ?? "").startsWith("trail-stop"), "T4 position CLOSED as trail-stop");
    assert(!!pos4 && pos4.realizedPnlUsdt! > 0, "T4 realized PnL positive");

    /* T5: user TP override beats VOL band — backdate the close so the
       45-min cooldown gate passes */
    await db.botPosition.update({ where: { id: pos.id }, data: { closedAt: new Date(Date.now() - 2 * 3600_000) } });
    await db.botConfig.update({ where: { id: config.id }, data: { takeProfitPct: 3.0 } });
    res = await runBotTicks({ userId: user.id, force: true });
    assert(res[0]?.action === "BUY", `T5 forced BUY with override (got ${res[0]?.action})`);
    const pos5 = await db.botPosition.findFirst({ where: { configId: config.id, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    if (pos5) {
      const tp = (pos5.targetPrice / pos5.entryPrice - 1) * 100;
      assert(near(tp, 3.0, 1e-6), `T5 user override TP +${tp.toFixed(2)}% wins over VOL (want 3.00%)`);
    }
  }
  MODE_PRESETS.MODERATE.entryScore = 0.55;
} finally {
  MODE_PRESETS.MODERATE.entryScore = 0.55;
  await db.user.delete({ where: { id: user.id } });
  const left = await db.botTrade.count({ where: { userId: user.id } });
  assert(left === 0, "cascade cleanup left 0 rows");
}

console.log(failures === 0 ? "\nALL VOL EXIT CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
