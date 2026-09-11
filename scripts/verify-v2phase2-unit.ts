/**
 * Task 31 — unit checks for the pure v2-phase-2 logic:
 *   - entryLineTouched (any-touch: epsilon band + crossing detection)
 *   - cooldownMinFor (TF table)
 *   - computeBotSignal TF-awareness (volAnnPct scales with bars/year)
 */
import { entryLineTouched } from "../src/lib/bot/engine";
import { cooldownMinFor, isBotTimeframe } from "../src/lib/bot/timeframes";
import { computeBotSignal } from "../src/lib/bot/strategy";
import { barsPerYearFor, TF_GRANULARITY } from "../src/lib/bot/bitget-trade";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures++;
}

/* entryLineTouched */
const L = 4.5;
check("exact touch", entryLineTouched(L, 4.49, 4.5));
check("epsilon band (±0.1%)", entryLineTouched(L, 4.49, 4.5044), "|4.5044-4.5|=0.00098 ≤ 0.0045");
check("downward crossing", entryLineTouched(L, 4.52, 4.49));
check("upward crossing", entryLineTouched(L, 4.48, 4.51));
check("no touch (price far above)", !entryLineTouched(L, 4.58, 4.59));
check("no touch (price far below)", !entryLineTouched(L, 4.3, 4.29));
check("no touch (no prev, outside band)", !entryLineTouched(L, null, 4.6));
check("gap past line in one tick = touched", entryLineTouched(L, 4.7, 4.2));
check("invalid line (0) → false", !entryLineTouched(0, 4.5, 4.5));

/* cooldown table */
check("cooldown 15M = 5", cooldownMinFor("AGGRESSIVE", "15M") === 5);
check("cooldown 4H = 45 (legacy)", cooldownMinFor("MODERATE", "4H") === 45);
check("cooldown 1D = 240", cooldownMinFor("MODERATE", "1D") === 240);
check("cooldown invalid tf → 45 fallback", cooldownMinFor("MODERATE", "9M") === 45);
check("isBotTimeframe rejects 2H", !isBotTimeframe("2H"));

/* bars per year */
check("bpy 15M = 35040", barsPerYearFor("15M") === 35040);
check("bpy 4H = 2190", barsPerYearFor("4H") === 2190);
check("bpy 1D = 365", barsPerYearFor("1D") === 365);
check("granularity map", TF_GRANULARITY["1D"] === "1day" && TF_GRANULARITY["4H"] === "4h");

/* signal TF-awareness: same shape, 15M bars should annualize 4x the 4H figure */
const closes4h = Array.from({ length: 120 }, (_, i) => 100 * Math.exp(Math.sin(i / 9) * 0.03 + i * 0.0004));
const s4h = computeBotSignal(closes4h, 2190);
const s15m = computeBotSignal(closes4h, 35040);
check("score identical across TF (same series)", s4h.score === s15m.score, `${s4h.score} vs ${s15m.score}`);
const ratio = s15m.volAnnPct / s4h.volAnnPct;
check("volAnn scales by sqrt(bpy ratio) ≈ 4", Math.abs(ratio - 4) < 1e-9, `ratio=${ratio}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
