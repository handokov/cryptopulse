/**
 * WEEKLY RECAP — READ-ONLY expectancy monitor dari produksi Turso.
 * Tujuan: satu komando untuk menjawab "apakah edge net kita sudah layak diskalakan?"
 *
 * Menampilkan:
 *   1. Bucket mingguan (W1..W4): siklus, WR, avg win/loss, expectancy gross & NET fee
 *   2. Kesehatan per simbol: DEAD / REVIEW / KEEP + usaha aksi
 *   3. Gerbang skala: boleh naik modal atau belum (butuh >=100 siklus & exp net >= +0.3%)
 *   4. Proyeksi & ukuran order minimum untuk target $275/bulan
 *
 * Jalankan:  node scripts/weekly-recap.mjs
 * Env: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (fallback: dibaca dari .env lokal — gitignored)
 * FEE_PCT  : fee round-trip per siklus dalam % (default 0.2 = 0.1% x 2 sisi)
 * TARGET   : target bulanan USD (default 275)
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

const env = {}
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
} catch {}
const url = process.env.TURSO_DATABASE_URL || env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN || env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (env atau .env)')
  process.exit(1)
}
const FEE = parseFloat(process.env.FEE_PCT || '0.2')
const TARGET = parseFloat(process.env.TARGET || '275')
const client = createClient({ url, authToken })
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)
const usd = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`

const cfgRes = await client.execute(`SELECT id, symbol, paper, mode, timeframe, takeProfitPct, stopLossPct, createdAt FROM BotConfig`)
const cfgById = new Map(cfgRes.rows.map((r) => [r.id, r]))
const posRes = await client.execute(
  `SELECT configId, status, paper, sizeUsdt, realizedPnlUsdt, openedAt, closedAt
   FROM BotPosition WHERE status='CLOSED' AND closedAt IS NOT NULL ORDER BY closedAt ASC`
)
const rows = posRes.rows
  .map((r) => {
    const size = Number(r.sizeUsdt) || 0
    const pnl = r.realizedPnlUsdt == null ? null : Number(r.realizedPnlUsdt)
    return {
      sym: cfgById.get(r.configId)?.symbol ?? '?',
      paper: !!r.paper,
      cfgCreated: cfgById.get(r.configId)?.createdAt ?? null,
      size, pnl,
      pnlPct: pnl != null && size > 0 ? (pnl / size) * 100 : null,
      closedAt: r.closedAt,
    }
  })
  .filter((r) => r.pnlPct != null)

if (rows.length === 0) { console.log('Belum ada posisi closed.'); process.exit(0) }

function bucket(list, label) {
  const n = list.length
  if (!n) return { label, n: 0 }
  const wins = list.filter((r) => r.pnlPct > 0)
  const wr = (wins.length / n) * 100
  const avgW = wins.length ? wins.reduce((a, r) => a + r.pnlPct, 0) / wins.length : 0
  const avgL = (n - wins.length) ? list.filter((r) => r.pnlPct <= 0).reduce((a, r) => a + r.pnlPct, 0) / (n - wins.length) : 0
  const expG = (wr / 100) * avgW + (1 - wr / 100) * avgL
  const expN = expG - FEE
  const pnl = list.reduce((a, r) => a + r.pnl, 0)
  const spanD = Math.max(1, (new Date(list[n - 1].closedAt) - new Date(list[0].closedAt)) / 86_400_000)
  return { label, n, wr, avgW, avgL, expG, expN, pnl, cpd: n / spanD }
}
const show = (b) => {
  if (!b.n) return console.log(`  ${b.label.padEnd(6)} siklus=  0  —`)
  console.log(
    `  ${b.label.padEnd(6)} siklus=${String(b.n).padStart(3)}  WR=${b.wr.toFixed(0).padStart(3)}%  avgW=${pct(b.avgW)}  avgL=${pct(b.avgL)}  EXP=${pct(b.expG)} gross / ${pct(b.expN)} NET  PnL=${usd(b.pnl)}  (${b.cpd.toFixed(1)}/hari)`
  )
}

console.log(`=== REKAP MINGGUAN (fee ${FEE}%/siklus) — ${rows.length} siklus closed ===`)
const now = Date.now()
for (let w = 0; w < 4; w++) {
  const from = now - (w + 1) * 7 * 86_400_000
  const to = now - w * 7 * 86_400_000
  show(bucket(rows.filter((r) => new Date(r.closedAt) >= new Date(from) && new Date(r.closedAt) < new Date(to)), `W-${w + 1}`))
}
const all = bucket(rows, 'TOTAL')
show(all)

console.log('\n=== KESEHATAN SIMBOL (30 hari) ===')
for (const [key, list] of Object.entries(
  rows.reduce((acc, r) => { (acc[`${r.sym}${r.paper ? '' : ' [LIVE]'}`] ||= []).push(r); return acc }, {})
)) {
  const b = bucket(list, key)
  const lastDays = (now - new Date(list[list.length - 1].closedAt)) / 86_400_000
  const openRes = await client.execute({
    sql: `SELECT COUNT(*) c FROM BotPosition WHERE status='OPEN' AND configId IN (SELECT id FROM BotConfig WHERE symbol=?)`,
    args: [key.replace(' [LIVE]', '')],
  })
  const open = Number(openRes.rows[0].c)
  let verdict = 'KEEP'
  if (lastDays >= 5 && open === 0) verdict = 'DEAD → ganti simbol (tak ada siklus 5+ hari)'
  else if (b.n >= 10 && b.expN <= 0) verdict = 'REVIEW → WR/expectancy net negatif'
  else if (b.n < 10) verdict = 'sampel kecil — pantau'
  console.log(`  ${key.padEnd(14)} n=${String(b.n).padStart(3)}  WR=${b.n ? b.wr.toFixed(0).padStart(3) + '%' : ' — '}  EXPnet=${b.n ? pct(b.expN) : ' — '}  siklus terakhir ${lastDays.toFixed(1)}h lalu  open=${open}  → ${verdict}`)
}

const cycles30 = rows.filter((r) => new Date(r.closedAt) >= new Date(now - 30 * 86_400_000)).length
const cpd30 = cycles30 / 30
console.log('\n=== GERBANG SKALA ===')
console.log(`  siklus 30 hari: ${cycles30} (butuh >= 100)`)
console.log(`  expectancy NET total: ${pct(all.expN)} (butuh >= +0.30%)`)
const gate = cycles30 >= 100 && all.expN >= 0.3
console.log(gate
  ? '  → GATE TERBUKA: edge terbukti, ukuran order boleh dinaikkan bertahap.'
  : '  → GATE TERTUTUP: jangan naikkan modal dulu. Perbaiki TF/simbol/exit, kumpulkan siklus.')

console.log(`\n=== JALUR KE TARGET $${TARGET.toFixed(0)}/bulan (net fee) ===`)
if (all.expN > 0.05) {
  const perCycle = all.expN / 100
  const activeDays = new Set(rows.map((r) => r.closedAt.slice(0, 10))).size
  const cyclesDay = rows.length / Math.max(1, activeDays) /* rata2 hari AKTIF, bukan kalender */
  const sizeNow = 50
  const projNow = cyclesDay * 30 * perCycle * sizeNow
  const sizeNeeded = TARGET / (cyclesDay * 30 * perCycle)
  console.log(`  ritme aktif: ~${cyclesDay.toFixed(1)} siklus/hari-aktif (${activeDays} hari berisi siklus)`)
  console.log(`  dgn size $${sizeNow}/trade sekarang → $${projNow.toFixed(0)}/bulan net`)
  console.log(`  target $${TARGET.toFixed(0)}/bulan butuh order size ~$${sizeNeeded.toFixed(0)}/trade (asumsi expectancy & ritme tetap)`)
  console.log(`  estimasi modal kerja: ~$${(sizeNeeded * 5).toFixed(0)}–${(sizeNeeded * 10).toFixed(0)} (5–10 posisi bersamaan worst case)`)
} else {
  console.log('  expectancy net ≈ 0 — menaikkan size hanya menggandakan varians tanpa profit. Perbaiki edge dulu (TF/simbol/exit/fee), target belum relevan.')
}
console.log('\nCatatan: bot yang DIHAPUS membawa riwayatnya (cascade) — rekap ini hanya melihat yang selamat. Jangan hapus bot selama masa pengujian.')
