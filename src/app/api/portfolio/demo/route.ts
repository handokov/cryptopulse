/**
 * POST /api/portfolio/demo — one-click demo seeding: creates 6 sample
 * holdings and fabricates 14 days of deterministic portfolio value
 * snapshots (stable for a given user) ending today.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { findTopCoin } from "@/lib/top100";
import { fetchSimplePrices } from "@/lib/coin-prices";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const DEMO_HOLDINGS: Array<{
  coinId: string;
  symbol: string;
  name: string;
  quantity: number;
  purchasePrice: number;
  daysAgo: number;
}> = [
  { coinId: "bitcoin", symbol: "BTC", name: "Bitcoin", quantity: 0.15, purchasePrice: 58000, daysAgo: 240 },
  { coinId: "ethereum", symbol: "ETH", name: "Ethereum", quantity: 2.4, purchasePrice: 2900, daysAgo: 150 },
  { coinId: "solana", symbol: "SOL", name: "Solana", quantity: 32, purchasePrice: 138, daysAgo: 95 },
  { coinId: "cardano", symbol: "ADA", name: "Cardano", quantity: 3500, purchasePrice: 0.62, daysAgo: 60 },
  { coinId: "dogecoin", symbol: "DOGE", name: "Dogecoin", quantity: 12000, purchasePrice: 0.14, daysAgo: 45 },
  { coinId: "chainlink", symbol: "LINK", name: "Chainlink", quantity: 120, purchasePrice: 16.5, daysAgo: 21 },
];

const FALLBACK_PRICES: Record<string, number> = {
  bitcoin: 97000,
  ethereum: 3800,
  solana: 210,
  cardano: 0.95,
  dogecoin: 0.23,
  chainlink: 22,
};

/** Deterministic daily step in [-0.025, 0.025] from the user seed + day offset. */
function dailyStep(seed: number, d: number): number {
  const x = Math.sin(seed * 12.9898 + d * 78.233) * 43758.5453;
  const frac = x - Math.floor(x); // [0, 1)
  return (frac - 0.5) * 0.05; // [-0.025, 0.025)
}

function utcDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await db.holding.count({ where: { userId: user.id } });
  if (existing > 0) {
    return NextResponse.json({ error: "not_empty" }, { status: 409 });
  }

  /* Prices: live first, fallback constants for anything missing. */
  const ids = DEMO_HOLDINGS.map((h) => h.coinId);
  const { map: liveMap } = await fetchSimplePrices(ids);
  const priceFor = (coinId: string): number =>
    liveMap[coinId]?.usd ?? FALLBACK_PRICES[coinId] ?? 0;

  /* Edge guard: if somehow nothing resolved, force fallback constants
     (guaranteed non-zero) so snapshots are never flat at 0. */
  let currentValueToday = DEMO_HOLDINGS.reduce(
    (acc, h) => acc + h.quantity * priceFor(h.coinId),
    0
  );
  if (!(currentValueToday > 0)) {
    currentValueToday = DEMO_HOLDINGS.reduce(
      (acc, h) => acc + h.quantity * (FALLBACK_PRICES[h.coinId] ?? 0),
      0
    );
  }

  const totalCost = DEMO_HOLDINGS.reduce(
    (acc, h) => acc + h.quantity * h.purchasePrice,
    0
  );

  /* Fabricate 14 daily snapshots ending today: value(0) = today exactly;
     walking backward, value(d-1) = value(d) / (1 + step) with a
     deterministic per-user pseudo-random step (stable across calls). */
  const seed = [...user.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const snapshotRows: Array<{ date: string; totalValue: number; totalCost: number }> = [];
  let value = currentValueToday;
  snapshotRows.push({ date: utcDay(0), totalValue: value, totalCost });
  for (let d = 1; d <= 13; d++) {
    // value(d) = value(d-1) * (1 + step(d))  ⇔  value(d-1) = value(d) / (1 + step(d))
    value = value * (1 + dailyStep(seed, d));
    snapshotRows.push({ date: utcDay(d), totalValue: value, totalCost });
  }

  for (const row of snapshotRows) {
    await db.portfolioSnapshot.upsert({
      where: { userId_date: { userId: user.id, date: row.date } },
      create: { userId: user.id, date: row.date, totalValue: row.totalValue, totalCost: row.totalCost },
      update: { totalValue: row.totalValue, totalCost: row.totalCost },
    });
  }

  const created = await Promise.all(
    DEMO_HOLDINGS.map((h) =>
      db.holding.create({
        data: {
          userId: user.id,
          coinId: h.coinId,
          symbol: h.symbol,
          name: h.name,
          image: findTopCoin(h.coinId)?.image ?? null,
          quantity: h.quantity,
          purchasePrice: h.purchasePrice,
          purchaseDate: new Date(Date.now() - h.daysAgo * DAY_MS),
        },
      })
    )
  );

  return NextResponse.json(
    { holdings: created.length, snapshots: snapshotRows.length },
    { status: 201 }
  );
}
