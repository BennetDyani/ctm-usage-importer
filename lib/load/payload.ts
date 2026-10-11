// Builds the JSON that ctm.load_file_set(payload) expects (db/migrations/003) from a parsed,
// error-free file set. Pure: the caller supplies checksums (node:crypto on the server).
import type { FileSetInput, ParsedFileSet } from '../parse'

export interface LoadPayload {
  uploaderId: string
  customer: string
  environment: string
  trigger: 'web' | 'folder'
  warnings: ParsedFileSet['issues']
  files: {
    kind: 'dist_tasks' | 'dist_endpoints' | 'addons'
    name: string
    sha256: string
    size: number
    title: string | null
    raw: string
    rows: unknown[]
  }[]
}

export function toLoadPayload(
  input: FileSetInput,
  parsed: ParsedFileSet,
  sha256: (text: string) => string,
  trigger: 'web' | 'folder' = 'web',
): LoadPayload {
  if (!parsed.ok || !parsed.file1 || !parsed.file2 || !input.file1 || !input.file2) {
    throw new Error('toLoadPayload needs a file set that passed every check')
  }
  const files: LoadPayload['files'] = [
    { kind: 'dist_tasks', name: input.file1.name, sha256: sha256(input.file1.text), size: input.file1.size, title: parsed.file1.title, raw: input.file1.text, rows: parsed.file1.rows },
    { kind: 'dist_endpoints', name: input.file2.name, sha256: sha256(input.file2.text), size: input.file2.size, title: parsed.file2.title, raw: input.file2.text, rows: parsed.file2.rows },
  ]
  if (parsed.addons && input.addons) {
    files.push({ kind: 'addons', name: input.addons.name, sha256: sha256(input.addons.text), size: input.addons.size, title: null, raw: input.addons.text, rows: parsed.addons.rows })
  }
  return {
    uploaderId: input.uploaderId.trim(),
    customer: input.customer.trim(),
    environment: parsed.environment ?? input.environment.trim(), // as written in the file names (A11)
    trigger,
    warnings: parsed.issues.filter((i) => i.severity === 'warning'),
    files,
  }
}
