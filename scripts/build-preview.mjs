// Builds src/preview/sample-data.json from data/samples/ so the UI can be designed
// against REAL numbers before the database exists (Phases 2-6 replace this with /api).
// Values are copied exactly; duplicate endpoint rows per date are summed (assumption A5).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const samples = join(root, 'data', 'samples')

const rows = (file) =>
  readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(','))

const customers = []
for (const name of readdirSync(samples).sort()) {
  const dir = join(samples, name)
  const files = readdirSync(dir)
  const envs = files
    .map((f) => /^ALL_per_task_(.+)\.csv$/.exec(f)?.[1])
    .filter(Boolean)
    .sort((a, b) => ['dev', 'qa', 'uat', 'prod'].indexOf(a.toLowerCase()) - ['dev', 'qa', 'uat', 'prod'].indexOf(b.toLowerCase()))
  const days = new Map()
  const day = (d) => days.get(d) ?? days.set(d, { date: d, env: {} }).get(d)
  const addons = {}
  for (const env of envs) {
    for (const r of rows(join(dir, `ALL_per_task_${env}.csv`))) {
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(r[0])) continue
      const e = (day(r[0]).env[env] ??= { tasks: 0, sep: 0, ft: 0, mft: 0 })
      e.tasks += Number(r[1]); e.ft += Number(r[2]); e.mft += Number(r[3])
    }
    for (const r of rows(join(dir, `ALL${env}.csv`))) {
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(r[0])) continue
      const e = (day(r[0]).env[env] ??= { tasks: 0, sep: 0, ft: 0, mft: 0 })
      e.sep += Number(r[1])
    }
    const addonFile = files.find((f) => f.toLowerCase() === `addons_${env.toLowerCase()}.csv`)
    if (addonFile) {
      for (const r of rows(join(dir, addonFile)).slice(1)) {
        if (!r[0]) continue
        ;(addons[r[0]] ??= {})[env] = r[1] === 'Installed'
      }
    }
  }
  const list = [...days.values()]
    .map((d) => ({ ...d, date: d.date.replaceAll('/', '-') }))
    .sort((a, b) => a.date.localeCompare(b.date))
  customers.push({ name, envs, days: list, addons })
}

const out = join(root, 'src', 'preview', 'sample-data.json')
writeFileSync(out, JSON.stringify({ generatedFrom: 'data/samples', customers }) + '\n')
console.log(`wrote ${out}: ${customers.map((c) => `${c.name} ${c.envs.join('/')} ${c.days.length} days`).join(', ')}`)
