import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/auth/forgot-password
 * Creates a one-time password reset token (1 h TTL) and emails the link.
 *
 * Security notes:
 * - The response is CONSTANT regardless of whether the email is registered
 *   (anti-enumeration) — the only variable parts are the actual email send
 *   and the dev-only reset URL (never exposed for unknown emails).
 * - Only the SHA-256 hash of the token is stored; the raw token lives
 *   exclusively inside the reset link.
 * - In-memory rate limit: 3 requests / 10 min per email, 10 / 10 min per IP.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const LOCALES = new Set(["en", "id", "zh", "es", "pt", "ja"]);

/* ---------- tiny in-memory rate limiter (per serverless instance) ---------- */

const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

/* ---------- localized email copy (kept inline — 6 locales) ---------- */

interface ResetEmailTpl {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  expiry: string;
  ignore: string;
}

const EMAIL_TPL: Record<string, ResetEmailTpl> = {
  en: {
    subject: "CryptoPulse — reset your password",
    heading: "Password reset request",
    body: "We received a request to reset the password for your CryptoPulse account.",
    cta: "Reset password",
    expiry: "This link expires in 60 minutes.",
    ignore: "If you didn't request this, you can safely ignore this email.",
  },
  id: {
    subject: "CryptoPulse — atur ulang password",
    heading: "Permintaan atur ulang password",
    body: "Kami menerima permintaan untuk mengatur ulang password akun CryptoPulse Anda.",
    cta: "Atur password",
    expiry: "Tautan ini kedaluwarsa dalam 60 menit.",
    ignore: "Jika Anda tidak meminta ini, abaikan saja email ini.",
  },
  zh: {
    subject: "CryptoPulse — 重置密码",
    heading: "密码重置请求",
    body: "我们收到了重置您 CryptoPulse 账户密码的请求。",
    cta: "重置密码",
    expiry: "此链接将在 60 分钟后失效。",
    ignore: "如果您没有发起此请求，请忽略本邮件。",
  },
  es: {
    subject: "CryptoPulse — restablece tu contraseña",
    heading: "Solicitud de restablecimiento",
    body: "Recibimos una solicitud para restablecer la contraseña de tu cuenta de CryptoPulse.",
    cta: "Restablecer contraseña",
    expiry: "Este enlace caduca en 60 minutos.",
    ignore: "Si no solicitaste esto, puedes ignorar este correo.",
  },
  pt: {
    subject: "CryptoPulse — redefina sua senha",
    heading: "Solicitação de redefinição de senha",
    body: "Recebemos uma solicitação para redefinir a senha da sua conta CryptoPulse.",
    cta: "Redefinir senha",
    expiry: "Este link expira em 60 minutos.",
    ignore: "Se você não solicitou isso, ignore este e-mail.",
  },
  ja: {
    subject: "CryptoPulse — パスワードのリセット",
    heading: "パスワードリセットのリクエスト",
    body: "CryptoPulse アカウントのパスワード再設定リクエストを受け付けました。",
    cta: "パスワードをリセット",
    expiry: "このリンクは60分で無効になります。",
    ignore: "心当たりがない場合は、このメールを無視してください。",
  },
};

/* ---------- reset email via Resend REST (no SDK dependency) ---------- */

async function sendResetEmail(to: string, url: string, locale: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const tpl = EMAIL_TPL[locale] ?? EMAIL_TPL.en!;
  const html = [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0f0d;font-family:Arial,Helvetica,sans-serif;">`,
    `<div style="max-width:480px;margin:0 auto;background:#101915;border:1px solid #1f2d26;border-radius:16px;padding:28px;">`,
    `<h1 style="margin:0 0 8px;font-size:18px;color:#e7f5ee;">${tpl.heading}</h1>`,
    `<p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#9fb8ac;">${tpl.body}</p>`,
    `<a href="${url}" style="display:inline-block;background:#10b981;color:#04110b;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;text-decoration:none;">${tpl.cta}</a>`,
    `<p style="margin:20px 0 0;font-size:11px;color:#6b8579;">${tpl.expiry}</p>`,
    `<p style="margin:6px 0 0;font-size:11px;color:#6b8579;">${tpl.ignore}</p>`,
    `<p style="margin:16px 0 0;font-size:11px;word-break:break-all;color:#6b8579;">${url}</p>`,
    `</div></body></html>`,
  ].join("");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "CryptoPulse <onboarding@resend.dev>",
        to: [to],
        subject: tpl.subject,
        html,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- public base URL (Vercel proxy aware) ---------- */

function baseUrl(req: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const scheme = proto ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${scheme}://${host}`;
  }
  return new URL(req.url).origin;
}

/* ---------- handler ---------- */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: unknown; locale?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const locale = typeof body.locale === "string" && LOCALES.has(body.locale) ? body.locale : "en";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(`ip:${ip}`, 10, 10 * 60_000) || rateLimited(`email:${email}`, 3, 10 * 60_000)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const providerConfigured = Boolean(process.env.RESEND_API_KEY);
    const user = await db.user.findUnique({ where: { email } });

    // Unknown email — mirror the success shape without doing anything.
    if (!user) {
      return NextResponse.json({ ok: true, emailSent: providerConfigured, devUrl: null });
    }

    // Invalidate any previous unused tokens, then mint a fresh one.
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString("base64url");
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${baseUrl(req)}/?reset=${token}`;

    let emailSent = false;
    if (providerConfigured) {
      emailSent = await sendResetEmail(email, resetUrl, locale);
      if (!emailSent) console.warn(`[forgot-password] Resend delivery failed for ${email}`);
    }

    // Dev convenience: expose the reset URL directly when no email provider
    // is configured. Production never receives devUrl (anti-enumeration).
    const devUrl = !providerConfigured && process.env.NODE_ENV !== "production" ? resetUrl : null;

    return NextResponse.json({ ok: true, emailSent, devUrl });
  } catch {
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
