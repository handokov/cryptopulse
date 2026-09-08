/** Shared client-side formatting helpers. */

export function fmtPrice(x: number): string {
  if (x >= 1000)
    return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (x >= 1)
    return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${x.toFixed(4)}`;
}

export function fmtCompactUsd(x: number): string {
  if (x >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtPct(x: number, digits = 2): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

/** Sign-free percentage — for shares/weights where "+" makes no sense. */
export function fmtPctPlain(x: number, digits = 2): string {
  return `${x.toFixed(digits)}%`;
}
