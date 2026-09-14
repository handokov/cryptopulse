/**
 * GET /api/market/movers?minVol=50000&limit=300 — Bitget USDT spot movers
 * for the markets-section dropdown (gainers / losers / volume tabs).
 * Server-cached upstream (60 s tickers / 10 min symbols) — cheap to poll.
 */

import { NextResponse } from "next/server";
import { getBitgetMovers } from "@/lib/market/movers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawVol = Number(params.get("minVol") ?? "50000");
  const minVol = Number.isFinite(rawVol) && rawVol >= 0 ? rawVol : 50000;
  const rawLimit = Number(params.get("limit") ?? "300");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 10), 500) : 300;

  try {
    const result = await getBitgetMovers(minVol, limit);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
