/**
 * Roundtrip verification of the REAL production code path (src/lib/db.ts
 * dual-mode client) against the remote Turso database.
 *
 * Proves three things at once:
 *   1. @prisma/adapter-libsql accepts our PrismaLibSQL config at runtime
 *      (not just at type-check time).
 *   2. The remote schema (pushed by turso-apply-schema.mjs) matches what
 *      Prisma Client expects — User/Holding/Alert/Connection relations resolve.
 *   3. Writes and reads actually land on the remote database.
 *
 * Creates one throwaway user, reads it back through relations, deletes it.
 *
 * Run: NODE_ENV=production TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *      bun scripts/turso-verify.ts
 */
import { db } from '../src/lib/db'

const stamp = Date.now()
const email = `deploy-verify-${stamp}@cryptopulse.test`

console.log('[1/4] Creating throwaway user on the remote DB ...')
const created = await db.user.create({
  data: { email, passwordHash: 'verify-only-not-a-real-hash' },
})
console.log('      created id =', created.id)

console.log('[2/4] Reading back + counting relations ...')
const found = await db.user.findUnique({
  where: { id: created.id },
  include: { holdings: true, alerts: true, exchanges: true, snapshots: true },
})
if (!found || found.email !== email) throw new Error('Roundtrip read failed')
console.log(
  `      read ok — holdings=${found.holdings.length} alerts=${found.alerts.length} exchanges=${found.exchanges.length} snapshots=${found.snapshots.length}`,
)

console.log('[3/4] Cleaning up ...')
await db.user.delete({ where: { id: created.id } })
const remaining = await db.user.count()
console.log('      deleted; users left on remote DB =', remaining)

console.log('[4/4] Disconnecting ...')
await db.$disconnect()
console.log('TURSO ROUNDTRIP OK — adapter, schema and credentials all work.')
