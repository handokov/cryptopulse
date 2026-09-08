/**
 * Push the Prisma schema (DDL) to the remote Turso (libSQL) database.
 *
 * Why not `prisma db push`? The Prisma 6 sqlite connector only speaks file:
 * URLs, so the CLI cannot reach libsql:// endpoints. Instead we:
 *   1. Generate deterministic SQLite DDL with `prisma migrate diff --from-empty`.
 *   2. Apply it over HTTP via @libsql/client (executeMultiple).
 *
 * Credentials come from the environment only — never hardcode them here:
 *   TURSO_DATABASE_URL=libsql://...   TURSO_AUTH_TOKEN=eyJ...
 *
 * Idempotence: designed for an EMPTY database. Re-running on an existing
 * schema fails on CREATE TABLE — that is a safe guard, not a bug.
 *
 * Run: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso-apply-schema.mjs
 */
import { execSync } from 'node:child_process'
import { createClient } from '@libsql/client'

const PROJECT_ROOT = new URL('..', import.meta.url).pathname

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.')
  process.exit(1)
}

console.log('[1/3] Generating DDL from prisma/schema.prisma ...')
const ddl = execSync(
  'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
  { cwd: PROJECT_ROOT, encoding: 'utf8', env: process.env },
)
console.log('--- DDL start ---')
console.log(ddl)
console.log('--- DDL end ---')

console.log('[2/3] Connecting to', url, 'and applying schema ...')
const client = createClient({ url, authToken })
await client.executeMultiple(ddl)

console.log('[3/3] Verifying tables on the remote database ...')
const res = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
)
console.log('Tables:', res.rows.map((r) => r.name).join(', '))

client.close()
console.log('Done — Turso schema is live.')
