/**
 * READ-ONLY expectancy analysis from production Turso (BotPosition/BotConfig).
 * Answers: win rate, avg win/loss, expectancy %/cycle, cycles/day, streaks,
 * day distribution, and a $50/trade monthly projection — per paper/live.
 *
 * Secrets never touch this file:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=eyJ... node scripts/turso-expectancy.mjs
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.')
  process.exit(1)
}
const client = createClient({ url, authToken })
const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)
const fmtUsd = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`)
const day = (iso) => new Date(iso).toISOString().slice(0, 10)

const cfgRes = await client.execute(
  `SELECT id, symbol, paper, mode, takeProfitPct, stopLossPct, enabled, timeframe
   FROM BotConfig ORDER BY paper DESC, symbol`
)
const cfgById = new Map(cfgRes.rows.map((r) => [r.id, r]))

console.log('=== BOT CONFIG (aktif & setelan saat ini) ===')
for (const c of cfgRes.rows) {
  console.log(
    `  ${c.symbol}  ${c.paper ? 'paper' : 'LIVE '}  ${c.mode}  TP=${c.takeProfitPct ?? 'preset'}% SL=${c.stopLossPct ?? 'preset'}%  max/d=${c.maxTradesPerDay}  TF=${c.timeframe ?? '4H'}  enabled=${c.enabled ? 1 : 0}`
  )
}

const posRes = await client.execute(
  `SELECT configId, status, paper, sizeUsdt, realizedPnlUsdt, exitReason, openedAt, closedAt
   FROM BotPosition WHERE status='CLOSED' AND closedAt IS NOT NULL ORDER BY closedAt ASC`
)
const rows = posRes.rows
  .map((r) => {
    const size = Number(r.sizeUsdt) || 0
    const pnl = r.realizedPnlUsdt == null ? null : Number(r.realizedPnlUsdt)
    return {
      cfg: cfgById.get(r.configId),
      paper: !!r.paper,
      size,
      pnl,
      pnlPct: pnl != null && size > 0 ? (pnl / size) * 100 : null,
      exit: (r.exitReason || 'other').split(' ')[0].split(':')[0],
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      durH: r.openedAt && r.closedAt ? (new Date(r.closedAt) - new Date(r.openedAt)) / 3_600_000 : null,
    }
  })
  .filter((r) => r.pnl != null && r.pnlPct != null)

if (rows.length === 0) {
  console.log('\nTidak ada posisi CLOSED dengan PnL di produksi.')
  process.exit(0)
}

function analyze(subset, label) {
  const n = subset.length
  if (n === 0) return console.log(`\n=== ${label}: tidak ada data ===`)
  const wins = subset.filter((r) => r.pnlPct > 0)
  const losses = subset.filter((r) => r.pnlPct <= 0)
  const wr = (wins.length / n) * 100
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.pnlPct, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.pnlPct, 0) / losses.length : 0
  const exp = (wr / 100) * avgWin + (1 - wr / 100) * avgLoss
  const totalPnl = subset.reduce((a, r) => a + r.pnl, 0)
  const avgSize = subset.reduce((a, r) => a + r.size, 0) / n
  const avgDur = subset.filter((r) => r.durH != null).reduce((a, r) => a + r.durH, 0) / Math.max(1, subset.filter((r) => r.durH != null).length)

  // streaks
  let curL = 0, maxL = 0, curW = 0, maxW = 0
  for (const r of subset) {
    if (r.pnlPct > 0) { curW++; curL = 0 } else { curL++; curW = 0 }
    maxL = Math.max(maxL, curL); maxW = Math.max(maxW, curW)
  }

  // per-UTC-day cycles & pnl
  const days = new Map()
  for (const r of subset) {
    const d = day(r.closedAt)
    const o = days.get(d) || { n: 0, pnl: 0 }
    o.n++; o.pnl += r.pnl
    days.set(d, o)
  }
  const dayList = [...days.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
  const pnlDays = dayList.filter(([, o]) => o.pnl !== 0)
  const posDays = pnlDays.filter(([, o]) => o.pnl > 0).length
  const negDays = pnlDays.filter(([, o]) => o.pnl < 0).length
  const best = dayList.reduce((a, [d, o]) => (o.pnl > (a?.[1]?.pnl ?? -Infinity) ? [d, o] : a), null)
  const worst = dayList.reduce((a, [d, o]) => (o.pnl < (a?.[1]?.pnl ?? Infinity) ? [d, o] : a), null)
  const spanDays = Math.max(1, (new Date(subset[n - 1].closedAt) - new Date(subset[0].closedAt)) / 86_400_000)
  const cyclesPerDay = n / spanDays

  const exits = {}
  for (const r of subset) exits[r.exit] = (exits[r.exit] || 0) + 1

  console.log(`\n=== ${label} ===`)
  console.log(`  siklus closed : ${n}  (avg size $${avgSize.toFixed(2)}, avg durasi ${avgDur.toFixed(1)} jam, ${cyclesPerDay.toFixed(1)} siklus/hari kalender)`)
  console.log(`  win rate      : ${wr.toFixed(1)}%  (${wins.length}W / ${losses.length}L, streak max ${maxW}W / ${maxL}L)`)
  console.log(`  avg win       : ${fmtPct(avgWin)}   avg loss: ${fmtPct(avgLoss)}   EXPECTANCY: ${fmtPct(exp)}/siklus`)
  console.log(`  total PnL     : ${fmtUsd(totalPnl)}`)
  console.log(`  hari dengan PnL: ${pnlDays.length} (${posDays} profit / ${negDays} rugi); terbaik ${best ? `${best[0]} ${fmtUsd(best[1].pnl)}` : '—'}, terburuk ${worst ? `${worst[0]} ${fmtUsd(worst[1].pnl)}` : '—'}`)
  console.log(`  exit: ${Object.entries(exits).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  const proj50 = 50 * (exp / 100) * cyclesPerDay * 30
  console.log(`  proyeksi @$50/trade: $${proj50.toFixed(2)}/bulan (${(50 * (exp / 100)).toFixed(2)}/siklus × ${cyclesPerDay.toFixed(1)} siklus/hari)`)
}

analyze(rows.filter((r) => r.paper), 'PAPER — ALL TIME')
analyze(rows.filter((r) => !r.paper), 'LIVE — ALL TIME')
analyze(rows.filter((r) => r.paper && new Date(r.closedAt) >= new Date(Date.now() - 30 * 86_400_000)), 'PAPER — 30 HARI TERAKHIR')
analyze(rows.filter((r) => new Date(r.closedAt) >= new Date('2026-09-20T00:00:00Z')), 'SETELAN BARU TP2.5/SL3 (sejak 20 Sep)')

console.log('\n=== 14 HARI TERAKHIR (per hari UTC, semua bot) ===')
for (let i = 13; i >= 0; i--) {
  const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
  const inDay = rows.filter((r) => day(r.closedAt) === d)
  const pnl = inDay.reduce((a, r) => a + r.pnl, 0)
  const w = inDay.filter((r) => r.pnlPct > 0).length
  console.log(`  ${d}  siklus=${String(inDay.length).padStart(2)}  W=${w}  PnL=${fmtUsd(pnl)}`)
}

console.log('\n=== PER SIMBOL (all-time) ===')
const bySym = new Map()
for (const r of rows) {
  const k = `${r.cfg?.symbol ?? '?'} (${r.paper ? 'paper' : 'live'})`
  const o = bySym.get(k) || { n: 0, w: 0, pnl: 0, expSum: 0 }
  o.n++; if (r.pnlPct > 0) o.w++; o.pnl += r.pnl; o.expSum += r.pnlPct
  bySym.set(k, o)
}
for (const [k, o] of [...bySym.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(18)} n=${String(o.n).padStart(3)}  WR=${((o.w / o.n) * 100).toFixed(0).padStart(3)}%  total=${fmtUsd(o.pnl)}`)
}
