/**
 * DELETE /api/exchange-connections/[id] — remove a connection and every
 * holding it imported. Manual holdings (connectionId = null) are untouched.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const conn = await db.exchangeConnection.findUnique({ where: { id } });
  if (!conn || conn.userId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.holding.deleteMany({ where: { connectionId: conn.id, userId: user.id } });
  await db.exchangeConnection.delete({ where: { id: conn.id } });

  return NextResponse.json({ ok: true });
}
