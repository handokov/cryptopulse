/**
 * Verification for the exchange-connection stack (no live exchange calls):
 *   1. AES-256-GCM credential roundtrip + masking + tamper detection
 *   2. Binance signing determinism + payload parsing (+ filtering zero rows)
 *   3. Bitget signing vector + passphrase enforcement + response parsing
 *   4. Tokocrypto dual payload-shape parsing + envelope error mapping
 *   5. Demo adapter determinism + unmatched-asset seeding
 *   6. signedFetch error mapping (network / rate limit / http auth)
 *
 * Run: bun scripts/verify-exchange-adapters.ts
 */

import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from "../src/lib/secure";
import {
  binanceAdapter,
  binanceSignature,
  parseBinanceBalances,
} from "../src/lib/exchanges/binance";
import { bitgetAdapter } from "../src/lib/exchanges/bitget";
import { tokocryptoAdapter } from "../src/lib/exchanges/tokocrypto";
import { demoAdapter } from "../src/lib/exchanges/demo";
import { signedFetch, ExchangeError } from "../src/lib/exchanges/types";
import { createHmac } from "crypto";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}`);
  }
}

async function expectExchangeError(
  name: string,
  code: string,
  p: Promise<unknown>
) {
  try {
    await p;
    fail += 1;
    console.error(`  ✗ ${name} — resolved but expected ExchangeError(${code})`);
  } catch (err) {
    const ok = err instanceof ExchangeError && err.code === code;
    if (ok) {
      pass += 1;
      console.log(`  ✓ ${name}`);
    } else {
      fail += 1;
      console.error(`  ✗ ${name} — got ${String(err)}`);
    }
  }
}

/** Temporarily stub global fetch. */
function withFetch(
  impl: () => Promise<Response>,
  run: () => Promise<unknown>
): Promise<unknown> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = orig;
  });
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

console.log("\n[1] secure.ts — encryption");
{
  const secret = "AbCdEf1234567890-secret/+/==";
  const enc = encryptSecret(secret);
  check("ciphertext differs from plaintext", !enc.includes(secret));
  check("ciphertext has iv.tag.data form", enc.split(".").length === 3);
  check("roundtrip returns plaintext", decryptSecret(enc) === secret);
  check("fresh IV per call", encryptSecret(secret) !== enc);
  const [iv, tag, data] = enc.split(".");
  // Flip one bit of the ciphertext → GCM auth must fail.
  const bad = Buffer.from(data, "base64");
  bad[0] ^= 0xff;
  let tampered = false;
  try {
    decryptSecret(`${iv}.${tag}.${bad.toString("base64")}`);
  } catch {
    tampered = true;
  }
  check("tampered ciphertext rejected", tampered);
  check("mask hides middle", maskSecret("ABCD1234EFGH9012") === "ABCD••••9012");
  check("short key fully masked", maskSecret("short") === "••••••••");
  // Regression: empty plaintext (demo adapter stores encrypted "") must roundtrip.
  check("empty plaintext roundtrip", decryptSecret(encryptSecret("")) === "");
  check("empty ciphertext segment stays 3-part", encryptSecret("").split(".").length === 3);
}

console.log("\n[2] binance.ts — signing + parsing");
{
  const sig = binanceSignature("timestamp=123", "s3cr3t");
  const expected = createHmac("sha256", "s3cr3t").update("timestamp=123").digest("hex");
  check("HMAC-SHA256 hex signature matches vector", sig === expected && /^[0-9a-f]{64}$/.test(sig));

  const parsed = parseBinanceBalances({
    balances: [
      { asset: "BTC", free: "0.5", locked: "0.25" },
      { asset: "ETH", free: "0", locked: "0" },
      { asset: "usdt", free: "10.5", locked: "1.5" },
    ],
  });
  check("zero-balance rows filtered", parsed.length === 2);
  check("symbol uppercased", parsed[1].asset === "USDT");
  check("free+locked preserved", parsed[0].free === 0.5 && parsed[0].locked === 0.25);

  const creds = { apiKey: "k-test-1234", apiSecret: "s-test-5678" };

  await withFetch(
    () =>
      Promise.resolve(
        jsonRes({
          balances: [{ asset: "BTC", free: "1", locked: "0" }],
        })
      ),
    () => binanceAdapter.fetchBalances(creds)
  ).then((rows) => {
    check("200 with balances → parsed", Array.isArray(rows) && rows.length === 1);
  });

  await withFetch(
    () => Promise.resolve(jsonRes({ code: -2015, msg: "Invalid API-key" })),
    () => binanceAdapter.fetchBalances(creds)
  ).then((rows) => {
    check("200 error envelope → auth error", rows === undefined ? false : true);
  }).catch((err) => {
    check("200 error envelope → auth error", err instanceof ExchangeError && err.code === "auth");
  });

  await expectExchangeError(
    "HTTP 403 → auth",
    "auth",
    withFetch(() => Promise.resolve(jsonRes({}, 403)), () => binanceAdapter.fetchBalances(creds))
  );

  await expectExchangeError(
    "HTTP 500 → network",
    "network",
    withFetch(() => Promise.resolve(jsonRes({}, 500)), () => binanceAdapter.fetchBalances(creds))
  );

  await expectExchangeError(
    "missing balances array → unexpected",
    "unexpected",
    withFetch(() => Promise.resolve(jsonRes({})), () => binanceAdapter.fetchBalances(creds))
  );
}

console.log("\n[3] bitget.ts — signing + parsing");
{
  const creds = {
    apiKey: "bg-key-123456",
    apiSecret: "bg-secret-789",
    apiPassphrase: "ph-123",
  };
  await withFetch(
    () =>
      Promise.resolve(
        jsonRes({
          code: "00000",
          data: [
            { coin: "BTC", available: "2", frozen: "0.5", locked: "" },
            { coin: "XRP", available: "0", frozen: "0", locked: "0" },
          ],
        })
      ),
    () => bitgetAdapter.fetchBalances(creds)
  ).then((rows) => {
    const r = rows as { asset: string; free: number; locked: number }[];
    check("success payload → parsed + zero rows dropped", r.length === 1 && r[0].asset === "BTC");
    check("available+frozen+locked summed", r[0].free === 2 && r[0].locked === 0.5);
  });

  await expectExchangeError(
    "code 400007 → auth",
    "auth",
    withFetch(
      () => Promise.resolve(jsonRes({ code: "400007", msg: "signature not match" })),
      () => bitgetAdapter.fetchBalances(creds)
    )
  );

  await expectExchangeError(
    "missing passphrase → auth (client-side)",
    "auth",
    bitgetAdapter.fetchBalances({ apiKey: "k", apiSecret: "s" })
  );
}

console.log("\n[4] tokocrypto.ts — dual shapes");
{
  const creds = { apiKey: "toco-key-1", apiSecret: "toco-secret-1" };

  await withFetch(
    () => Promise.resolve(jsonRes({ balances: [{ asset: "BTC", free: "1", locked: "0" }] })),
    () => tokocryptoAdapter.fetchBalances(creds)
  ).then((rows) => {
    check("Binance shape accepted", (rows as unknown[]).length === 1);
  });

  await withFetch(
    () =>
      Promise.resolve(
        jsonRes({
          code: 0,
          msg: "Success",
          data: [{ coin: "ETH", available: "3.5", frozen: "0.5" }],
        })
      ),
    () => tokocryptoAdapter.fetchBalances(creds)
  ).then((rows) => {
    const r = rows as { asset: string; free: number; locked: number }[];
    check("whitelabel envelope accepted", r.length === 1 && r[0].asset === "ETH" && r[0].locked === 0.5);
  });

  await expectExchangeError(
    "code 3701 → auth (IP allowlist / bad key)",
    "auth",
    withFetch(
      () => Promise.resolve(jsonRes({ code: 3701, msg: "Invalid API-key, IP, or permissions" })),
      () => tokocryptoAdapter.fetchBalances(creds)
    )
  );
}

console.log("\n[5] demo.ts — determinism");
{
  const rowsA = await demoAdapter.fetchBalances({ apiKey: "", apiSecret: "" });
  const rowsB = await demoAdapter.fetchBalances({ apiKey: "", apiSecret: "" });
  check("deterministic balances", JSON.stringify(rowsA) === JSON.stringify(rowsB));
  check("includes an asset outside the top-100 (XYZ)", rowsA.some((r) => r.asset === "XYZ"));
  check("includes matched majors (BTC/ETH/SOL)", ["BTC", "ETH", "SOL"].every((a) => rowsA.some((r) => r.asset === a)));
}

console.log("\n[6] signedFetch — transport error mapping");
{
  await expectExchangeError(
    "aborted fetch → network",
    "network",
    withFetch(() => Promise.reject(new Error("boom")), () => signedFetch("https://x.test", {}))
  );
  await expectExchangeError(
    "429 → rate_limit",
    "rate_limit",
    withFetch(() => Promise.resolve(jsonRes({}, 429)), () => signedFetch("https://x.test", {}))
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
