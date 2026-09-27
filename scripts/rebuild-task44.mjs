/**
 * Task 44 RECOVERY (plumbing-only — immune to worktree restore flips):
 * Build the final correct tree ON TOP of c5ff719 (good pushed tip containing
 * Patch C + Task 38/39 tooling), then add:
 *   - Patch D edits (route ×3, candles ×2, bot-section ×2)
 *   - Patch E edits (bitget-trade signedRequest, engine liveFreeUsdt ×3)
 *   - consolidation files from 03eea67 (docs/ + scripts/ additions)
 *   - worklog: c5ff719 version + entries 40-b/41/42/43/44 appended
 *   - scripts/pump-projection.mjs (reconstructed, with the /100 fix)
 *   - scripts/fixer-task44.mjs (session artifact)
 * Then commit-tree + update-ref refs/heads/recovered-main. NEVER touches worktree.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const BASE = 'c5ff719381eb9cf60dc4597d9ce58415836d09b3'
const CONSOL = '03eea67' // consolidation commit (docs/scripts additions)
const IDX = '/home/z/my-project/.git/tmp-recovery-index'

const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).toString()

function blobFrom(rev, path) {
  return git(`cat-file blob ${rev}:${path}`)
}
function hashBlob(content) {
  return execSync('git hash-object -w --stdin', {
    input: content,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).toString().trim()
}
function put(rev, path, transform) {
  let content = blobFrom(rev, path)
  if (transform) content = transform(content)
  const sha = hashBlob(content)
  execSync(`git update-index --add --cacheinfo 100644,${sha},${path}`, { env: { ...process.env, GIT_INDEX_FILE: IDX } })
  console.log(`  ok ${path} -> ${sha.slice(0, 10)}`)
}

// ---- replacements -------------------------------------------------------
const R = {}
R['bitget-signedRequest'] = [
  '  if (!res.ok) throw new Error(`bitget HTTP ${res.status}`);',
  `  if (!res.ok) {
    /* Bitget ALWAYS returns a JSON body with the real reason (code+msg) even
       on HTTP 400/401/403 — e.g. 40104 "API key permission denied" (read-only
       key), 40003 "timestamp recvWindow expired" (clock skew), 40761
       "order value below minimum". Discarding it turned every failure into an
       undiagnosable "bitget HTTP 400". Surface code+msg (trimmed). */
    const raw = await res.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(raw) as { code?: unknown; msg?: unknown };
      if (j && (j.code != null || j.msg)) detail = \` [\${String(j.code ?? "?")}: \${String(j.msg ?? "")}]\`;
    } catch {
      if (raw) detail = \` [\${raw.slice(0, 140)}]\`;
    }
    throw new Error(\`bitget HTTP \${res.status}\${detail}\`.slice(0, 300));
  }`,
]
R['engine-liveFreeUsdt'] = [
  `async function liveFreeUsdt(creds: BitgetCreds): Promise<number | null> {
  try {
    const bal = await fetchSpotBalance(creds, "USDT");
    return bal ? bal.available : null;
  } catch {
    return null;
  }
}`,
  `async function liveFreeUsdt(creds: BitgetCreds): Promise<{ available: number | null; error?: string }> {
  try {
    const bal = await fetchSpotBalance(creds, "USDT");
    return { available: bal ? bal.available : null, error: bal ? undefined : "empty balance payload" };
  } catch (err) {
    /* Was silently swallowed — a broken Bitget connection then looked like an
       ordinary HOLD forever. Surface the reason (e.g. "bitget HTTP 401 [...]"). */
    return { available: null, error: err instanceof Error ? err.message.slice(0, 160) : "unknown balance error" };
  }
}`,
]
R['engine-call1'] = [
  `        const available = await liveFreeUsdt(creds);
        if (available == null) throw new Error("spot balance unavailable");`,
  `        const { available, error: balErr } = await liveFreeUsdt(creds);
        if (available == null) throw new Error(\`spot balance unavailable\${balErr ? \`: \${balErr}\` : ""}\`);`,
]
R['engine-call2'] = [
  `  const available = await liveFreeUsdt(creds!);
  if (available == null) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "HOLD", reason: "spot USDT balance unavailable — entry skipped this tick", score: signal.score };
  }`,
  `  const { available, error: balErr } = await liveFreeUsdt(creds!);
  if (available == null) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "HOLD", reason: \`spot USDT balance unavailable\${balErr ? \` — \${balErr}\` : ""} — entry skipped this tick\`, score: signal.score };
  }`,
]
const rep = (content, key) => {
  const [from, to] = R[key]
  if (content.includes(to)) return content
  if (!content.includes(from)) throw new Error(`pattern tidak ketemu: ${key}`)
  return content.replace(from, to)
}

// ---- build index --------------------------------------------------------
fs.rmSync(IDX, { force: true })
execSync(`git read-tree ${BASE}`, { env: { ...process.env, GIT_INDEX_FILE: IDX } })
console.log('index dari', BASE.slice(0, 10))

// Patch D + E (exact-string transforms on c5ff719 blobs)
function multi(content, pairs) {
  for (const [from, to] of pairs) {
    if (content.includes(to)) continue
    if (!content.includes(from)) throw new Error(`pattern tidak ketemu: ${from.slice(0, 60)}`)
    content = content.replace(from, to)
  }
  return content
}

const RE = [['const SYMBOL_RE = /^[A-Z0-9]{2,10}USDT$/;', 'const SYMBOL_RE = /^[A-Z0-9]{1,11}USDT$/;']]
const TRIM1 = [['const symbol = String(body.symbol ?? "").toUpperCase();', 'const symbol = String(body.symbol ?? "").replace(/\\s+/g, "").toUpperCase();']]
const TRIM2 = [['const wantSymbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();', 'const wantSymbol = (new URL(req.url).searchParams.get("symbol") ?? "").replace(/\\s+/g, "").toUpperCase();']]

put(BASE, 'src/app/api/bot/route.ts', (c) => multi(multi(multi(c, RE), TRIM1), TRIM2))
put(BASE, 'src/app/api/bot/candles/route.ts', (c) =>
  multi(
    multi(c, RE),
    [['const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();', 'const symbol = (url.searchParams.get("symbol") ?? "").replace(/\\s+/g, "").toUpperCase();']],
  )
)
put(BASE, 'src/components/crypto/bot-section.tsx', (c) =>
  multi(c, [
    ['const symbolValid = /^[A-Z0-9]{2,10}USDT$/.test(cfg.symbol.toUpperCase());', 'const symbolValid = /^[A-Z0-9]{1,11}USDT$/.test(cfg.symbol.replace(/\\s+/g, "").toUpperCase());'],
    ['onChange={(e) => setCfg({ ...cfg, symbol: e.target.value.toUpperCase() })}', 'onChange={(e) => setCfg({ ...cfg, symbol: e.target.value.replace(/\\s+/g, "").toUpperCase() })}'],
  ])
)
put(BASE, 'src/lib/bot/engine.ts', (c) => rep(rep(rep(c, 'engine-liveFreeUsdt'), 'engine-call1'), 'engine-call2'))
put(BASE, 'src/lib/bot/bitget-trade.ts', (c) => rep(c, 'bitget-signedRequest'))

// Consolidation additions from 03eea67 (docs/ + scripts/ only)
const treeLines = git(`ls-tree -r ${CONSOL} -- docs scripts`).trim().split('\n')
for (const line of treeLines) {
  const m = line.match(/^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/)
  if (!m) continue
  const mode = m[1]
  const sha = m[3]
  const path = m[4]
  execSync(`git update-index --add --cacheinfo ${mode},${sha},${path}`, { env: { ...process.env, GIT_INDEX_FILE: IDX } })
  console.log(`  ok (konsolidasi) ${path}`)
}

// pump-projection.mjs (Task 41 — reconstructed with the /100 fix applied)
put(BASE, 'scripts/turso-expectancy.mjs') // already in BASE tree — re-affirm
put(BASE, 'scripts/weekly-recap.mjs')

// ---- worklog: BASE + appended entries -----------------------------------
const worklogAppends = `

---
Task ID: 40-b (PUSH + INSIDEN FORCE-PUSH — direvisi saat pemulihan Task 44)
Agent: main (Super Z)
Task: Push hasil Task 38/39/40 pakai PAT baru; catatan: push pertama sukses (3ed6990..c5ff719)

Work Log:
- Push pertama sukses: 3ed6990..c5ff719 (Patch C + alat analisis + worklog) — dipakai token inline sekali
- CATATAN INSIDEN (Task 44): sandbox ter-reset memutar balik .git+worktree ke snapshot pra-Task-37; push ulang dengan rantai yang salah basis lalu force-push menimpa c5ff719 — pulihkan via plumbing dari objek c5ff719 (detail di Task 44)

Stage Summary:
- Riwayat remote dipulihkan berisi Patch C + alat analisis; Patch D/E ditata ulang di atasnya

---
Task ID: 41 (PROYEKSI JUJUR 30 HARI — PUMPUSDT @$50/trade)
Agent: main (Super Z)
Task: Hitungan realistis profit & loss per bulan (contoh: PUMPUSDT) tanpa janji palsu

Work Log:
- scripts/pump-projection.mjs: stats per-symbol + pooled, decompose profit/loss, Monte Carlo 10k, sensitivitas fee, tabel WR-minimum target
- Data: 34 siklus (NEAR 9, GENIUS 9, TAG 6, PUMP 6, GAIA 4); PUMP WR 50% avgWin +3.23% avgLoss -1.61% exp +0.81%/cycle (n=6 kecil)
- Pooled: WR 56%, avgWin +2.63%, avgLoss -2.81%, exp +0.23%/cycle
- Fix bug double-divide /100 pada decompose; proyeksi PUMP @3/hari: PROFIT +$73 vs LOSS -$36 = NET +$36/bln (asumsi edge nyata)
- Parametrik: $250-300/bln @$50 butuh WR 84-123% (mustahil) — jalannya bukti edge lalu scaling size

Stage Summary:
- 1 bot @$50 realistis median +$7..+$36/bln (P5-P95 sekitar -$15..+$60); 5 bot ~$40-90 median, bisa minus
- Target $250-300/bln hanya via bukti 100+ siklus lalu scaling size (Fase 0 -> 1 -> 2)

---
Task ID: 42 (PATCH D — validasi simbol 1-11 char + trim, 3 lokasi)
Agent: main (Super Z)
Task: User tidak bisa membuat/beli bot simbol 1-2 huruf (QUSDT, B2USDT) — cek penyebab

Work Log:
- SYMBOL_RE {2,10} di 3 lokasi menolak basis 1 char; bukti Bitget: 40 pair online basis 1-2 char, rentang asli 1-11 (MAXEXCHANGEUSDT)
- Bug kedua: tanpa trim (paste berspasi ditolak); bug ketiga: candles/route.ts regex sama -> chart simbol pendek mati
- Fix: {1,11} di 3 file + strip whitespace di input modal/API POST/GET/candles
- Kuota dicek: MAX_PAPER_BOTS=5 penuh — kemungkinan penyebab B2USDT "tidak bisa" saat itu (quota_paper 409)

Stage Summary:
- Simbol 1-11 char + chart hidup; paste berspasi dibersihkan otomatis

---
Task ID: 43 (PATCH E — pelaporan error Bitget terdiagnosis)
Agent: main (Super Z)
Task: Mode LIVE pertama: bot menunggu (normal) lalu manual tick error "bitget HTTP 400"

Work Log:
- Deduksi: error berasal dari POST place-order (cek saldo signed sukses lebih dulu; liveFreeUsdt lama menelan error)
- signedRequest kini membaca body error -> "bitget HTTP 400 [KODE: alasan]"; liveFreeUsdt mengembalikan {available, error}; 2 call site menyertakan alasan
- Checklist user: izin Spot Trade ON, tanpa IP whitelist (atau tambah IP server), passphrase benar, saldo spot cukup

Stage Summary:
- Error Bitget berikutnya terdiagnosis instan dari kode+pesan aslinya

---
Task ID: 44 (INSIDEN & PEMULIHAN RIWAYAT — plumbing rebuild)
Agent: main (Super Z)
Task: Push ulang setelah sandbox reset memutar balik .git+worktree; force-push dengan basis salah menimpa riwayat bagus

Work Log:
- Deteksi: origin/main lokal tertinggal (fetch tanpa token gagal senyap, repo private); konsolidasi checkpoint dibangun di atas c80911c (pra-Task-37) — Patch C + alat analisis hilang dari tip
- Force-push pertama menimpa remote c5ff719 -> a273aac (tanpa C/T38/39)
- Pemulihan: SHA penuh c5ff719 dari GitHub push events; fetch by-SHA (objek utuh); cherry-pick terganggu restore worktree paralel -> beralih ke plumbing murni (read-tree/hash-object/update-index/commit-tree) tanpa sentuh worktree
- ga-scan.sh token lama (MATI, HTTP 401) dibersihkan jadi env-ref; ga_work logs bersih
- Struktur akhir: c5ff719 <- recovered-main (D+E+konsolidasi+worklog+pump-projection) --force push

Stage Summary:
- Remote utuh: Patch C + D + E + alat analisis + dokumentasi; pelajaran: selalu fetch bertoken sebelum reset/consolidate; worktree bisa di-restore platform kapan saja — verifikasi via git show, bukan file`
const wlSha = hashBlob(blobFrom(BASE, 'worklog.md') + worklogAppends)
execSync(`git update-index --add --cacheinfo 100644,${wlSha},worklog.md`, { env: { ...process.env, GIT_INDEX_FILE: IDX } })
console.log('  ok worklog.md (diperbarui)')

// pump-projection.mjs — reconstructed
const pump = fs.readFileSync('/home/z/my-project/scripts/.pump-projection-content.mjs', 'utf8')
const pumpSha = hashBlob(pump)
execSync(`git update-index --add --cacheinfo 100644,${pumpSha},scripts/pump-projection.mjs`, { env: { ...process.env, GIT_INDEX_FILE: IDX } })
console.log('  ok scripts/pump-projection.mjs (rekonstruksi)')


// ---- tree + commit ------------------------------------------------------
const tree = execSync('git write-tree', { env: { ...process.env, GIT_INDEX_FILE: IDX } }).toString().trim()
console.log('tree:', tree.slice(0, 10))
const msg = `fix(bot): recover history — re-apply Patch D+E on good base, restore consolidation + Task41 tooling

Incident: sandbox reset rolled .git/worktree back to a pre-Task-37 snapshot;
a force-push from that wrong base overwrote c5ff719 (losing Patch C,
turso-expectancy, weekly-recap). This commit is built via git plumbing
directly on c5ff719 (fetched by SHA) and contains:
- Patch D re-applied: symbol regex {1,11} + whitespace trim (3 sites)
- Patch E re-applied: Bitget error code+msg surfaced (signedRequest,
  liveFreeUsdt + 2 call sites)
- checkpoint consolidation files (docs/bot-tick.workflow.yml, ga probes)
- worklog entries 40-b/41/42/43/44; scripts/pump-projection.mjs rebuilt
Verified: no tokens in tree (ga-scan.sh uses env ref).`
const commit = execSync('git commit-tree ' + tree + ' -p ' + BASE + ' -m ' + JSON.stringify(msg), {
  encoding: 'utf8',
}).toString().trim()
execSync(`git update-ref refs/heads/recovered-main ${commit}`)
console.log('COMMIT:', commit)
