/**
 * Production probe: verify commit (41) "trade permission badge + connection report" is live.
 * Scans all JS chunks of the deployed Next.js app for feature strings.
 */
const BASE = "https://cryptopulse-iota-self.vercel.app";

const NEEDLES = [
  "Spot trade OK",          // i18n permGranted (TradePermBadge)
  "Bitget spot trade connected", // LIVE WALLET pill granted
  "tradePermission",        // API field name in bundle
];

async function main() {
  const res = await fetch(BASE, { headers: { "user-agent": "Mozilla/5.0" } });
  const html = await res.text();
  const chunks = new Set<string>();
  for (const m of html.matchAll(/\/_next\/static\/[^"']+\.js/g)) chunks.add(m[0]);
  console.log(`HTML ${res.status}, ${chunks.size} chunk refs found`);

  let found = new Map<string, string>();
  for (const c of chunks) {
    try {
      const r = await fetch(BASE + c);
      const t = await r.text();
      for (const n of NEEDLES) {
        if (t.includes(n) && !found.has(n)) found.set(n, c.split("/").pop()!);
      }
    } catch { /* skip */ }
  }
  let ok = true;
  for (const n of NEEDLES) {
    const hit = found.get(n);
    console.log(`${hit ? "FOUND" : "MISSING"}: "${n}"${hit ? " @ " + hit : ""}`);
    if (!hit) ok = false;
  }
  console.log(ok ? "PROBE PASS — commit (41) live in production" : "PROBE INCOMPLETE");
  process.exit(ok ? 0 : 1);
}
main();
