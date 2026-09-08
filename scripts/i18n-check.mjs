/**
 * i18n structural check — mirrors Task 3-a / 5-3 conventions.
 *
 * Flattens en.ts (source of truth) into a dotted key list and asserts, for
 * each of id/zh/es/pt/ja:
 *   1. 0 missing keys
 *   2. 0 extra keys
 *   3. every {placeholder} set matches en exactly, per key
 *
 * Run: bun /home/z/my-project/scripts/i18n-check.mjs
 * (bun transpiles TS on import, so the `export default const` catalogs load directly)
 */

const MESSAGES_DIR = new URL("../src/i18n/messages/", import.meta.url);
const LOCALES = ["en", "id", "zh", "es", "pt", "ja"];

// Dynamically import every catalog (files declare `const xx = {...}; export default xx;`).
const catalogs = {};
for (const locale of LOCALES) {
  const mod = await import(new URL(`${locale}.ts`, MESSAGES_DIR).href);
  const catalog = mod.default;
  if (!catalog || typeof catalog !== "object") {
    console.error(`✗ ${locale}.ts has no default export object`);
    process.exit(1);
  }
  catalogs[locale] = catalog;
}

// Recursively flatten nested namespaces into "a.b.c" → string.
function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, path));
    else out[path] = String(value);
  }
  return out;
}

// Extract the sorted set of {placeholders} from a message.
function placeholders(str) {
  return (str.match(/\{[^{}]+\}/g) ?? []).sort().join(", ");
}

const en = flatten(catalogs.en);
const enKeys = Object.keys(en);
const enNamespaces = [...new Set(enKeys.map((k) => k.split(".")[0]))];

console.log(
  `en (source of truth): ${enKeys.length} keys across ${enNamespaces.length} namespaces [${enNamespaces.join(", ")}]`
);

let exitCode = 0;

for (const locale of LOCALES.slice(1)) {
  const flat = flatten(catalogs[locale]);
  const missing = enKeys.filter((k) => !(k in flat));
  const extra = Object.keys(flat).filter((k) => !(k in en));
  const placeholderMismatches = enKeys.filter(
    (k) => k in flat && placeholders(en[k]) !== placeholders(flat[k])
  );

  if (missing.length === 0 && extra.length === 0 && placeholderMismatches.length === 0) {
    console.log(`✓ ${locale}: ${Object.keys(flat).length}/${enKeys.length} keys — 0 missing, 0 extra, 0 placeholder mismatches`);
    continue;
  }

  exitCode = 1;
  console.error(`✗ ${locale}:`);
  if (missing.length) console.error(`    missing (${missing.length}): ${missing.join(", ")}`);
  if (extra.length) console.error(`    extra (${extra.length}): ${extra.join(", ")}`);
  for (const key of placeholderMismatches) {
    console.error(
      `    placeholder mismatch at "${key}": en {${placeholders(en[k] ?? en[key])}} vs ${locale} {${placeholders(flat[key])}}`
    );
  }
}

if (exitCode === 0) console.log("i18n-check: ALL CLEAN");
process.exit(exitCode);
