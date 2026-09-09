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
 * Idempotence: every CREATE statement is rewritten to `... IF NOT EXISTS`,
 * so the script is safe to re-run as the schema evolves (additive changes
 * only — column alterations still need manual care).
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
const rawDdl = execSync(
  'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
  { cwd: PROJECT_ROOT, encoding: 'utf8', env: process.env },
)
// Make idempotent: skip objects that already exist on the remote DB.
const ddl = rawDdl
  .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
  .replace(/CREATE UNIQUE INDEX /g, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
  .replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ')
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
