/**
 * GET  /api/alerts — list the authenticated user's price alerts with the
 *                    current price of each coin; auto-triggers any alert
 *                    whose condition is met (returns newly triggered ones).
 * POST /api/alerts — create a price alert (max 10 per user, dedupe guard).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { findTopCoin } from "@/lib/top100";
import { fetchSimplePrices } from "@/lib/coin-prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const alerts = await db.priceAlert.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  /* Resolve current prices: live fetch, then top-100 board fallback. */
  const coinIds = [...new Set(alerts.map((a) => a.coinId))];
  const { map: liveMap } = await fetchSimplePrices(coinIds);
  const priceFor = (coinId: string): number | null => {
    if (liveMap[coinId]?.usd != null) return liveMap[coinId].usd;
    const board = findTopCoin(coinId);
    return board ? board.price : null;
  };

  const newlyTriggered: Array<{ id: string; symbol: string; name: string; targetPrice: number }> = [];

  const enriched = await Promise.all(
    alerts.map(async (a) => {
      const currentPrice = priceFor(a.coinId);

      /* Auto-trigger with arm/crossing semantics:
         - never-armed alert (baselinePrice null): fires as soon as the
           condition holds (level semantics), otherwise gets armed at the
           current price.
         - armed alert: fires only on a FRESH crossing of the target, i.e.
           the price must move from the "not yet" side to the target side.
           This prevents an instant re-fire loop after re-arm. */
      if (!a.triggered && currentPrice != null) {
        const beyond =
          a.direction === "above"
            ? currentPrice >= a.targetPrice
            : currentPrice <= a.targetPrice;

        let shouldFire = false;
        let armAt: number | null = null;

        if (a.baselinePrice == null) {
          if (beyond) {
            shouldFire = true; // level semantics on first check
          } else {
            armAt = currentPrice; // arm: wait for a fresh crossing
          }
        } else if (a.direction === "above") {
          shouldFire = a.baselinePrice < a.targetPrice && currentPrice >= a.targetPrice;
        } else {
          shouldFire = a.baselinePrice > a.targetPrice && currentPrice <= a.targetPrice;
        }

        if (shouldFire || armAt != null) {
          const triggeredAt = shouldFire ? new Date() : null;
          try {
            await db.priceAlert.update({
              where: { id: a.id },
              data: {
                ...(shouldFire ? { triggered: true, triggeredAt } : {}),
                baselinePrice: shouldFire ? a.baselinePrice : armAt,
              },
            });
            if (shouldFire) {
              a = { ...a, triggered: true, triggeredAt };
              newlyTriggered.push({
                id: a.id,
                symbol: a.symbol,
                name: a.name,
                targetPrice: a.targetPrice,
              });
            } else {
              a = { ...a, baselinePrice: armAt };
            }
          } catch {
            /* leave as untriggered on update failure */
          }
        }
      }

      return {
        id: a.id,
        coinId: a.coinId,
        symbol: a.symbol,
        name: a.name,
        image: a.image,
        direction: a.direction,
        targetPrice: a.targetPrice,
        triggered: a.triggered,
        triggeredAt: a.triggeredAt ? a.triggeredAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        currentPrice,
      };
    })
  );

  return NextResponse.json({ alerts: enriched, newlyTriggered });
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
      targetPrice?: unknown;
      direction?: unknown;
    };

    const coinId = typeof body.coinId === "string" ? body.coinId.trim() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const image =
      typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
    const targetPrice = Number(body.targetPrice);
    const direction = body.direction;

    const valid =
      coinId.length > 0 &&
      symbol.length > 0 &&
      name.length > 0 &&
      Number.isFinite(targetPrice) &&
      targetPrice > 0 &&
      (direction === "above" || direction === "below");
    if (!valid) return NextResponse.json({ error: "validation" }, { status: 400 });

    const count = await db.priceAlert.count({ where: { userId: user.id } });
    if (count >= 10) return NextResponse.json({ error: "limit" }, { status: 409 });

    const duplicate = await db.priceAlert.findFirst({
      where: { userId: user.id, coinId, direction, targetPrice },
    });
    if (duplicate) return NextResponse.json({ error: "duplicate" }, { status: 409 });

    const alert = await db.priceAlert.create({
      data: { userId: user.id, coinId, symbol, name, image, targetPrice, direction },
    });

    return NextResponse.json({ alert }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
}
