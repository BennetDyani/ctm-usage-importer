// parseFileSet: the single rulebook for an upload (docs/03_import_rules.md).
// Pure TypeScript with no Node-only imports, so the server (api/upload, Phase 3),
// the future folder importer AND the browser Upload page all run the same rules.
//
// All-or-nothing: if any error is found, `ok` is false and nothing should be stored.
import { parseAddonsFile, type AddonRow } from './addons.js'
import { parseEndpointsFile, parseTasksFile, type EndpointRow, type TaskRow } from './distributed.js'
import { envFromFileName, sameEnv } from './fileName.js'
import { err, warn, type Issue } from './issues.js'

export const MAX_FILE_BYTES = 2 * 1024 * 1024

export interface InputFile {
  name: string
  text: string // already decoded as UTF-8 (use decodeUtf8 on raw bytes; null => not_utf8)
  size: number // bytes
}

export interface FileSetInput {
  uploaderId: string
  customer: string
  environment: string // as typed by the user
  file1?: InputFile // ALL_per_task_<ENV>.csv
  file2?: InputFile // ALL<ENV>.csv
  addons?: InputFile // addons_<ENV>.csv (optional)
}

export interface ParsedFileSet {
  ok: boolean
  environment: string | null // as written in the file names (A11)
  file1?: { name: string; title: string; rows: TaskRow[] }
  file2?: { name: string; title: string; rows: EndpointRow[] }
  addons?: { name: string; rows: AddonRow[] }
  summary: {
    taskRows: number
    endpointRows: number
    days: number
    firstDay?: string
    lastDay?: string
  }
  issues: Issue[]
}

export function parseFileSet(input: FileSetInput): ParsedFileSet {
  const issues: Issue[] = []

  // 1. Prompts come first (R8).
  const prompts: [string, string][] = [['Uploader ID', input.uploaderId], ['Customer name', input.customer], ['Environment', input.environment]]
  for (const [label, value] of prompts) {
    if (!value?.trim()) issues.push(err('missing_prompt_field', `${label} is required.`))
  }

  // 2. Both distributed files are always uploaded together (A1).
  if (!input.file1) issues.push(err('missing_file', 'File 1 (ALL_per_task_<ENV>.csv) is missing.', 'file1'))
  if (!input.file2) issues.push(err('missing_file', 'File 2 (ALL<ENV>.csv) is missing.', 'file2'))

  // 3. File names, sizes and environment agreement.
  const env1 = input.file1 ? envFromFileName(input.file1.name, 'dist_tasks') : null
  const env2 = input.file2 ? envFromFileName(input.file2.name, 'dist_endpoints') : null
  const envA = input.addons ? envFromFileName(input.addons.name, 'addons') : null
  if (input.file1 && !env1) issues.push(err('bad_file1_name', `"${input.file1.name}" doesn't match ALL_per_task_<ENV>.csv.`, 'file1'))
  if (input.file2 && !env2) issues.push(err('bad_file2_name', `"${input.file2.name}" doesn't match ALL<ENV>.csv.`, 'file2'))
  if (input.addons && !envA) issues.push(err('bad_addons_name', `"${input.addons.name}" doesn't match addons_<ENV>.csv.`, 'addons'))

  for (const [role, f] of [['file1', input.file1], ['file2', input.file2], ['addons', input.addons]] as const) {
    if (f && f.size > MAX_FILE_BYTES) issues.push(err('file_too_large', `${f.name} is larger than 2 MB.`, role))
  }

  const typed = input.environment?.trim()
  for (const [role, env, f] of [['file1', env1, input.file1], ['file2', env2, input.file2], ['addons', envA, input.addons]] as const) {
    if (f && env && typed && !sameEnv(env, typed)) {
      issues.push(err('env_mismatch', `${f.name} is for ${env}, but the environment entered is ${typed}.`, role))
    }
  }
  if (env1 && env2 && !sameEnv(env1, env2)) {
    issues.push(err('env_mismatch', `File 1 is for ${env1} but File 2 is for ${env2}.`, 'file2'))
  }

  // 4. Contents.
  // Content is only read when the name is right and the file isn't oversized (no point parsing junk).
  const readable = (f?: InputFile) => !!f && f.size <= MAX_FILE_BYTES
  const p1 = readable(input.file1) && env1 ? parseTasksFile(input.file1!.text) : undefined
  const p2 = readable(input.file2) && env2 ? parseEndpointsFile(input.file2!.text) : undefined
  const pa = readable(input.addons) && envA ? parseAddonsFile(input.addons!.text) : undefined
  issues.push(...(p1?.issues ?? []), ...(p2?.issues ?? []), ...(pa?.issues ?? []))

  // 5. Both files should cover the same days (warning only: stored and shown in the report).
  const range = (rows?: { usageDate: string }[]) => {
    if (!rows?.length) return undefined
    const d = rows.map((r) => r.usageDate).sort()
    return { first: d[0], last: d[d.length - 1], days: new Set(d).size }
  }
  const r1 = range(p1?.rows)
  const r2 = range(p2?.rows)
  if (r1 && r2 && (r1.first !== r2.first || r1.last !== r2.last)) {
    issues.push(warn('date_mismatch_between_files',
      `File 1 covers ${r1.first} to ${r1.last} but File 2 covers ${r2.first} to ${r2.last}.`))
  }

  const ok = !issues.some((i) => i.severity === 'error')
  return {
    ok,
    environment: env1 ?? env2 ?? null,
    file1: p1 && input.file1 ? { name: input.file1.name, title: p1.title, rows: p1.rows } : undefined,
    file2: p2 && input.file2 ? { name: input.file2.name, title: p2.title, rows: p2.rows } : undefined,
    addons: pa && input.addons ? { name: input.addons.name, rows: pa.rows } : undefined,
    summary: {
      taskRows: p1?.rows.length ?? 0,
      endpointRows: p2?.rows.length ?? 0,
      days: r1?.days ?? r2?.days ?? 0,
      firstDay: r1?.first ?? r2?.first,
      lastDay: r1?.last ?? r2?.last,
    },
    issues,
  }
}

export { parseTasksFile, parseEndpointsFile } from './distributed.js'
export { parseAddonsFile } from './addons.js'
export { envFromFileName, detectKind, sameEnv } from './fileName.js'
export { decodeUtf8 } from './csv.js'
export type { Issue, IssueCode, FileRole } from './issues.js'
export type { TaskRow, EndpointRow } from './distributed.js'
export type { AddonRow } from './addons.js'
