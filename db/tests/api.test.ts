// End-to-end tests for the upload API: real multipart HTTP requests to the route handlers,
// which connect to a real local Postgres as the restricted roles (ctm_loader / ctm_reader).
//   npm run db:up && npm run db:test
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GET as batches } from '../../api/batches.js'
import { GET as uploadGet, POST as upload } from '../../api/upload.js'
import { closeAll } from '../../lib/server/db.js'
import { resetDatabase, roleUrls, TEST_URL } from './setup.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (r: Response): Promise<any> => r.json()
const sample = (customer: string, name: string) => new File([readFileSync(join('data', 'samples', customer, name))], name, { type: 'text/csv' })

function request(fields: Record<string, string>, files: Record<string, File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  for (const [k, v] of Object.entries(files)) form.set(k, v)
  return new Request('http://localhost/api/upload', { method: 'POST', body: form })
}
const pair = (customer: string, env: string, typedEnv = env, extra: Record<string, File> = {}) =>
  request({ uploaderId: 'bdyani', customer, environment: typedEnv }, {
    file1: sample(customer, `ALL_per_task_${env}.csv`), file2: sample(customer, `ALL${env}.csv`), ...extra,
  })

describe.skipIf(!TEST_URL)('upload API (local Postgres)', () => {
  const admin = postgres(TEST_URL ?? '', { max: 1, onnotice: () => {} })

  beforeAll(async () => {
    await resetDatabase(admin)
    const urls = await roleUrls(admin)
    process.env.DATABASE_URL_LOADER = urls.loader
    process.env.DATABASE_URL_READER = urls.reader
  }, 60_000)
  afterAll(async () => {
    await closeAll()
    await admin.end()
  })

  it('loads all five sample environments through HTTP', async () => {
    for (const [c, e] of [['BANK', 'Dev'], ['BANK', 'Prod'], ['BANK', 'UAT'], ['DCS', 'PROD'], ['DCS', 'QA']]) {
      const res = await upload(pair(c, e, e, { addons: sample(c, `addons_${e}.csv`) }))
      const body = await read(res)
      expect(res.status, JSON.stringify(body)).toBe(200)
      expect(body.status).toBe('loaded')
      expect(body.summary).toMatchObject({ taskRows: 365, endpointRows: 730, days: 365 })
      expect(body.files.map((f: { action: string }) => f.action)).toEqual(['inserted', 'inserted', 'inserted'])
    }
    // the database now gives the known answers
    const [s] = await admin`select s.fourth_highest from ctm.customers c, ctm.compliance_summary(c.id) s where c.name = 'BANK' and s.metric = 'TASKS'`
    expect(Number(s.fourth_highest)).toBe(121970)
  })

  it('the same files again: 200 already_loaded, nothing stored twice', async () => {
    const res = await upload(pair('DCS', 'QA', 'qa'))
    expect(res.status).toBe(200)
    expect((await read(res)).status).toBe('already_loaded')
    const [{ n }] = await admin`select count(*)::int as n from ctm.uploads where file_kind = 'dist_tasks'`
    expect(n).toBe(5)
  })

  it('wrong environment: 422 rejected with reasons, and the attempt is logged', async () => {
    const res = await upload(request({ uploaderId: 'bdyani', customer: 'DCS', environment: 'PROD' }, {
      file1: sample('DCS', 'ALL_per_task_QA.csv'), file2: sample('DCS', 'ALLQA.csv'),
    }))
    expect(res.status).toBe(422)
    const body = await read(res)
    expect(body.status).toBe('rejected')
    expect(body.issues.filter((i: { code: string }) => i.code === 'env_mismatch')).toHaveLength(2)
    const [b] = await admin`select status, jsonb_array_length(errors) as n from ctm.import_batches where id = ${body.batchId}`
    expect(b).toMatchObject({ status: 'rejected', n: 2 })
  })

  it('missing file and blank prompts: 422 with every reason at once', async () => {
    const res = await upload(request({ uploaderId: '', customer: 'DCS', environment: 'QA' }, { file1: sample('DCS', 'ALL_per_task_QA.csv') }))
    expect(res.status).toBe(422)
    const codes = (await read(res)).issues.map((i: { code: string }) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['missing_prompt_field', 'missing_file']))
  })

  it('a broken value: 422 with the line number, nothing stored', async () => {
    const text = readFileSync(join('data', 'samples', 'DCS', 'ALL_per_task_QA.csv'), 'utf8').replace('2026/06/17,5138', '2026/06/17,5138.5')
    const before = (await admin`select count(*)::int as n from ctm.uploads`)[0].n
    const res = await upload(request({ uploaderId: 'bdyani', customer: 'DCS', environment: 'QA' }, {
      file1: new File([text], 'ALL_per_task_QA.csv'), file2: sample('DCS', 'ALLQA.csv'),
    }))
    expect(res.status).toBe(422)
    expect((await read(res)).issues[0]).toMatchObject({ code: 'invalid_number', line: 5, file: 'file1' })
    expect((await admin`select count(*)::int as n from ctm.uploads`)[0].n).toBe(before)
  })

  it('not UTF-8: 422 not_utf8', async () => {
    const res = await upload(request({ uploaderId: 'bdyani', customer: 'DCS', environment: 'QA' }, {
      file1: new File([new Uint8Array([0xff, 0xfe, 0x00, 0x44])], 'ALL_per_task_QA.csv'), file2: sample('DCS', 'ALLQA.csv'),
    }))
    expect(res.status).toBe(422)
    expect((await read(res)).issues.map((i: { code: string }) => i.code)).toContain('not_utf8')
  })

  it('too large or wrong content type: 413 / 400; wrong method: 405', async () => {
    const big = new Request('http://localhost/api/upload', { method: 'POST', headers: { 'content-length': String(5 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' }, body: 'x' })
    expect((await upload(big)).status).toBe(413)
    const jsonBody = new Request('http://localhost/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect((await upload(jsonBody)).status).toBe(400)
    const res = uploadGet()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('GET /api/batches lists attempts newest first, with files and error counts', async () => {
    const res = await batches(new Request('http://localhost/api/batches?limit=5'))
    expect(res.status).toBe(200)
    const { batches: list } = await read(res)
    // four refused attempts above (wrong env, missing file, broken value, not UTF-8), then the re-upload
    expect(list.map((b: { status: string }) => b.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'already_loaded'])
    const loaded = (await read(await batches(new Request('http://localhost/api/batches?limit=100')))).batches.find((b: { status: string }) => b.status === 'loaded')
    expect(loaded.files).toHaveLength(3)
  })

  it('missing database settings: 500 misconfigured, never a crash', async () => {
    await closeAll()
    const saved = process.env.DATABASE_URL_LOADER
    delete process.env.DATABASE_URL_LOADER
    const res = await upload(pair('DCS', 'QA'))
    expect(res.status).toBe(500)
    expect((await read(res)).error).toBe('misconfigured')
    process.env.DATABASE_URL_LOADER = saved
  })

  it('database unreachable: 503 database_unavailable', async () => {
    await closeAll()
    const saved = process.env.DATABASE_URL_READER
    process.env.DATABASE_URL_READER = 'postgres://ctm_reader:x@localhost:1/postgres'
    const res = await batches(new Request('http://localhost/api/batches'))
    expect(res.status).toBe(503)
    process.env.DATABASE_URL_READER = saved
    await closeAll()
  })
})
