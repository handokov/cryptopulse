/**
 * POST /api/exchange-connections/[id]/sync — re-fetch balances from the
 * exchange and re-mirror the connection's imported holdings.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ExchangeError } from "@/lib/exchanges";
import { syncConnection } from "@/lib/exchanges/sync";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const outcome = await syncConnection(id, user.id);
    return NextResponse.json({ outcome });
  } catch (err) {
    if (err instanceof ExchangeError) {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    // A connection the user does not own also lands here as "unexpected".
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
