/**
 * POST /api/exchange-connections/[id]/sync — re-fetch balances from the
 * exchange and re-mirror the connection's imported holdings.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ExchangeError } from "@/lib/exchanges";
import { syncConnection } from "@/lib/exchanges/sync";
import { probeAndStoreTradePermission } from "@/lib/exchanges/trade-permission";
import { ensureBotColumns } from "@/lib/bot/migrate";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

  const { id } = await params;
  try {
    const outcome = await syncConnection(id, user.id);
    // Re-probe the Bitget spot-trade permission on every manual sync so the
    // badge tracks the live key (e.g. after the user enables Trade scope).
    // Probe failure never fails the sync.
    try {
      await probeAndStoreTradePermission(id);
    } catch (err) {
      console.error("[exchange-sync] trade-permission probe failed:", err instanceof Error ? err.message : err);
    }
    return NextResponse.json({ outcome });
  } catch (err) {
    if (err instanceof ExchangeError) {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    // A connection the user does not own also lands here as "unexpected".
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
