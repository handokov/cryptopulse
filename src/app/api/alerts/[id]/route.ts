/**
 * PATCH  /api/alerts/[id] — re-arm a triggered alert (triggered=false).
 *                         Snapshots the current price as the new baseline so
 *                         the alert only fires again on a FRESH crossing.
 * DELETE /api/alerts/[id] — remove an alert.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { findTopCoin } from "@/lib/top100";
import { fetchSimplePrices } from "@/lib/coin-prices";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = (await req.json()) as { triggered?: unknown };
    if (body?.triggered !== false) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const alert = await db.priceAlert.findUnique({ where: { id } });
  if (!alert || alert.userId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  /* Baseline for crossing detection: snapshot the live price (board fallback).
     If no price is available, use the target itself as a neutral sentinel —
     an "above" alert needs baseline < target, so it will not false-fire. */
  const { map } = await fetchSimplePrices([alert.coinId]);
  const livePrice =
    map[alert.coinId]?.usd ?? findTopCoin(alert.coinId)?.price ?? null;
  const baselinePrice = livePrice ?? alert.targetPrice;

  const updated = await db.priceAlert.update({
    where: { id },
    data: { triggered: false, triggeredAt: null, baselinePrice },
  });

  return NextResponse.json({ alert: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const alert = await db.priceAlert.findUnique({ where: { id } });
  if (!alert || alert.userId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.priceAlert.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
