/**
 * Task 31 — local E2E verification of v2 phase 2 backend:
 *   1. register a fresh test user
 *   2. create a bot (MODERATE, 4H default)
 *   3. GET /api/bot/candles → OHLC + signal + bands
 *   4. PUT timeframe validation (invalid TF rejected, valid TF set)
 *   5. entryLine validation (negative rejected, valid set, null clears)
 *   6. tick runs with the new fields (lastPrice stamping visible in DB)
 *   7. POST /api/bot/close with no open position → 409 no_position
 *   8. TF coercion on mode switch (AGGRESSIVE keeps 1H, rejects 1D)
 */
const BASE = "http://localhost:3000";
const JAR = "/tmp/t31-cookies.txt";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "task31-verify/1.0",
      Cookie: await readJar(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) await storeJar(setCookie);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
async function readJar() {
  if (!existsSync(JAR)) return "";
  return readFileSync(JAR, "utf8");
}
async function storeJar(cookies) {
  const prev = existsSync(JAR) ? readFileSync(JAR, "utf8") : "";
  const map = new Map();
  for (const line of (prev + "\n" + cookies.join("\n")).split("\n")) {
    const [pair] = line.split(";");
    if (pair && pair.includes("=")) {
      const idx = pair.indexOf("=");
      map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  writeFileSync(JAR, [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures++;
}

const email = `task31-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "T31" });
check("register", reg.status === 200 || reg.status === 201, JSON.stringify(reg.json)?.slice(0, 120));

const created = await call("PUT", "/api/bot", { mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20 });
check("create bot (default 4H)", created.status === 200 && created.json?.config?.timeframe === "4H", JSON.stringify(created.json).slice(0, 200));
const botId = created.json?.config?.id;

const got = await call("GET", "/api/bot?symbol=BTCUSDT");
check("GET summary.cooldownMin=45 (4H)", got.json?.summary?.cooldownMin === 45, `got ${got.json?.summary?.cooldownMin}`);
check("GET summary.tfOptions", JSON.stringify(got.json?.summary?.tfOptions?.AGGRESSIVE) === JSON.stringify(["15M", "30M", "1H"]));

// candles endpoint
const candles = await call("GET", "/api/bot/candles?symbol=BTCUSDT&tf=4H&limit=180");
check("candles 200", candles.status === 200, JSON.stringify(candles.json).slice(0, 160));
const nCandles = candles.json?.candles?.length ?? 0;
check("candles ≥60 rows", nCandles >= 60, `got ${nCandles}`);
const asc = (candles.json?.candles ?? []).every((c, i, a) => i === 0 || a[i - 1].time <= c.time);
check("candles ascending time", asc);
check("candles score present", typeof candles.json?.signal?.score === "number");
check("candles bands present", typeof candles.json?.bands?.tpPct === "number" && typeof candles.json?.bands?.slPct === "number");
check("candles price present", (candles.json?.price ?? 0) > 0, `got ${candles.json?.price}`);

// 1H candles on same symbol (engine TF switch path)
const candles1h = await call("GET", "/api/bot/candles?symbol=BTCUSDT&tf=1H");
check("candles tf=1H ok", candles1h.status === 200 && (candles1h.json?.tf === "1H"));

// invalid TF rejected → falls back to mode default (4H)
const badTf = await call("PUT", "/api/bot", { id: botId, mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, timeframe: "15M" });
check("MODERATE+15M coerced to 4H", badTf.status === 200 && badTf.json?.config?.timeframe === "4H", `got ${badTf.json?.config?.timeframe}`);

// valid TF for MODERATE
const okTf = await call("PUT", "/api/bot", { id: botId, mode: "MODERATE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, timeframe: "1D" });
check("MODERATE+1D accepted", okTf.status === 200 && okTf.json?.config?.timeframe === "1D", `got ${okTf.json?.config?.timeframe}`);
const cd1d = await call("GET", "/api/bot?symbol=BTCUSDT");
check("GET cooldownMin=240 (1D)", cd1d.json?.summary?.cooldownMin === 240, `got ${cd1d.json?.summary?.cooldownMin}`);

// mode switch to AGGRESSIVE: 1D not allowed → coerced to 1H
const agg = await call("PUT", "/api/bot", { id: botId, mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, timeframe: "1D" });
check("AGGRESSIVE+1D coerced to 1H", agg.status === 200 && agg.json?.config?.timeframe === "1H", `got ${agg.json?.config?.timeframe}`);
const cdAgg = await call("GET", "/api/bot?symbol=BTCUSDT");
check("GET cooldownMin=20 (1H agg)", cdAgg.json?.summary?.cooldownMin === 20, `got ${cdAgg.json?.summary?.cooldownMin}`);

// entryLine validation
const badLine = await call("PUT", "/api/bot", { id: botId, mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, entryLine: -5 });
check("entryLine -5 rejected", badLine.status === 400);
const okLine = await call("PUT", "/api/bot", { id: botId, mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, entryLine: 12345.6 });
check("entryLine 12345.6 accepted", okLine.status === 200 && okLine.json?.config?.entryLine === 12345.6, JSON.stringify(okLine.json?.config?.entryLine));
const clearLine = await call("PUT", "/api/bot", { id: botId, mode: "AGGRESSIVE", symbol: "BTCUSDT", paper: true, enabled: false, orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, entryLine: null });
check("entryLine null clears", clearLine.status === 200 && clearLine.json?.config?.entryLine === null);

// manual tick with new fields (force, disabled bot, manual path)
const tick = await call("POST", "/api/bot/tick");
check("manual tick 200", tick.status === 200 && tick.json?.ok === true, JSON.stringify(tick.json).slice(0, 160));
const after = await call("GET", "/api/bot?symbol=BTCUSDT");
check("lastPrice stamped after tick", (after.json?.config?.lastPrice ?? 0) > 0, `got ${after.json?.config?.lastPrice}`);

// close with no open position → 409 no_position
const closeNone = await call("POST", "/api/bot/close", { configId: botId });
check("close no position → 409 no_position", closeNone.status === 409 && closeNone.json?.error === "no_position", JSON.stringify(closeNone.json));

// candles unauthorized
const anon = await fetch(`${BASE}/api/bot/candles?symbol=BTCUSDT`, { method: "GET", headers: { "User-Agent": "t31" } });
check("candles anon → 401", anon.status === 401);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
