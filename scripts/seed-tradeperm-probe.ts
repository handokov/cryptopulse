/** Seed a browser-probe user: bitget connection + LIVE bot (BTCUSDT). */
const { createClient } = await import("@libsql/client");
const { encryptSecret } = await import("../src/lib/secure.ts");

const db = createClient({ url: "file:db/custom.db" });
const email = process.argv[2] ?? "probe-tradeperm@test.local";
const password = "secret123";

/* register via API so the app's hashing is used */
const reg = await fetch("http://localhost:3000/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, name: "Probe" }),
});
console.log("register:", reg.status);
if (reg.status === 409) console.log("(user already exists — reusing)");

const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;

const connId = `probe-conn-${Date.now()}`;
await db.execute({
  sql: `INSERT INTO ExchangeConnection (id, userId, exchange, label, apiKeyEnc, apiSecretEnc, apiPassphraseEnc, apiKeyMasked, apiKeyHash, status, tradePermission, createdAt, updatedAt)
        VALUES (?, ?, 'bitget', 'main', ?, ?, ?, 'faked••••1234', 'probehash', 'active', 'granted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [connId, uid, encryptSecret("probe-key"), encryptSecret("probe-secret"), encryptSecret("probe-pass")],
});
console.log("connection seeded:", connId);

const cfgId = `probe-live-${Date.now()}`;
await db.execute({
  sql: `INSERT INTO BotConfig (id, userId, mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt, paperCapitalUsdt, entryOffsetPct, timeframe, exitStyle, createdAt, updatedAt)
        VALUES (?, ?, 'AGGRESSIVE', 'BTCUSDT', 0, 0, 5, 4, 20, 20, 0.3, '15M', 'FIXED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [cfgId, uid],
});
console.log("live bot seeded:", cfgId);
console.log("EMAIL:", email);
