import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/**
 * POST /api/auth/reset-password
 * Consumes a one-time reset token and sets a new password.
 *
 * Flow: token (from the emailed link) → SHA-256 → lookup →
 * must be unused and unexpired → password updated, token marked used,
 * and any other outstanding tokens for the user are invalidated too.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: unknown; password?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token || password.length < 6) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }

    const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }

    const now = new Date();
    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: { passwordHash: hashPassword(password) },
      }),
      db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
      // Single-use hygiene: burn any other outstanding tokens for this user.
      db.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
