/**
 * E2E — Trade history (Task 19): GET /api/bot must expose `history`
 * (closed positions, newest first, with lifecycle timestamps) and the
 * stats block must carry avg duration metrics split by outcome.
 *
 * Flow:
 *   1. register a throwaway user
 *   2. create a PAPER bot
 *   3. seed 2 CLOSED BotPosition rows directly in SQLite:
 *        win  — opened 3h ago, closed 45m ago  → dur 135m, take-profit
 *        loss — opened 2h ago, closed 15m ago  → dur 105m, stop-loss
 *   4. GET /api/bot?symbol=BTCUSDT
 *        history[0] = loss (newer closedAt), history[1] = win
 *        row fields present, durations consistent with seeds
 *        stats.avgWinDurationMin ≈ 135, avgLossDurationMin ≈ 105
 *   5. cleanup
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
const email = `hist-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "T" });
check("register", reg.status === 200 || reg.status === 201);

const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
check("user row exists", Boolean(uid), uid);

/* 2 — create paper bot */
const mk = await call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
check("create paper bot", mk.status === 200 || mk.status === 201, JSON.stringify(mk.json?.error ?? ""));
const cfgId = (await db.execute({
  sql: "SELECT id FROM BotConfig WHERE userId = ? AND symbol = 'BTCUSDT' LIMIT 1", args: [uid],
})).rows[0].id;
check("config row exists", Boolean(cfgId), cfgId);

/* 3 — seed closed positions (epoch ms — SQLite DateTime) */
const now = Date.now();
const H = 3600_000, M = 60_000;
const win = {
  opened: now - 3 * H, closed: now - 45 * M,   // duration 135m
  entry: 77000, exit: 78540, pnl: 0.5,
  reason: "take-profit crossed (+2.0%)",
};
const loss = {
  opened: now - 2 * H, closed: now - 15 * M,   // duration 105m
  entry: 77500, exit: 76337.5, pnl: -0.3,
  reason: "stop-loss crossed (-1.5%)",
};
for (const [tag, p] of [["win", win], ["loss", loss]]) {
  await db.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, exitPrice, realizedPnlUsdt, exitReason, openedAt, closedAt)
          VALUES (?, ?, ?, 'BTCUSDT', 'LONG', ?, 0.065, 5.0, 1, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`,
    args: [`hist-${tag}-${now}`, uid, cfgId, p.entry, p.entry * 0.985, p.entry * 1.02, p.exit, p.pnl, p.reason, p.opened, p.closed],
  });
}
check("seeded 2 closed positions", true);

/* 4 — GET and assert */
const g = await call("GET", "/api/bot?symbol=BTCUSDT");
check("GET 200", g.status === 200);
const hist = g.json?.history ?? [];
check("history length 2", hist.length === 2, String(hist.length));

const [first, second] = hist;
check("newest first (loss row first)", first?.exitReason === loss.reason, first?.exitReason);
check("older row second (win)", second?.exitReason === win.reason, second?.exitReason);
check("row timestamps ISO", typeof first?.openedAt === "string" && typeof first?.closedAt === "string", `${first?.openedAt} → ${first?.closedAt}`);

const durOf = (r) => (new Date(r.closedAt) - new Date(r.openedAt)) / 60_000;
check("loss row duration ≈105m", Math.abs(durOf(first) - 105) <= 1, String(durOf(first)));
check("win row duration ≈135m", Math.abs(durOf(second) - 135) <= 1, String(durOf(second)));
check("row pnl fields", first?.realizedPnlUsdt === loss.pnl && second?.realizedPnlUsdt === win.pnl, `${second?.realizedPnlUsdt} / ${first?.realizedPnlUsdt}`);
check("row price fields", first?.exitPrice === loss.exit && second?.exitPrice === win.exit, `${second?.exitPrice} / ${first?.exitPrice}`);

const st = g.json?.stats ?? {};
check("stats avgWinDurationMin ≈135", Math.abs((st.avgWinDurationMin ?? -1) - 135) <= 1, String(st.avgWinDurationMin));
check("stats avgLossDurationMin ≈105", Math.abs((st.avgLossDurationMin ?? -1) - 105) <= 1, String(st.avgLossDurationMin));
const expAll = (135 + 105) / 2;
check("stats avgDurationMin ≈120", Math.abs((st.avgDurationMin ?? -1) - expAll) <= 1, String(st.avgDurationMin));

/* 5 — cleanup */
await db.execute({ sql: "DELETE FROM BotPosition WHERE userId = ?", args: [uid] });
await db.execute({ sql: "DELETE FROM BotConfig WHERE userId = ?", args: [uid] });
await db.execute({ sql: "DELETE FROM User WHERE id = ?", args: [uid] });
check("cleanup", true);

if (fails.length) {
  console.log(`\nFAILED: ${fails.length} — ${fails.join(" | ")}`);
  process.exit(1);
}
console.log("\nALL PASS — trade history verify");
