import { createClient } from '@libsql/client'
import fs from 'node:fs'
const env = fs.readFileSync('/home/z/my-project/.env','utf8')
const get = (k) => (env.match(new RegExp(`(?:^|\\n)(?:export )?${k}=("?)([^\\n"]+)\\1`,'m'))||[])[2]?.trim()
const c = createClient({ url: get('TURSO_DATABASE_URL'), authToken: get('TURSO_AUTH_TOKEN') })
const r = await c.execute('SELECT symbol, paper, enabled, createdAt FROM BotConfig ORDER BY createdAt')
const paper = r.rows.filter(x=>Number(x.paper)===1)
console.log('Total bot:', r.rows.length, '| paper:', paper.length, '(quota 5)')
for(const x of r.rows) console.log('  '+x.symbol.padEnd(12)+' paper='+x.paper+' enabled='+x.enabled+'  dibuat='+String(x.createdAt).slice(0,10))
