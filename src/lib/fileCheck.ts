// Browser side of the upload: reads a chosen file and runs it through the SAME rulebook the
// server uses (lib/parse). The browser check is for fast feedback; the server re-checks.
import {
  decodeUtf8, envFromFileName, parseEndpointsFile, parseFileSet, parseTasksFile,
  type FileSetInput, type Issue, type ParsedFileSet,
} from '../../lib/parse'

export type Kind = 'tasks' | 'endpoints'

export interface FileCheck {
  file: File
  text: string
  env: string | null
  rows: number
  days: number
  first?: string
  last?: string
  errors: string[]
  warnings: string[]
}

const describe = (i: Issue) => (i.line ? `Line ${i.line}: ${i.message}` : i.message)

export async function checkFile(file: File, kind: Kind): Promise<FileCheck> {
  const text = decodeUtf8(new Uint8Array(await file.arrayBuffer()))
  const env = envFromFileName(file.name, kind === 'tasks' ? 'dist_tasks' : 'dist_endpoints')
  const errors: string[] = []
  if (!env) {
    errors.push(kind === 'tasks'
      ? 'Name must look like ALL_per_task_<ENV>.csv'
      : 'Name must look like ALL<ENV>.csv, for example ALLPROD.csv')
  }
  if (text === null) {
    return { file, text: '', env, rows: 0, days: 0, errors: [...errors, 'The file is not valid UTF-8 text.'], warnings: [] }
  }
  const parsed = kind === 'tasks' ? parseTasksFile(text) : parseEndpointsFile(text)
  const dates = [...new Set(parsed.rows.map((r) => r.usageDate))].sort()
  return {
    file, text, env,
    rows: parsed.rows.length,
    days: dates.length,
    first: dates[0],
    last: dates.at(-1),
    errors: [...errors, ...parsed.issues.filter((i) => i.severity === 'error').map(describe)].slice(0, 5),
    warnings: parsed.issues.filter((i) => i.severity === 'warning').map(describe),
  }
}

/** Full rulebook over the whole set, exactly as the server will run it. */
export function checkSet(input: Omit<FileSetInput, 'file1' | 'file2'>, tasks: FileCheck, endpoints: FileCheck): ParsedFileSet {
  return parseFileSet({
    ...input,
    file1: { name: tasks.file.name, text: tasks.text, size: tasks.file.size },
    file2: { name: endpoints.file.name, text: endpoints.text, size: endpoints.file.size },
  })
}

export { sameEnv } from '../../lib/parse'
