/**
 * Server-only credential encryption: AES-256-GCM for exchange API secrets.
 *
 * Format: iv.tag.ciphertext (all base64). The key is derived once per process
 * via scrypt from CREDENTIAL_SECRET (falls back to the dev secret like the
 * session signer in auth.ts — set CREDENTIAL_SECRET in production).
 *
 * Plaintext secrets exist ONLY inside a sync request's lifetime; API responses
 * never include them (routes return apiKeyMasked instead).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KEY = scryptSync(
  process.env.CREDENTIAL_SECRET ?? "cryptopulse-dev-secret-change-me",
  "cryptopulse-credential-salt",
  32
);

/** Encrypt a plaintext credential → "iv.tag.ciphertext" (base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

/**
 * Decrypt an "iv.tag.ciphertext" payload. Throws on tamper (GCM auth).
 * An empty ciphertext segment is VALID (encrypting "" — e.g. the demo
 * adapter stores empty credentials) and decrypts to "".
 */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || dataB64 === undefined) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(dataB64 ? Buffer.from(dataB64, "base64") : Buffer.alloc(0)),
    decipher.final(),
  ]).toString("utf8");
}

/** Display-safe key form: first 4 + "••••" + last 4 characters. */
export function maskSecret(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}
