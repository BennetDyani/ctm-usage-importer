// Browser-side file checks (fast feedback only; the server re-checks everything in Phase 3).
// Rules from docs/03_import_rules.md.
export type Kind = 'tasks' | 'endpoints'

export interface FileCheck {
  file: File
  env: string | null
  rows: number
  days: number
  first?: string
  last?: string
  errors: string[]
}

const TASKS = /^ALL_per_task_([A-Za-z0-9-]+)\.csv$/i
const ENDPOINTS = /^ALL([A-Za-z0-9-]+)\.csv$/i

export function envFromName(name: string, kind: Kind): string | null {
  if (kind === 'tasks') return TASKS.exec(name)?.[1] ?? null
  if (TASKS.test(name) || name.toUpperCase().startsWith('ALL_')) return null
  return ENDPOINTS.exec(name)?.[1] ?? null
}

export async function checkFile(file: File, kind: Kind): Promise<FileCheck> {
  const errors: string[] = []
  const env = envFromName(file.name, kind)
  if (!env) {
    errors.push(kind === 'tasks'
      ? 'Name must look like ALL_per_task_<ENV>.csv'
      : 'Name must look like ALL<ENV>.csv, for example ALLPROD.csv')
  }
  if (file.size > 2 * 1024 * 1024) errors.push('File is larger than 2 MB')

  const text = (await file.text()).replace(/^﻿/, '')
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex((l) => l.startsWith('Date,'))
  const required = kind === 'tasks' ? ['Total Task Count', 'File Transfer Tasks', 'MFT File Count'] : ['Endpoint Count']
  if (header < 0) errors.push('No header row starting with "Date" was found')
  else {
    const cols = lines[header].split(',')
    for (const c of required) if (!cols.includes(c)) errors.push(`Missing column "${c}"`)
  }

  const dates = new Set<string>()
  let rows = 0
  for (let i = header + 1; header >= 0 && i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l) continue
    const cells = l.split(',')
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0])) {
      errors.push(`Line ${i + 1}: "${cells[0]}" is not a date (YYYY/MM/DD)`)
      continue
    }
    if (cells.slice(1).some((c) => !/^\d+$/.test(c))) errors.push(`Line ${i + 1}: values must be whole numbers`)
    rows++
    dates.add(cells[0])
  }
  if (header >= 0 && rows === 0) errors.push('No data rows after the header')
  const sorted = [...dates].sort()
  return {
    file, env, rows, days: dates.size,
    first: sorted[0]?.replaceAll('/', '-'), last: sorted.at(-1)?.replaceAll('/', '-'),
    errors: errors.slice(0, 5),
  }
}

export const sameEnv = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
