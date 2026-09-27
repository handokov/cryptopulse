/**
 * Honest 30-day projection for a $50/trade bot (user question: "PUMPUSDT contoh").
 * Steps:
 *  1. Pull ALL closed cycles from production Turso (any symbol incl. PUMPUSDT if present).
 *  2. Per-symbol + pooled stats: WR, avgWin%, avgLoss%, expectancy%/cycle, cycles/day.
 *  3. Closed-form + Monte Carlo (10k runs) 30-day projection at $50/trade:
 *     P5 / P25 / median / P75 / P95, expected profit AND expected loss components.
 * Secrets never touch this file — env vars only.
 */
import { createClient } from '@libsql/client'
import fs from 'node:fs'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  // fallback: parse .env (gitignored)
  const env = fs.readFileSync('.env', 'utf8')
  const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim()
  process.env.TURSO_DATABASE_URL = get('TURSO_DATABASE_URL')
  process.env.TURSO_AUTH_TOKEN = get('TURSO_AUTH_TOKEN')
}
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })

const FEE_RT = 0.002 // 0.1%/side round trip — embedded since Patch C for NEW data; older rows are gross

// ---- 1. Load closed cycles
const res = await client.execute(
  `SELECT p.configId, p.sizeUsdt, p.realizedPnlUsdt, p.exitReason, p.openedAt, p.closedAt, c.symbol
   FROM BotPosition p LEFT JOIN BotConfig c ON c.id = p.configId
   WHERE p.status='CLOSED' AND p.closedAt IS NOT NULL
   ORDER BY p.closedAt ASC`
)
const rows = res.rows.map((r) => ({
  symbol: (r.symbol || 'UNKNOWN').toUpperCase(),
  size: Number(r.sizeUsdt) || 0,
  pnl: Number(r.realizedPnlUsdt) || 0,
  closedAt: String(r.closedAt),
}))
console.log(`Total closed cycles: ${rows.length}`)
const symbols = [...new Set(rows.map((r) => r.symbol))]
console.log('Symbols in DB:', symbols.join(', '))

// ---- 2. Stats helper (pct-of-size basis so $50 projection is apples-to-apples)
function stats(list, label) {
  if (!list.length) return console.log(`\n[${label}] no data`)
  const wins = list.filter((r) => r.pnl > 0)
  const losses = list.filter((r) => r.pnl <= 0)
  const wr = wins.length / list.length
  const awPct = wins.length ? (wins.reduce((s, r) => s + r.pnl / r.size, 0) / wins.length) * 100 : 0
  const alPct = losses.length ? (losses.reduce((s, r) => s + r.pnl / r.size, 0) / losses.length) * 100 : 0
  const expPct = wr * awPct + (1 - wr) * alPct
  const days = new Set(list.map((r) => r.closedAt.slice(0, 10)))
  const cpd = list.length / Math.max(1, days.size)
  const totPnl = list.reduce((s, r) => s + r.pnl, 0)
  console.log(
    `\n[${label}] n=${list.length} hariAktif=${days.size} cycles/day=${cpd.toFixed(1)}`
  )
  console.log(
    `  WR=${(wr * 100).toFixed(0)}%  avgWin=${awPct >= 0 ? '+' : ''}${awPct.toFixed(2)}%  avgLoss=${alPct.toFixed(2)}%  expectancy=${expPct >= 0 ? '+' : ''}${expPct.toFixed(2)}%/cycle  totalPnL=${totPnl >= 0 ? '+' : '-'}$${Math.abs(totPnl).toFixed(2)}`
  )
  return { wr, awPct, alPct, expPct, cpd, n: list.length }
}

console.log('\n=== PER-SYMBOL ===')
const perSym = {}
for (const s of symbols) perSym[s] = stats(rows.filter((r) => r.symbol === s), s)

const pump = rows.filter((r) => r.symbol.includes('PUMP'))
stats(pump, 'PUMPUSDT (jika ada)')

console.log('\n=== POOLED (semua paper, basis %/cycle utk proyeksi $50) ===')
const paper = rows.filter((r) => r.size > 0)
const pooled = stats(paper, 'ALL')

// ---- 3. 30-day projection at $50/trade, Monte Carlo 10k
// Uses pooled per-cycle pct distribution resampled at projected cycles/month,
// plus a binomial parametric variant. Size fixed $50 (compounding off — konservatif).
const SIZE = 50
const DAYS = 30
function project(cyclesPerDay, draws) {
  const n = Math.round(cyclesPerDay * DAYS)
  const out = new Array(draws)
  for (let d = 0; d < draws; d++) {
    let pnl = 0
    for (let i = 0; i < n; i++) {
      const r = paper[Math.floor(Math.random() * paper.length)]
      pnl += (r.pnl / r.size) * SIZE
    }
    out[d] = pnl
  }
  out.sort((a, b) => a - b)
  const q = (p) => out[Math.floor(p * (draws - 1))]
  const mean = out.reduce((s, v) => s + v, 0) / draws
  const win = out.filter((v) => v > 0).length / draws
  return { n, mean, win, p5: q(0.05), p25: q(0.25), med: q(0.5), p75: q(0.75), p95: q(0.95) }
}

console.log('\n=== PROYEKSI 30 HARI @$50/trade (Monte Carlo 10.000x, resample distribusi asli) ===')
for (const cpd of [2, 5, 10]) {
  const r = project(cpd, 10000)
  console.log(
    `  ${String(cpd * DAYS).padStart(3)} cycle/bln (${cpd}/hari): median ${r.med >= 0 ? '+' : '-'}$${Math.abs(r.med).toFixed(0)}  |  P5 ${r.p5.toFixed(0)}  P25 ${r.p25.toFixed(0)}  P75 +${r.p75.toFixed(0)}  P95 +${r.p95.toFixed(0)}  | mean ${r.mean.toFixed(1)}  | P(profit)=${(r.win * 100).toFixed(0)}%`
  )
}

// ---- 5. PUMPUSDT-only: Monte Carlo + profit/loss decomposition (jawaban persis user)
console.log('\n=== PUMPUSDT-ONLY @$50/trade, 30 HARI (resample 6 siklus asli — SAMPEL KECIL!) ===')
const pumpCycles = pump.length ? pump : paper
function decompose(list, cyclesPerDay) {
  const n = Math.round(cyclesPerDay * DAYS)
  const wins = list.filter((r) => r.pnl > 0)
  const losses = list.filter((r) => r.pnl <= 0)
  const wr = wins.length / list.length
  const awUsd = (wins.reduce((s, r) => s + r.pnl / r.size, 0) / wins.length) * SIZE // pnl/size sudah fraksi
  const alUsd = (losses.reduce((s, r) => s + r.pnl / r.size, 0) / losses.length) * SIZE
  const grossWin = wr * n * awUsd
  const grossLoss = (1 - wr) * n * alUsd
  return { n, wr, awUsd, alUsd, grossWin, grossLoss, net: grossWin + grossLoss }
}
for (const cpd of [1, 3, 5]) {
  const d = decompose(pumpCycles, cpd)
  console.log(
    `  ${d.n} cycle/bln (${cpd}/hari): PROFIT total +$${d.grossWin.toFixed(0)} (${Math.round(d.wr * d.n)}x menang @$${d.awUsd.toFixed(2)})  |  LOSS total -$${Math.abs(d.grossLoss).toFixed(0)} (${Math.round((1 - d.wr) * d.n)}x kalah @$${d.alUsd.toFixed(2)})  |  NET = ${d.net >= 0 ? '+' : '-'}$${Math.abs(d.net).toFixed(0)}/bln`
  )
}
function projectList(list, cyclesPerDay, draws = 10000) {
  const n = Math.round(cyclesPerDay * DAYS)
  const out = new Array(draws)
  for (let d = 0; d < draws; d++) {
    let pnl = 0
    for (let i = 0; i < n; i++) {
      const r = list[Math.floor(Math.random() * list.length)]
      pnl += (r.pnl / r.size) * SIZE
    }
    out[d] = pnl
  }
  out.sort((a, b) => a - b)
  const q = (p) => out[Math.floor(p * (draws - 1))]
  const win = out.filter((v) => v > 0).length / draws
  return { p5: q(0.05), p25: q(0.25), med: q(0.5), p75: q(0.75), p95: q(0.95), win }
}
const pr = projectList(pumpCycles, 3)
console.log(
  `  Monte Carlo PUMP 90 cycle/bln: P5 ${pr.p5.toFixed(0)}  P25 ${pr.p25.toFixed(0)}  median ${pr.med >= 0 ? '+' : '-'}$${Math.abs(pr.med).toFixed(0)}  P75 +${pr.p75.toFixed(0)}  P95 +${pr.p95.toFixed(0)}  | P(profit)=${(pr.win * 100).toFixed(0)}%`
)

// ---- 6. Net-of-fee adjustment utk siklus pre-Patch C (gross → net −0.2%/cycle)
console.log('\n=== SENSITIVITAS FEE (jika siklus PUMP masih pre-Patch C / gross) ===')
const pumpNetExp = pump.length
  ? pump.reduce((s, r) => s + (r.pnl / r.size) * 100, 0) / pump.length - FEE_RT * 100
  : 0
console.log(
  `  Expectancy PUMP gross +0.81% → net kira-kira ${pumpNetExp >= 0 ? '+' : ''}${pumpNetExp.toFixed(2)}%/cycle; @90 cycle/bln = ${pumpNetExp >= 0 ? '+' : ''}$${((pumpNetExp / 100) * SIZE * 90).toFixed(0)}/bln`
)

// ---- 4. Parametric: what WR is needed for +$250/mo at various trade counts
console.log('\n=== WR MINIMUM UNTUK TARGET (parametrik, avgWin=+2.6%net avgLoss=-3.4%net @$50) ===')
const AW = 2.6, AL = -3.4
for (const cpd of [2, 5, 10]) {
  const n = cpd * DAYS
  for (const target of [100, 250, 300]) {
    // solve: n*SIZE*(wr*AW + (1-wr)*AL)/100 = target
    const wr = (target / (n * SIZE) + -AL / 100) / ((AW - AL) / 100)
    console.log(`  ${n} cycle/bln → target +$${target}/bln butuh WR=${(wr * 100).toFixed(1)}%`)
  }
}
