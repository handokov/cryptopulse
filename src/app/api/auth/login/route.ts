import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    const user = email ? await db.user.findUnique({ where: { email } }) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }

    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch {
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
