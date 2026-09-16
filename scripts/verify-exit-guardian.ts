/**
 * E2E verify — exit guardian (Task 20).
 *
 * Bug it locks down: a DISABLED bot (or a GitHub-cron blackout, measured
 * 2-7 h gaps on the free tier) used to strand OPEN positions — price crossed
 * TP by +3.9% and round-tripped with nobody watching. Engine now runs
 * "enabled OR has-open-position" for every guarded path, logs per-bot ERRORs
 * to the audit trail, and the page heartbeat (?mode=heartbeat) + dashboard
 * GET after() act as real-time guardians.
 *
 *  1. register fresh user
 *  2. create paper bot BTCUSDT DISABLED
 *  3. seed OPEN position with target = 0.5 × market (guaranteed TP cross)
 *  4. heartbeat tick → SELL take-profit, position CLOSED — even disabled
 *  5. immediate second heartbeat → SKIP (4-min tick guard)
 *  6. disabled bot WITHOUT position (ETHUSDT) → heartbeat excludes it
 *  7. enabled bot with a bogus symbol (ZZZZUSDT) → manual tick → outcome
 *     ERROR + BotTrade audit row action=ERROR (silent failures are over)
 *  8. cleanup — delete the whole test user
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
const email = `guard-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "T" });
check("register", reg.status === 200 || reg.status === 201);

const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
check("user row exists", Boolean(uid), uid);

/* 2 — create DISABLED paper bot */
const mk = await call("PUT", "/api/bot", {
  mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create disabled paper bot", mk.status === 200 || mk.status === 201, JSON.stringify(mk.json?.error ?? ""));
const cfgA = (await db.execute({
  sql: "SELECT id FROM BotConfig WHERE userId = ? AND symbol = 'BTCUSDT' LIMIT 1", args: [uid],
})).rows[0].id;

/* 3 — seed OPEN position: target = 0.5 × market → TP cross guaranteed */
const tk = await (await fetch("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT")).json();
const px = Number(tk?.data?.[0]?.lastPr);
check("market price fetched", px > 1000, String(px));
const now = Date.now();
await db.execute({
  sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, openedAt)
        VALUES (?, ?, ?, 'BTCUSDT', 'LONG', ?, ?, 5.0, 1, ?, ?, 'OPEN', ?)`,
  args: [`guard-open-${now}`, uid, cfgA, px, 5.0 / px, px * 0.1, px * 0.5, now],
});
check("seeded open position (target = 0.5 × market)", true);

/* 4 — heartbeat tick exits the position of a DISABLED bot */
const hb1 = await call("POST", "/api/bot/tick?mode=heartbeat");
check("heartbeat 200 + mode", hb1.status === 200 && hb1.json?.mode === "heartbeat", hb1.json?.mode);
const resA = (hb1.json?.results ?? []).find((r) => r.symbol === "BTCUSDT");
check("disabled bot exit ran", Boolean(resA), JSON.stringify(resA ?? {}));
check("outcome SELL", resA?.action === "SELL", resA?.action);
check("outcome reason TP", /target|take-profit/i.test(resA?.reason ?? ""), resA?.reason);
const posRow = (await db.execute({
  sql: "SELECT status, exitReason, exitPrice FROM BotPosition WHERE id = ?", args: [`guard-open-${now}`],
})).rows[0];
check("position CLOSED in DB", posRow?.status === "CLOSED", `${posRow?.status} · ${posRow?.exitReason}`);
check("DB exitReason records TP", /target|take-profit/i.test(String(posRow?.exitReason)), posRow?.exitReason);

/* 5 — 4-min tick guard: enabled bot ticks once, immediate re-tick SKIPs */
const mkD = await call("PUT", "/api/bot", {
  mode: "MODERATE", symbol: "SOLUSDT", paper: true, enabled: true,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create enabled SOLUSDT bot", mkD.status === 200 || mkD.status === 201, JSON.stringify(mkD.json?.error ?? ""));
const hb2a = await call("POST", "/api/bot/tick?mode=heartbeat");
const resD1 = (hb2a.json?.results ?? []).find((r) => r.symbol === "SOLUSDT");
check("first heartbeat runs the enabled bot", Boolean(resD1) && resD1.action !== "SKIP", JSON.stringify(resD1 ?? {}));
const hb2b = await call("POST", "/api/bot/tick?mode=heartbeat");
const resD2 = (hb2b.json?.results ?? []).find((r) => r.symbol === "SOLUSDT");
check("immediate second heartbeat guarded (SKIP)", resD2?.action === "SKIP" && /guard/.test(resD2?.reason ?? ""), JSON.stringify(resD2 ?? {}));

/* 6 — disabled bot WITHOUT position is excluded from guarded runs */
const mkB = await call("PUT", "/api/bot", {
  mode: "MODERATE", symbol: "ETHUSDT", paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create second disabled bot", mkB.status === 200 || mkB.status === 201, JSON.stringify(mkB.json?.error ?? ""));
await db.execute({ sql: "UPDATE BotConfig SET lastTickAt = NULL WHERE userId = ?", args: [uid] });
const hb3 = await call("POST", "/api/bot/tick?mode=heartbeat");
const resB = (hb3.json?.results ?? []).find((r) => r.symbol === "ETHUSDT");
const resA3 = (hb3.json?.results ?? []).find((r) => r.symbol === "BTCUSDT");
check("disabled+flat bot excluded", resB === undefined, JSON.stringify(resB ?? {}));
check("disabled+flat first bot excluded too", resA3 === undefined, JSON.stringify(resA3 ?? {}));

/* 7 — per-bot errors land in the audit trail (action ERROR) */
const mkC = await call("PUT", "/api/bot", {
  mode: "MODERATE", symbol: "ZZZZUSDT", paper: true, enabled: true,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create bogus-symbol bot", mkC.status === 200 || mkC.status === 201, JSON.stringify(mkC.json?.error ?? ""));
const man = await call("POST", "/api/bot/tick");
check("manual tick 200 + mode", man.status === 200 && man.json?.mode === "manual", man.json?.mode);
const resC = (man.json?.results ?? []).find((r) => r.symbol === "ZZZZUSDT");
check("bogus symbol → ERROR outcome", resC?.action === "ERROR", JSON.stringify(resC ?? {}));
const errRow = (await db.execute({
  sql: "SELECT action, status FROM BotTrade WHERE configId = ? AND action = 'ERROR' LIMIT 1",
  args: [mkC.json?.config?.id ?? ""],
})).rows[0];
check("ERROR audit row exists", Boolean(errRow), JSON.stringify(errRow ?? {}));

/* 8 — cleanup */
await db.execute({ sql: "DELETE FROM BotPosition WHERE userId = ?", args: [uid] });
await db.execute({ sql: "DELETE FROM BotTrade WHERE userId = ?", args: [uid] });
await db.execute({ sql: "DELETE FROM BotConfig WHERE userId = ?", args: [uid] });
await db.execute({ sql: "DELETE FROM User WHERE id = ?", args: [uid] });
check("cleanup", true);

console.log(fails.length ? `\n${fails.length} FAIL: ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
