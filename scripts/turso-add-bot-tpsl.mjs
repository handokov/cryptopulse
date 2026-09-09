/**
 * Add the Task 21 bot columns to the REMOTE Turso BotConfig table.
 *
 * turso-apply-schema.mjs only issues CREATE ... IF NOT EXISTS, which never
 * alters existing tables — so new columns need explicit ALTERs. This script
 * checks PRAGMA table_info first, making it safe to re-run.
 *
 * Columns added:
 *   takeProfitPct REAL  — optional user TP override (null = mode preset)
 *   stopLossPct   REAL  — optional user SL override (null = mode preset)
 *
 * Run: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso-add-bot-tpsl.mjs
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.')
  process.exit(1)
}

const client = createClient({ url, authToken })
try {
  const info = await client.execute('PRAGMA table_info(BotConfig)')
  const cols = new Set(info.rows.map((r) => r.name))
  console.log('Existing BotConfig columns:', [...cols].join(', '))

  if (!cols.has('takeProfitPct')) {
    await client.execute('ALTER TABLE BotConfig ADD COLUMN takeProfitPct REAL')
    console.log('ADDED takeProfitPct REAL')
  } else {
    console.log('takeProfitPct already present — skip')
  }
  if (!cols.has('stopLossPct')) {
    await client.execute('ALTER TABLE BotConfig ADD COLUMN stopLossPct REAL')
    console.log('ADDED stopLossPct REAL')
  } else {
    console.log('stopLossPct already present — skip')
  }

  const after = await client.execute('PRAGMA table_info(BotConfig)')
  console.log('Final columns:', after.rows.map((r) => r.name).join(', '))
  console.log('Done — BotConfig TP/SL columns are live.')
} catch (err) {
  console.error('FAILED:', err)
  process.exit(1)
} finally {
  client.close()
}
