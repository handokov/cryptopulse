/**
 * Seed a browser-probe user: 1 paper bot (BTCUSDT, capital 20) with
 * realized +0.50/−0.20 closed positions + 1 open position near the live
 * price so the wallet card shows a realistic unrealized P/L.
 * Prints the credentials. NOT cleaned up here — delete at the end of the task.
 */
const BASE = "http://localhost:3000";
let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const email = "probe-wallet@test.local";
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "Probe" });
console.log("register:", reg.status, "(409 = already exists, fine)");
const r = await call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false,
  orderSizeUsdt: 5, paperCapitalUsdt: 20, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
console.log("create bot:", r.status, "capital:", r.json?.config?.paperCapitalUsdt);

const { createClient } = await import("@libsql/client");
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgId = (await db.execute({ sql: "SELECT id FROM BotConfig WHERE userId = ?", args: [uid] })).rows[0].id;
// live BTC price as entry anchor
const tick = await fetch("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) }).then((x) => x.json());
const live = Number(tick?.data?.[0]?.lastPr) || 77000;
const now = Date.now();
async function seedPos(status, pnl, entry, size) {
  await db.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, exitPrice, realizedPnlUsdt, exitReason, openedAt, closedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [`pr${Math.random().toString(36).slice(2, 12)}`, uid, cfgId, "BTCUSDT", "LONG",
      entry, size / entry, size, true, entry * 0.985, entry * 1.02, status,
      status === "CLOSED" ? entry + pnl / (size / entry) : null,
      status === "CLOSED" ? pnl : null,
      status === "CLOSED" ? "take-profit" : null,
      now - 7200e3, status === "CLOSED" ? now - 3600e3 : null],
  });
}
await seedPos("CLOSED", 0.50, live * 0.99, 5);
await seedPos("CLOSED", -0.20, live * 0.995, 5);
await seedPos("OPEN", null, live * 0.998, 5); // slightly under live → small positive unrealized
console.log("seeded: realized +0.30, open 5 @", (live * 0.998).toFixed(1), "live", live.toFixed(1));
console.log("LOGIN:", email, "/ secret123");
