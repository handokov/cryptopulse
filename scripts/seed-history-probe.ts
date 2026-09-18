/** Seed a browser-probe user with a PAPER bot + 3 CLOSED positions
    (varied durations & exit reasons) so the Riwayat Trade table renders. */
const { createClient } = await import("@libsql/client");

const db = createClient({ url: "file:db/custom.db" });
const email = process.argv[2] ?? "probe-history@test.local";
const password = "secret123";

const reg = await fetch("http://localhost:3000/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, name: "ProbeHist" }),
});
console.log("register:", reg.status);
if (reg.status === 409) console.log("(user already exists — reusing)");

const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgId = `probe-hist-${Date.now()}`;
await db.execute({
  sql: `INSERT INTO BotConfig (id, userId, mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt, paperCapitalUsdt, entryOffsetPct, timeframe, exitStyle, createdAt, updatedAt)
        VALUES (?, ?, 'AGGRESSIVE', 'BTCUSDT', 1, 0, 5, 4, 20, 20, 0.3, '15M', 'FIXED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [cfgId, uid],
});
console.log("paper bot seeded:", cfgId);

const now = Date.now();
const H = 3600_000, M = 60_000;
const rows = [
  // [id, opened, closed, entry, exit, pnl, reason] — newest first in UI
  [`hist-a-${now}`, now - 3 * H - 20 * M, now - 40 * M, 77000, 78540, 1.002, "take-profit crossed (+2.0%)"],   // 160m win
  [`hist-b-${now}`, now - 8 * H, now - 4 * H - 40 * M, 76500, 77650, 0.748, "trail-stop armed at +1σ"],        // 200m win
  [`hist-c-${now}`, now - 26 * H, now - 25 * H - 45 * M, 78000, 76830, -0.585, "stop-loss crossed (-1.5%)"],   // 75m loss
];
for (const [id, opened, closed, entry, exit, pnl, reason] of rows) {
  await db.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, exitPrice, realizedPnlUsdt, exitReason, openedAt, closedAt)
          VALUES (?, ?, ?, 'BTCUSDT', 'LONG', ?, 0.065, 5.0, 1, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`,
    args: [id, uid, cfgId, entry, entry * 0.985, entry * 1.02, exit, pnl, reason, opened, closed],
  });
}
console.log("3 closed positions seeded");
console.log("EMAIL:", email);
