/**
 * GET  /api/portfolio — authenticated user's holdings enriched with live
 *                       prices + aggregate computed stats.
 * POST /api/portfolio — create a new holding.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { findTopCoin } from "@/lib/top100";
import { fetchSimplePrices } from "@/lib/coin-prices";

export const dynamic = "force-dynamic";

interface EnrichedHolding {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  image: string | null;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  createdAt: string;
  currentPrice: number | null;
  change24h: number | null;
  costBasis: number;
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  weight: number | null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const holdings = await db.holding.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const coinIds = [...new Set(holdings.map((h) => h.coinId))];
  const { map: liveMap, failed } = await fetchSimplePrices(coinIds);

  /* Fallback: price any missing coin from the cached top-100 board so the
     dashboard keeps working under CoinGecko rate limits. */
  const priceMap = { ...liveMap };
  let usedBoard = false;
  for (const id of coinIds) {
    if (priceMap[id]) continue;
    const board = findTopCoin(id);
    if (board) {
      priceMap[id] = { usd: board.price, change: board.change24h };
      usedBoard = true;
    }
  }
  const priceStale = coinIds.length > 0 && (failed || usedBoard);

  /* First pass: per-holding values + totals */
  const base = holdings.map((h) => {
    const currentPrice = priceMap[h.coinId]?.usd ?? null;
    const change24h = priceMap[h.coinId]?.change ?? null;
    const costBasis = h.quantity * h.purchasePrice;
    const currentValue = currentPrice != null ? h.quantity * currentPrice : null;
    const pnl = currentValue != null ? currentValue - costBasis : null;
    const pnlPct =
      pnl != null && costBasis > 0 ? (pnl / costBasis) * 100 : null;
    return { h, currentPrice, change24h, costBasis, currentValue, pnl, pnlPct };
  });

  const totalValue = base.reduce((acc, b) => acc + (b.currentValue ?? 0), 0);
  const totalCost = base.reduce((acc, b) => acc + b.costBasis, 0);

  /* Second pass: portfolio weights */
  const enriched: EnrichedHolding[] = base.map((b) => ({
    id: b.h.id,
    coinId: b.h.coinId,
    symbol: b.h.symbol,
    name: b.h.name,
    image: b.h.image,
    quantity: b.h.quantity,
    purchasePrice: b.h.purchasePrice,
    purchaseDate: b.h.purchaseDate.toISOString(),
    createdAt: b.h.createdAt.toISOString(),
    currentPrice: b.currentPrice,
    change24h: b.change24h,
    costBasis: b.costBasis,
    currentValue: b.currentValue,
    pnl: b.pnl,
    pnlPct: b.pnlPct,
    weight:
      b.currentValue != null && totalValue > 0 ? (b.currentValue / totalValue) * 100 : null,
  }));

  /* Weighted 24h portfolio change (null-safe over valued positions) */
  let change24hWeightedSum = 0;
  for (const h of enriched) {
    if (h.currentValue != null && h.change24h != null) {
      change24hWeightedSum += (h.currentValue * h.change24h) / 100;
    }
  }
  const change24hPct =
    totalValue > 0 ? (change24hWeightedSum / totalValue) * 100 : null;

  const totalPnl = totalValue > 0 ? totalValue - totalCost : null;
  const totalPnlPct =
    totalValue > 0 && totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null;

  let topHolding: { symbol: string; name: string; weight: number } | null = null;
  for (const h of enriched) {
    if (h.weight != null && (topHolding === null || h.weight > topHolding.weight)) {
      topHolding = { symbol: h.symbol, name: h.name, weight: h.weight };
    }
  }

  const computed = {
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPct,
    change24hPct,
    profitableCount: enriched.filter((h) => h.pnl != null && h.pnl > 0).length,
    losingCount: enriched.filter((h) => h.pnl != null && h.pnl < 0).length,
    positionCount: enriched.length,
    topHolding,
    priceStale,
  };

  /* Record today's daily snapshot (best-effort — must never break the response). */
  if (holdings.length > 0 && totalValue > 0) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await db.portfolioSnapshot.upsert({
        where: { userId_date: { userId: user.id, date: today } },
        create: { userId: user.id, date: today, totalValue, totalCost },
        update: { totalValue, totalCost },
      });
    } catch {
      /* snapshot recording is non-critical */
    }
  }

  return NextResponse.json({ holdings: enriched, computed });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      coinId?: unknown;
      symbol?: unknown;
      name?: unknown;
      image?: unknown;
      quantity?: unknown;
      purchasePrice?: unknown;
      purchaseDate?: unknown;
    };

    const coinId = typeof body.coinId === "string" ? body.coinId.trim() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const image = typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
    const quantity = Number(body.quantity);
    const purchasePrice = Number(body.purchasePrice);
    const purchaseDate = new Date(String(body.purchaseDate ?? ""));

    const valid =
      coinId.length > 0 &&
      symbol.length > 0 &&
      name.length > 0 &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Number.isFinite(purchasePrice) &&
      purchasePrice > 0 &&
      !Number.isNaN(purchaseDate.getTime());
    if (!valid) return NextResponse.json({ error: "validation" }, { status: 400 });

    const holding = await db.holding.create({
      data: {
        userId: user.id,
        coinId,
        symbol,
        name,
        image,
        quantity,
        purchasePrice,
        purchaseDate,
      },
    });

    return NextResponse.json({ holding }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
}
