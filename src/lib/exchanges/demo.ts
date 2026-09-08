/**
 * Demo adapter — sandbox balances with zero network dependency, so the whole
 * connect → sync → import flow can be exercised (and verified) without real
 * credentials. Deterministic per run; deliberately includes one asset outside
 * the top-100 universe so the "not tracked yet" UI path is demonstrable too.
 */

import { ExchangeAdapter, NormalizedBalance } from "./types";

const DEMO_ROWS: [string, number, number][] = [
  ["BTC", 0.4218, 0],
  ["ETH", 5.193, 0.2],
  ["SOL", 64.5, 0],
  ["BNB", 12.04, 0],
  ["XRP", 3200, 0],
  ["ADA", 9800, 0],
  ["DOGE", 42000, 0],
  ["XYZ", 777, 0], // not in the top-100 board → exercises the unmatched path
];

export const demoAdapter: ExchangeAdapter = {
  id: "demo",
  async fetchBalances(): Promise<NormalizedBalance[]> {
    return DEMO_ROWS.map(([asset, free, locked]) => ({ asset, free, locked }));
  },
};
