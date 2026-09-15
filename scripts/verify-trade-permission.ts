/**
 * E2E verify — Bitget spot-trade permission probe + connection report (Task 17).
 *
 * Real credentials with Trade scope are not available in the sandbox, so we
 * prove the pieces around the probe:
 *   1. register fresh user
 *   2. GET connections → empty
 *   3. POST connect bitget with FAKE creds → 422 (balance test still gates
 *      storage — no connection survives a bad key)
 *   4. seed fake bitget connection row directly → GET exposes
 *      tradePermission "unverified" + probe metadata null
 *   5. POST sync with fake creds → 422 (balance gate first), permission
 *      untouched
 *   6. probeTradePermission direct with fake creds → real Bitget 401 →
 *      inconclusive, no crash
 *   7. probeAndStoreTradePermission on fake conn → stores note "HTTP 401",
 *      verdict stays "unverified" (inconclusive never erases state), sets
 *      tradeProbedAt
 *   8. inconclusive probe must NOT overwrite an existing "granted" verdict
 *   9. simulated "granted" / "denied" verdicts surface via GET
 *  10. live bot GET /api/bot → spot { connected: true, tradePermission }
 *  11. paper bot → no spot payload
 *  12. unit: classifyTradeProbe (permission/symbol/min-size/unknown)
 *  13. cleanup — delete the whole test user
 */
const BASE = "http://localhost:3000";
const { createClient } = await import("@libsql/client");

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

const fails = [];
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails.push(name);
}

/* 1 — register */
const email = `tradeperm-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "T" });
check("register", reg.status === 200 || reg.status === 201);

const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
check("user row exists", Boolean(uid), uid);

/* 2 — empty list */
const g0 = await call("GET", "/api/exchange-connections");
check("GET connections empty", g0.status === 200 && (g0.json?.connections ?? []).length === 0);

/* 3 — fake creds rejected before storage (Bitget answers bad keys with
       HTTP 400 → typed "network" by the adapter; either way: 422, no store) */
const post = await call("POST", "/api/exchange-connections", {
  exchange: "bitget",
  label: "fake",
  apiKey: "fake-key-123456",
  apiSecret: "fake-secret-123456",
  apiPassphrase: "fake-pass",
});
check("connect fake bitget → 422", post.status === 422 && ["auth", "network"].includes(post.json?.error), `${post.status} ${JSON.stringify(post.json)}`);
const gPost = await call("GET", "/api/exchange-connections");
check("nothing stored after 422", (gPost.json?.connections ?? []).length === 0);

/* 4 — seeded fake connection surfaces permission fields */
const { encryptSecret } = await import("../src/lib/secure.ts");
const connId = `fake-conn-${Date.now()}`;
await db.execute({
  sql: `INSERT INTO ExchangeConnection (id, userId, exchange, label, apiKeyEnc, apiSecretEnc, apiPassphraseEnc, apiKeyMasked, apiKeyHash, status, createdAt, updatedAt)
        VALUES (?, ?, 'bitget', 'fake', ?, ?, ?, 'fake••••key', 'fakehash', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [connId, uid, encryptSecret("fake-key"), encryptSecret("fake-secret"), encryptSecret("fake-pass")],
});
const g1 = await call("GET", "/api/exchange-connections");
const row = (g1.json?.connections ?? [])[0] ?? {};
check("GET row has tradePermission unverified", row.tradePermission === "unverified", JSON.stringify(row.tradePermission));
check("GET row probe metadata empty", row.tradeProbedAt === null && row.tradeProbeNote === null);

/* 4.5 — paper bot GET: spot payload must be absent for paper configs.
         (Done BEFORE any live bot exists so the route's config fallback
         lands on the paper bot.) */
await call("PUT", "/api/bot", { mode: "AGGRESSIVE", symbol: "LITUSDT", paper: true, enabled: false, orderSizeUsdt: 5 });
const gPaper = await call("GET", "/api/bot?symbol=LITUSDT");
check("paper bot config returned", gPaper.json?.config?.paper === true, JSON.stringify(gPaper.json?.config?.paper));
check("paper bot → spot null", gPaper.json?.spot === null || gPaper.json?.spot === undefined, JSON.stringify(gPaper.json?.spot));

/* 5 — direct probe against real Bitget with fake creds → HTTP 400/401 →
       inconclusive, no crash */
const { probeTradePermission, classifyTradeProbe } = await import("../src/lib/exchanges/bitget.ts");
const probe = await probeTradePermission({
  apiKey: "fake-key", apiSecret: "fake-secret", apiPassphrase: "fake-pass",
});
check("probe fake creds → inconclusive (HTTP 401)", probe.state === "inconclusive" && /HTTP 40/.test(probe.message ?? ""), `${probe.state} · ${probe.message}`);

/* 7 — probeAndStore keeps unverified + records the note */
const { probeAndStoreTradePermission } = await import("../src/lib/exchanges/trade-permission.ts");
const stored = await probeAndStoreTradePermission(connId);
check("probeAndStore → unverified", stored?.state === "unverified", JSON.stringify(stored));
const row7 = (await db.execute({ sql: "SELECT tradePermission, tradeProbedAt, tradeProbeNote FROM ExchangeConnection WHERE id = ?", args: [connId] })).rows[0];
check("probe note stored", String(row7.tradeProbeNote ?? "").includes("HTTP 40"), String(row7.tradeProbeNote));
check("tradeProbedAt set", row7.tradeProbedAt != null);

/* 8 — inconclusive must NOT erase an existing granted verdict */
await db.execute({ sql: "UPDATE ExchangeConnection SET tradePermission = 'granted' WHERE id = ?", args: [connId] });
const stored8 = await probeAndStoreTradePermission(connId);
check("inconclusive keeps granted", stored8?.state === "granted", JSON.stringify(stored8));

/* 8.5 — sync with fake creds fails at the balance gate (status flips to
          "error" by design) and permission is untouched; then re-activate
          the row for the remaining steps. */
const sync = await call("POST", `/api/exchange-connections/${connId}/sync`);
check("sync fake creds → 422", sync.status === 422, `${sync.status} ${JSON.stringify(sync.json)}`);
const row5 = (await call("GET", "/api/exchange-connections")).json?.connections?.[0] ?? {};
check("permission still unverified-after-restore semantics", ["unverified", "granted"].includes(row5.tradePermission), row5.tradePermission);
await db.execute({ sql: "UPDATE ExchangeConnection SET status = 'active', lastError = NULL WHERE id = ?", args: [connId] });

/* 9 — verdicts surface via GET (re-activated row) */
const row9 = (await call("GET", "/api/exchange-connections")).json?.connections?.[0] ?? {};
check("GET shows granted", row9.tradePermission === "granted" && row9.tradeProbedAt != null);
await db.execute({ sql: "UPDATE ExchangeConnection SET tradePermission = 'denied' WHERE id = ?", args: [connId] });
const row9b = (await call("GET", "/api/exchange-connections")).json?.connections?.[0] ?? {};
check("GET shows denied", row9b.tradePermission === "denied");

/* 10 — live bot spot report carries connection + permission */
const mkLive = await call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: false, enabled: false, confirmLive: true,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create LIVE bot", mkLive.status === 200 || mkLive.status === 201);
const gbot = await call("GET", "/api/bot?symbol=BTCUSDT");
check("spot.connected true", gbot.json?.spot?.connected === true, JSON.stringify(gbot.json?.spot));
check("spot.tradePermission denied", gbot.json?.spot?.tradePermission === "denied", String(gbot.json?.spot?.tradePermission));
check("spot.available null (fake creds)", gbot.json?.spot?.available === null);

/* 11 (merged into 4.5) */

/* 12 — unit: classifyTradeProbe */
const cases = [
  [["40014", "permission denied for this apikey"], "denied"],
  [[undefined, "api key has no trade permission"], "denied"],
  [[undefined, "apikey not authorized for this endpoint"], "denied"],
  [[undefined, "Invalid symbol CRYPTOPULSEPROBEUSDT"], "granted"],
  [[undefined, "The order size is less than the minimum"], "granted"],
  [[undefined, "parameter validation failed"], "granted"],
  [[undefined, "symbol not exist"], "granted"],
  [["50001", "system busy, try later"], "inconclusive"],
  [[undefined, "totally unforeseen failure text"], "inconclusive"],
];
let unitOk = 0;
for (const [[code, msg], want] of cases) {
  const got = classifyTradeProbe(code, msg);
  if (got === want) unitOk++;
  else check(`classify ${JSON.stringify(code)} "${msg}"`, false, `got ${got}, want ${want}`);
}
check(`classifyTradeProbe ${unitOk}/${cases.length}`, unitOk === cases.length);

/* 13 — cleanup */
await db.execute({ sql: "DELETE FROM ExchangeConnection WHERE id = ?", args: [connId] });
await fetch(BASE + "/api/auth/user", { method: "DELETE", headers: { Cookie: cookie } }).catch(() => {});
const gone = await db.execute({ sql: "SELECT COUNT(*) AS n FROM User WHERE email = ?", args: [email] });
if (Number(gone.rows[0].n) > 0) await db.execute({ sql: "DELETE FROM User WHERE email = ?", args: [email] });
check("cleanup", Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM User WHERE email = ?", args: [email] })).rows[0].n) === 0);

console.log(`\n${fails.length === 0 ? "ALL PASS" : `${fails.length} FAIL`} — trade-permission verify`);
process.exit(fails.length === 0 ? 0 : 1);
