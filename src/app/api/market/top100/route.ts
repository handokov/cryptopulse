/**
 * GET /api/market/top100 — CoinGecko top-100 by market cap with a
 * module-level TTL cache and last-good fallback on upstream failure.
 */

import { NextResponse } from "next/server";
import { getTop100 } from "@/lib/top100";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getTop100();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
