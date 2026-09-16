/**
 * Task 21 — verify the $1 minimum-order semantics after the 5 → 1 fallback
 * correction (user-verified Bitget spot minimum: 1.0000 USDT).
 *
 * Checks planLimitBuySize + the engine fallback constant:
 *   1. minOrderUsdt = 0 (fetch failed) → fallback 1, not 5
 *   2. budget $1, live min 1 → order notional ≥ 1 at the limit level
 *   3. budget $1, available $0.5 → null (cannot fund the minimum)
 *   4. budget $1, live min 1, low-precision symbol → qty rounds UP to clear 1
 *   5. budget $20 (pilot size) untouched by the minimum
 */
import { planLimitBuySize } from "../src/lib/bot/bitget-trade";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  [ok] ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`  [FAIL] ${name}${extra ? " — " + extra : ""}`);
  }
}

console.log("1) fallback when minOrderUsdt=0 (rules fetch failed)");
const r1 = planLimitBuySize({ marketPrice: 0.13852, level: 0.13810, budgetUsdt: 1, minOrderUsdt: 0, availableUsdt: 20, quantityPrecision: 2 });
check("returns an order (not null)", r1 !== null);
check("notional ≥ 1 (old fallback would demand 5)", r1 !== null && r1.notional >= 1, r1 ? `notional ${r1.notional.toFixed(4)}` : "");
check("notional < 5 — no phantom $5 bump", r1 !== null && r1.notional < 5, r1 ? `notional ${r1.notional.toFixed(4)}` : "");

console.log("2) budget $1 with live min 1");
const r2 = planLimitBuySize({ marketPrice: 0.13852, level: 0.13810, budgetUsdt: 1, minOrderUsdt: 1, availableUsdt: 20, quantityPrecision: 2 });
check("accepted at $1", r2 !== null && r2.notional >= 1 && r2.notional < 1.2, r2 ? `notional ${r2.notional.toFixed(4)}` : "");

console.log("3) cannot fund the minimum");
const r3 = planLimitBuySize({ marketPrice: 0.13852, level: 0.13810, budgetUsdt: 1, minOrderUsdt: 1, availableUsdt: 0.5, quantityPrecision: 2 });
check("null (available below min)", r3 === null);

console.log("4) low precision — qty rounds UP to clear the minimum");
const r4 = planLimitBuySize({ marketPrice: 100, level: 99.7, budgetUsdt: 1, minOrderUsdt: 1, availableUsdt: 20, quantityPrecision: 3 });
check("notional ≥ 1 after round-up", r4 !== null && r4.notional >= 1, r4 ? `qty ${r4?.qty}, notional ${r4?.notional.toFixed(4)}` : "");

console.log("5) pilot size $20 untouched");
const r5 = planLimitBuySize({ marketPrice: 0.13852, level: 0.13810, budgetUsdt: 20, minOrderUsdt: 1, availableUsdt: 20, quantityPrecision: 2 });
check("notional ≈ 20 (no clamping)", r5 !== null && r5.notional > 19 && r5.notional <= 20, r5 ? `notional ${r5?.notional.toFixed(4)}` : "");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
