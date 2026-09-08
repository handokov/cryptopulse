/**
 * PATCH  /api/portfolio/[id] — update an owned holding.
 * DELETE /api/portfolio/[id] — delete an owned holding.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const holding = await db.holding.findUnique({ where: { id } });
    if (!holding || holding.userId !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const body = (await req.json()) as {
      quantity?: unknown;
      purchasePrice?: unknown;
      purchaseDate?: unknown;
      coinId?: unknown;
      symbol?: unknown;
      name?: unknown;
      image?: unknown;
    };

    const data: {
      quantity?: number;
      purchasePrice?: number;
      purchaseDate?: Date;
      coinId?: string;
      symbol?: string;
      name?: string;
      image?: string | null;
    } = {};

    if (body.quantity !== undefined) {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.quantity = q;
    }
    if (body.purchasePrice !== undefined) {
      const p = Number(body.purchasePrice);
      if (!Number.isFinite(p) || p <= 0) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.purchasePrice = p;
    }
    if (body.purchaseDate !== undefined) {
      const d = new Date(String(body.purchaseDate));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.purchaseDate = d;
    }
    if (body.coinId !== undefined) {
      if (typeof body.coinId !== "string" || !body.coinId.trim()) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.coinId = body.coinId.trim();
    }
    if (body.symbol !== undefined) {
      if (typeof body.symbol !== "string" || !body.symbol.trim()) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.symbol = body.symbol.trim();
    }
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "validation" }, { status: 400 });
      }
      data.name = body.name.trim();
    }
    if (body.image !== undefined) {
      data.image =
        typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
    }

    const updated = await db.holding.update({ where: { id }, data });
    return NextResponse.json({ holding: updated });
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const holding = await db.holding.findUnique({ where: { id } });
    if (!holding || holding.userId !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await db.holding.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
