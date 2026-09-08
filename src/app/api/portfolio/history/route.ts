/**
 * GET /api/portfolio/history — the authenticated user's daily portfolio
 * value snapshots for the last N days (default 30, clamped 7..90).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let days = 30;
  try {
    const raw = new URL(req.url).searchParams.get("days");
    if (raw != null) days = Number.parseInt(raw, 10);
  } catch {
    /* keep default */
  }
  if (!Number.isFinite(days)) days = 30;
  days = Math.min(90, Math.max(7, days));

  const since = new Date(Date.now() - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await db.portfolioSnapshot.findMany({
    where: { userId: user.id, date: { gte: since } },
    orderBy: { date: "asc" }, // ISO "YYYY-MM-DD" strings sort correctly
    select: { date: true, totalValue: true, totalCost: true },
  });

  return NextResponse.json({
    snapshots: rows.map((r) => ({
      date: r.date,
      totalValue: r.totalValue,
      totalCost: r.totalCost,
    })),
  });
}
