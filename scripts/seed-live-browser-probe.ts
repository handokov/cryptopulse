/**
 * Seed a browser-probe user with a LIVE bot (Bitget-real UI verification):
 *  - LIVE BTCUSDT bot (paper=false, disabled)
 *  - fake ExchangeConnection row so the live wallet shows a balance path
 *    (balance itself will read null — signed calls fail gracefully)
 *  - pending limit state WITH orderId → the amber LIVE pending row
 *  - one OPEN live position with tpslArmed=1 → the OCO badge
 * Credentials: probe-wallet@test.local / secret123 (creates if missing).
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
  mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: false, enabled: false, confirmLive: true,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
console.log("create LIVE bot:", r.status, "paper:", r.json?.config?.paper);

const { createClient } = await import("@libsql/client");
const { encryptSecret } = await import("../src/lib/secure.ts");
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgId = (await db.execute({ sql: "SELECT id FROM BotConfig WHERE userId = ? AND symbol = 'BTCUSDT'", args: [uid] })).rows[0].id;

// fake connection → signed calls 401 (graceful "unavailable" in the UI)
const conn = await db.execute({
  sql: `INSERT INTO ExchangeConnection (id, userId, exchange, label, apiKeyEnc, apiSecretEnc, apiPassphraseEnc, apiKeyMasked, apiKeyHash, status, createdAt, updatedAt)
        VALUES (?, ?, 'bitget', 'probe', ?, ?, ?, 'fake••••key', 'fakehash', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [`probe-conn-${Date.now()}`, uid, encryptSecret("fk"), encryptSecret("fs"), encryptSecret("fp")],
});
console.log("fake connection:", conn.rowCount !== undefined ? "ok" : conn);

// pending live limit with orderId (display-only; TTL ~3h away)
await db.execute({
  sql: "UPDATE BotConfig SET pendingEntryPrice = 76000, pendingEntrySize = 5, pendingEntryAt = ?, pendingEntryOrderId = '1888888888888888888' WHERE id = ?",
  args: [Date.now() - 2 * 60_000, cfgId],
});
// open LIVE position with OCO armed (display-only seed near live price)
const tick = await fetch("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) }).then((x) => x.json());
const live = Number(tick?.data?.[0]?.lastPr) || 77000;
await db.execute({
  sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, highestPrice, tpslArmed, status, openedAt)
        VALUES (?, ?, ?, 'BTCUSDT', 'LONG', ?, 0.0000644, 5, 0, ?, ?, ?, 1, 'OPEN', ?)`,
  args: [`probe-live-pos-${Date.now()}`, uid, cfgId, live, live * 0.985, live * 1.018, live, new Date().toISOString()],
});
console.log("seeded live position @", live, "with tpslArmed=1; pending 76000 / order 18888888");
process.exit(0);
