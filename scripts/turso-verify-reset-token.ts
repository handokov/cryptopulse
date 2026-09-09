/**
 * Roundtrip verification of the PasswordResetToken flow against the remote
 * Turso database through the REAL production code path (src/lib/db.ts).
 *
 * Proves: model + relation resolve on the remote schema, token CRUD works,
 * and the user FK cascade removes orphaned tokens.
 *
 * Run: NODE_ENV=production TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *      bun scripts/turso-verify-reset-token.ts
 */
import { createHash, randomBytes } from "crypto";
import { db } from "../src/lib/db";

const stamp = Date.now();
const email = `reset-verify-${stamp}@cryptopulse.test`;
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");

console.log("[1/5] Creating throwaway user on the remote DB ...");
const user = await db.user.create({
  data: { email, passwordHash: "verify-only-not-a-real-hash" },
});
console.log("      created id =", user.id);

console.log("[2/5] Minting a reset token ...");
await db.passwordResetToken.create({
  data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
});

console.log("[3/5] Reading back via relation + tokenHash lookup ...");
const found = await db.user.findUnique({
  where: { id: user.id },
  include: { resetTokens: true },
});
if (!found || found.resetTokens.length !== 1 || found.resetTokens[0].tokenHash !== tokenHash) {
  throw new Error("Relation roundtrip failed");
}
const byHash = await db.passwordResetToken.findUnique({ where: { tokenHash } });
if (!byHash || byHash.usedAt !== null) throw new Error("tokenHash lookup failed");
console.log("      relation + unique lookup ok — usedAt is null (fresh)");

console.log("[4/5] Burning the token (updateMany) ...");
const burned = await db.passwordResetToken.updateMany({
  where: { tokenHash, usedAt: null },
  data: { usedAt: new Date() },
});
if (burned.count !== 1) throw new Error("burn failed");
console.log("      burned:", burned.count);

console.log("[5/5] Deleting user — cascade must remove the token ...");
await db.user.delete({ where: { id: user.id } });
const left = await db.passwordResetToken.count();
if (left !== 0) throw new Error(`cascade failed — ${left} token(s) left`);
console.log("      cascade ok — tokens left on remote DB =", left);

await db.$disconnect();
console.log("RESET-TOKEN ROUNDTRIP OK — remote schema matches Prisma Client.");
