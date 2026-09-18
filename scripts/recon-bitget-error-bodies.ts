/**
 * Raw-recon: what does Bitget ACTUALLY return (HTTP status + body) for
 * place-order with fake creds / bad symbol? Calibrates classifyTradeProbe.
 * No real credentials involved — random hex keys only.
 */
import { createHmac } from "crypto";

const BASE = "https://api.bitget.com";
const PATH = "/api/v2/spot/trade/place-order";

function sign(ts: string, method: string, path: string, body: string, secret: string) {
  return createHmac("sha256", secret).update(ts + method + path + body).digest("base64");
}

async function attempt(label: string, apiKey: string, secret: string, pass: string, body: object) {
  const ts = Date.now().toString();
  const b = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE}${PATH}`, {
      method: "POST",
      headers: {
        "ACCESS-KEY": apiKey,
        "ACCESS-SIGN": sign(ts, "POST", PATH, b, secret),
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-PASSPHRASE": pass,
        "Content-Type": "application/json",
        locale: "en-US",
      },
      body: b,
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    console.log(`[${label}] HTTP ${res.status} :: ${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`[${label}] NETWORK ERROR ${(e as Error).message}`);
  }
}

await attempt(
  "fake-creds invalid-symbol",
  "cgp" + "0".repeat(48),
  "cgp" + "0".repeat(64),
  "cgpFakePass",
  { symbol: "CRYPTOPULSEPROBEUSDT", side: "buy", orderType: "market", size: "0.000001", force: "normal" }
);

await attempt(
  "unsigned invalid-symbol",
  "",
  "0".repeat(64),
  "",
  { symbol: "CRYPTOPULSEPROBEUSDT", side: "buy", orderType: "market", size: "0.000001", force: "normal" }
);

await attempt(
  "fake-creds BTCUSDT min-notional-violation",
  "cgp" + "1".repeat(48),
  "cgp" + "1".repeat(64),
  "cgpFakePass2",
  { symbol: "BTCUSDT", side: "buy", orderType: "market", size: "0.000001", force: "normal" }
);
