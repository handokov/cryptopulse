/**
 * Roundtrip verification of the 3 bot tables on the REMOTE Turso database.
 *
 * Proves the production schema is not just present but WRITABLE:
 *   1. insert a temporary user
 *   2. insert BotConfig + BotPosition + BotTrade for that user
 *   3. read them back (join config→trades, positions)
 *   4. delete the user → ON DELETE CASCADE must wipe all 3 bot rows
 *   5. confirm the tables are empty again
 *
 * Credentials come from the environment only:
 *   TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=eyJ...
 *
 * Run: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso-verify-bot-tables.mjs
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.')
  process.exit(1)
}

const client = createClient({ url, authToken })
const stamp = Date.now()
const userId = `verify-bot-${stamp}`
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

try {
  // 1. temp user
  await client.execute({
    sql: `INSERT INTO User (id, email, name, passwordHash, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [userId, `${userId}@verify.local`, 'Bot Table Verifier', 'x'.repeat(64)],
  })

  // 2. bot config + position + trade
  const configId = `cfg-${stamp}`
  const posId = `pos-${stamp}`
  const tradeId = `trd-${stamp}`
  await client.execute({
    sql: `INSERT INTO BotConfig (id, userId, mode, symbol, paper, enabled, orderSizeUsdt,
              maxTradesPerDay, dailyLossLimitUsdt, createdAt, updatedAt)
          VALUES (?, ?, 'MODERATE', 'BTCUSDT', 1, 0, 1.5, 4, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [configId, userId],
  })
  await client.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty,
              sizeUsdt, paper, stopPrice, targetPrice, status, openedAt)
          VALUES (?, ?, ?, 'BTCUSDT', 'LONG', 50000.0, 0.00003, 1.5, 1, 49400.0, 50900.0, 'OPEN', CURRENT_TIMESTAMP)`,
    args: [posId, userId, configId],
  })
  await client.execute({
    sql: `INSERT INTO BotTrade (id, userId, configId, symbol, action, paper, sizeUsdt, qty,
              price, status, reason, detail, createdAt)
          VALUES (?, ?, ?, 'BTCUSDT', 'BUY', 1, 1.5, 0.00003, 50000.0, 'PAPER',
              'score 0.71 >= 0.55', '{"score":0.71,"r2":0.5}', CURRENT_TIMESTAMP)`,
    args: [tradeId, userId, configId],
  })

  // 3. read back
  const cfg = await client.execute({
    sql: `SELECT c.orderSizeUsdt, c.mode,
                 (SELECT COUNT(*) FROM BotPosition p WHERE p.configId = c.id) AS positions,
                 (SELECT COUNT(*) FROM BotTrade t   WHERE t.configId = c.id) AS trades
          FROM BotConfig c WHERE c.userId = ?`,
    args: [userId],
  })
  const row = cfg.rows[0]
  check(
    'BotConfig + relations readable',
    Number(row.orderSizeUsdt) === 1.5 &&
      row.mode === 'MODERATE' &&
      Number(row.positions) === 1 &&
      Number(row.trades) === 1,
    `orderSize=${row.orderSizeUsdt} mode=${row.mode} positions=${row.positions} trades=${row.trades}`,
  )

  // 4. cascade delete
  await client.execute({ sql: `DELETE FROM User WHERE id = ?`, args: [userId] })
  const after = await client.execute(
    `SELECT
       (SELECT COUNT(*) FROM BotConfig   WHERE userId = '${userId}') AS cfg,
       (SELECT COUNT(*) FROM BotPosition WHERE userId = '${userId}') AS pos,
       (SELECT COUNT(*) FROM BotTrade    WHERE userId = '${userId}') AS trd`,
  )
  const a = after.rows[0]
  check(
    'ON DELETE CASCADE wipes bot rows',
    Number(a.cfg) === 0 && Number(a.pos) === 0 && Number(a.trd) === 0,
    `config=${a.cfg} positions=${a.pos} trades=${a.trd}`,
  )
} catch (err) {
  check('roundtrip', false, String(err))
  // best-effort cleanup so a failed run never leaves debris
  try {
    await client.execute({ sql: `DELETE FROM User WHERE id = ?`, args: [userId] })
  } catch {}
} finally {
  client.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL PASSED' : `\n${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
