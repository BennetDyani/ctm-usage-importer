// POST /api/upload — one environment's file set (multipart/form-data):
//   uploaderId, customer, environment   text fields (the prompts, R8)
//   file1   ALL_per_task_<ENV>.csv       required
//   file2   ALL<ENV>.csv                 required
//   addons  addons_<ENV>.csv             optional
//
// The same rulebook as the browser (lib/parse) runs again here; the browser is never trusted.
// Refused  -> 422 { status: 'rejected', issues }  and the attempt is logged (log_rejected_batch)
// Accepted -> 200 { status: 'loaded' | 'already_loaded', batchId, files, summary, warnings }
import { createHash } from 'node:crypto'
import { toLoadPayload } from '../lib/load/payload'
import { decodeUtf8, MAX_FILE_BYTES, parseFileSet, type FileSetInput, type InputFile, type Issue } from '../lib/parse'
import { db } from '../lib/server/db'
import { failure, json, methodNotAllowed } from '../lib/server/http'

const MAX_BODY_BYTES = 4 * 1024 * 1024 // Vercel's request limit is 4.5 MB
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const field = (form: FormData, name: string) => {
  const v = form.get(name)
  return typeof v === 'string' ? v.slice(0, 200) : ''
}

async function readFile(form: FormData, name: string, issues: Issue[]): Promise<InputFile | undefined> {
  const f = form.get(name)
  if (!f || typeof f === 'string') return undefined
  const role = name === 'addons' ? 'addons' : (name as 'file1' | 'file2')
  if (f.size > MAX_FILE_BYTES) return { name: f.name, text: '', size: f.size } // parseFileSet reports file_too_large
  const text = decodeUtf8(new Uint8Array(await f.arrayBuffer()))
  if (text === null) {
    issues.push({ code: 'not_utf8', severity: 'error', message: `${f.name} is not valid UTF-8 text.`, file: role })
    return { name: f.name, text: '', size: f.size }
  }
  return { name: f.name, text, size: f.size }
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) {
    return json({ error: 'too_large', message: 'The upload is larger than 4 MB.' }, 413)
  }
  if (!(request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return json({ error: 'bad_request', message: 'Send the files as multipart/form-data.' }, 400)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'bad_request', message: 'The upload could not be read.' }, 400)
  }

  const readIssues: Issue[] = []
  const input: FileSetInput = {
    uploaderId: field(form, 'uploaderId'),
    customer: field(form, 'customer'),
    environment: field(form, 'environment'),
    file1: await readFile(form, 'file1', readIssues),
    file2: await readFile(form, 'file2', readIssues),
    addons: await readFile(form, 'addons', readIssues),
  }

  const parsed = parseFileSet(input)
  const issues = [...readIssues, ...parsed.issues]
  const ok = parsed.ok && readIssues.length === 0

  try {
    const sql = db('loader')
    if (!ok) {
      const errors = issues.filter((i) => i.severity === 'error')
      const [{ id }] = await sql`select ctm.log_rejected_batch(${sql.json({
        uploaderId: input.uploaderId, customer: input.customer, environment: input.environment,
        errors, warnings: issues.filter((i) => i.severity === 'warning'),
      } as never)}) as id`
      return json({ status: 'rejected', batchId: Number(id), issues }, 422)
    }

    const payload = toLoadPayload(input, parsed, sha256)
    const [{ r }] = await sql`select ctm.load_file_set(${sql.json(payload as never)}) as r`
    return json({ ...r, summary: parsed.summary, environment: payload.environment, warnings: payload.warnings })
  } catch (err) {
    return failure(err, 'upload')
  }
}

export const GET = () => methodNotAllowed('POST')
