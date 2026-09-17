/**
 * Task 23-closure — production deploy probe for commit (47) badge fix.
 * Needle: the NEW legacy-fallback strings in exitReasonKey (bot-section chunk)
 *   - "≥ target" (raw or \u2265-escaped)  → old TP rows recolor
 *   - "≤ stop"  (raw or \u2264-escaped)   → old SL rows recolor
 * Negative control: build-46 bot-section chunk e6c997313545564a.js must 404.
 */
import { execSync } from "node:child_process";

const BASE = "https://cryptopulse-iota-self.vercel.app";

const html = execSync(
  `curl -s --max-time 30 -H "User-Agent: Mozilla/5.0" ${BASE}/`,
  { encoding: "utf8" },
);

const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9._-]+\.js/g) || [])];
console.log(`HTML chunks referenced: ${chunks.length}`);

const needlés = ["\u2265 target", "\u2264 stop", "\\u2265 target", "\\u2264 stop"];
let found: Record<string, string | null> = {};
for (const c of chunks) {
  const url = BASE + c;
  const body = execSync(`curl -s --max-time 30 "${url}"`, { encoding: "utf8" }).slice(0, 400000);
  for (const n of needlés) {
    if (!found[n] && body.includes(n)) found[n] = c;
  }
}

console.log("--- needle scan ---");
let all = true;
for (const n of ["\u2265 target", "\u2264 stop"]) {
  const hit = found[n] || found["\\u2265 target"] && n.startsWith("\\u2265") ? found[n] || found["\\u2265 target"] : found["\\u2264 stop"] && n.startsWith("\\u2264") ? found["\\u2264 stop"] : found[n] || null;
  const where = found[n] ?? (n.startsWith("\\u2265") ? found["\\u2265 target"] : found["\\u2264 stop"]) ?? null;
  console.log(`${where ? "[FOUND]" : "[MISS ]"} needle "${n}" → ${where ?? "not in any chunk"}`);
  if (!where) all = false;
}

console.log("--- old chunk control ---");
const oldStatus = execSync(
  `curl -s -o /dev/null -w "%{http_code}" --max-time 20 ${BASE}/_next/static/chunks/e6c997313545564a.js`,
  { encoding: "utf8" },
);
console.log(`build-46 bot-section chunk e6c997313545564a.js → HTTP ${oldStatus} (expect 404)`);

console.log(all && oldStatus === "404" ? "PROBE: (47) LIVE ✓" : "PROBE: inconclusive — inspect above");
