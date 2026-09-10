/**
 * Bot timeframe tables (v2 phase 2) — PURE module, safe to import from
 * client components. Kept separate from strategy.ts because that module
 * pulls the signed Bitget client (node:crypto) transitively.
 *
 * User-approved design (26 / 26-b):
 *   MODERATE   → 1H / 4H / 1D   (default 4H = legacy behavior)
 *   AGGRESSIVE → 15M / 30M / 1H (default 1H)
 * Post-exit cooldown scales with the bar length; the 4H value is the
 * historical 45 min so existing bots keep their exact behavior.
 */

export type BotTimeframe = "15M" | "30M" | "1H" | "4H" | "1D";

export const TF_OPTIONS: Record<"MODERATE" | "AGGRESSIVE", BotTimeframe[]> = {
  MODERATE: ["1H", "4H", "1D"],
  AGGRESSIVE: ["15M", "30M", "1H"],
};

export const TF_DEFAULT: Record<"MODERATE" | "AGGRESSIVE", BotTimeframe> = {
  MODERATE: "4H",
  AGGRESSIVE: "1H",
};

/** Post-exit cooldown in minutes, per signal timeframe. */
export const TF_COOLDOWN_MIN: Record<BotTimeframe, number> = {
  "15M": 5,
  "30M": 10,
  "1H": 20,
  "4H": 45,
  "1D": 240,
};

export function isBotTimeframe(tf: unknown): tf is BotTimeframe {
  return tf === "15M" || tf === "30M" || tf === "1H" || tf === "4H" || tf === "1D";
}

/** Effective cooldown for a (mode, tf) pair; invalid tf → legacy 45 min. */
export function cooldownMinFor(_mode: string, tf: string): number {
  return isBotTimeframe(tf) ? TF_COOLDOWN_MIN[tf] : 45;
}
