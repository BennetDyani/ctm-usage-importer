// Database integration tests: migrations + real sample loads + known answers (docs/08 Level 2).
//
// Runs ONLY against a throwaway local Postgres, because it drops and recreates schema "ctm":
//   npm run db:up     (Docker: Postgres 17 on localhost:54322)
//   npm run db:test
// Skipped in a plain `npm test` unless TEST_DATABASE_URL is set.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toLoadPayload } from '../../lib/load/payload'
import { parseFileSet, type FileSetInput } from '../../lib/parse'
import { resetDatabase, TEST_URL } from './setup'

const url = TEST_URL

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const file = (customer: string, name: string) => {
  const text = readFileSync(join('data', 'samples', customer, name), 'utf8')
  return { name, text, size: Buffer.byteLength(text) }
}
function payload(customer: string, env: string, edit?: (text: string) => string, typedCustomer = customer, typedEnv = env) {
  const input: FileSetInput = {
    uploaderId: 'bdyani', customer: typedCustomer, environment: typedEnv,
    file1: file(customer, `ALL_per_task_${env}.csv`), file2: file(customer, `ALL${env}.csv`), addons: file(customer, `addons_${env}.csv`),
  }
  if (edit) input.file1!.text = edit(input.file1!.text)
  const parsed = parseFileSet(input)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
  return toLoadPayload(input, parsed, sha)
}

describe.skipIf(!url)('database (local Postgres)', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => {} })
  // Run as a restricted role, the way the API will connect.
  const as = <T>(role: 'ctm_loader' | 'ctm_reader', fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => { await tx.unsafe(`set local role ${role}`); return fn(tx) }) as Promise<T>
  const load = (p: unknown) => as('ctm_loader', (tx) => tx`select ctm.load_file_set(${tx.json(p as postgres.JSONValue)}) as r`).then((r) => r[0].r)
  const customerId = async (name: string) => (await sql`select id from ctm.customers where name_key = lower(${name})`)[0].id as number
  const summary = async (name: string) => {
    const id = await customerId(name) // look up first: the pool has one connection, and as() holds it
    return Object.fromEntries((await as('ctm_reader', (tx) => tx`select * from ctm.compliance_summary(${id})`)).map((r) => [r.metric, r]))
  }

  beforeAll(async () => {
    await resetDatabase(sql)
    for (const [c, envs] of [['BANK', ['Dev', 'Prod', 'UAT']], ['DCS', ['PROD', 'QA']]] as const) {
      for (const e of envs) expect((await load(payload(c, e))).status).toBe('loaded')
    }
  }, 60_000)
  afterAll(() => sql.end())

  it('stores every row exactly: 365 task rows and 730 endpoint rows per environment', async () => {
    const rows = await sql`
      select e.name, u.file_kind, u.row_count,
             (select count(*) from ctm.dist_task_rows t where t.upload_id = u.id)::int as tasks,
             (select count(*) from ctm.dist_endpoint_rows r where r.upload_id = u.id)::int as endpoints
        from ctm.uploads u join ctm.environments e on e.id = u.environment_id
       where u.file_kind <> 'addons' order by 1, 2`
    expect(rows).toHaveLength(10)
    for (const r of rows) {
      expect(r.row_count).toBe(r.file_kind === 'dist_tasks' ? 365 : 730)
      expect(r.file_kind === 'dist_tasks' ? r.tasks : r.endpoints).toBe(r.row_count)
    }
    const [raw] = await sql`select raw_content from ctm.uploads where file_name = 'ALL_per_task_QA.csv'`
    expect(raw.raw_content).toBe(file('DCS', 'ALL_per_task_QA.csv').text) // the original file, byte for byte
  })

  it.each([
    ['BANK', 'SEP', 348, '2025-09-11'], ['BANK', 'TASKS', 121970, '2025-08-07'],
    ['DCS', 'SEP', 181, '2026-06-16'], ['DCS', 'TASKS', 11571, '2026-05-21'],
    ['DCS', 'FT_TASKS', 2785, '2026-05-04'], ['DCS', 'MFT_FILES', 157032, '2026-05-26'],
  ])('known answer: %s %s 4th highest = %d on %s', async (customer, metric, value, date) => {
    const s = (await summary(customer))[metric]
    expect(Number(s.fourth_highest)).toBe(value)
    expect(s.fourth_date.toISOString().slice(0, 10)).toBe(date)
    expect(s.days_with_data).toBe(365)
  })

  it('BANK combined daily series equals BMC reference totals on all 365 days', async () => {
    const id = await customerId('BANK')
    const ref = new Map<string, number>()
    for (const l of readFileSync(join('data', 'reference', 'BANK', 'ALL_per_task__total.csv'), 'utf8').split(/\r?\n/)) {
      const c = l.split(',')
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(c[0])) ref.set(c[0].replaceAll('/', '-'), Number(c[1]))
    }
    const series = await as('ctm_reader', (tx) => tx`select usage_date::text as d, total from ctm.daily_series(${id}, 'TASKS')`)
    expect(series).toHaveLength(365)
    for (const s of series) expect(Number(s.total), s.d).toBe(ref.get(s.d))
  })

  it('BANK file transfers are all zero, so the status is no_usage', async () => {
    expect((await summary('BANK')).FT_TASKS.status).toBe('no_usage')
  })

  it('uploading the same files again changes nothing (already_loaded)', async () => {
    const before = (await sql`select count(*)::int as n from ctm.dist_task_rows`)[0].n
    const r = await load(payload('BANK', 'Prod', undefined, ' bank ', 'PROD'))
    expect(r.status).toBe('already_loaded')
    expect(r.files.map((f: { action: string }) => f.action)).toEqual(['unchanged', 'unchanged', 'unchanged'])
    expect((await sql`select count(*)::int as n from ctm.dist_task_rows`)[0].n).toBe(before)
    expect((await sql`select count(*)::int as n from ctm.customers`)[0].n).toBe(2) // " bank " matched BANK
  })

  it('a corrected file supersedes the old one, then the old one can be reactivated', async () => {
    const plus5000 = (t: string) => t.replace(/^2025\/08\/07,(\d+)/m, (_, n) => `2025/08/07,${Number(n) + 5000}`)
    const r = await load(payload('BANK', 'Prod', plus5000))
    expect(r.files.map((f: { action: string }) => f.action)).toEqual(['inserted', 'unchanged', 'unchanged'])
    // 7 Aug was 121,970; +5,000 makes it the busiest day (126,970), so the 4th becomes 9 Sep 2025 (124,573)
    const s = (await summary('BANK')).TASKS
    expect(Number(s.peak)).toBe(126970)
    expect(Number(s.fourth_highest)).toBe(124573)
    const current = await sql`select status from ctm.uploads u join ctm.environments e on e.id = u.environment_id
                                where e.name = 'Prod' and u.file_kind = 'dist_tasks' order by u.id`
    expect(current.map((c) => c.status)).toEqual(['superseded', 'current'])

    const back = await load(payload('BANK', 'Prod'))
    expect(back.files[0].action).toBe('reactivated')
    expect(Number((await summary('BANK')).TASKS.fourth_highest)).toBe(121970)
  })

  it('contracts drive the verdict; null removes a metric', async () => {
    const id = await customerId('DCS')
    await as('ctm_loader', (tx) => tx`select ctm.save_contract(${tx.json({ customerId: id, validFrom: '2025-06-01', enteredBy: 'bdyani',
      values: { TASKS: 12000, SEP: 180, MIPS: null }, licensed: ['Control-M for Advanced File Transfer'] })})`)
    const s = await summary('DCS')
    expect([s.TASKS.status, Number(s.TASKS.headroom)]).toEqual(['within_contract', 429])
    expect([s.SEP.status, Number(s.SEP.headroom)]).toEqual(['over_contract', -1])
    await as('ctm_loader', (tx) => tx`select ctm.save_contract(${tx.json({ customerId: id, validFrom: '2025-06-01', enteredBy: 'bdyani', values: { SEP: null } })})`)
    expect((await summary('DCS')).SEP.status).toBe('no_contract')
    const addons = await as('ctm_reader', (tx) => tx`select * from ctm.addon_usage(${id}) where product = 'Control-M for Advanced File Transfer'`)
    expect(addons[0]).toMatchObject({ licensed: true, installed_in: ['PROD', 'QA'] }) // both DCS add-on files say Installed
  })

  it('a refused upload is logged without creating a customer', async () => {
    await as('ctm_loader', (tx) => tx`select ctm.log_rejected_batch(${tx.json({ uploaderId: 'bdyani', customer: 'NEWCO', environment: 'QA', errors: [{ code: 'env_mismatch' }] })})`)
    const [b] = await as('ctm_reader', (tx) => tx`select * from ctm.recent_batches(1)`)
    expect(b).toMatchObject({ customer_name: 'NEWCO', status: 'rejected', error_count: 1 })
    expect((await sql`select count(*)::int as n from ctm.customers where name = 'NEWCO'`)[0].n).toBe(0)
  })

  it('trend, coverage and top days read correctly', async () => {
    const id = await customerId('DCS')
    const trend = await as('ctm_reader', (tx) => tx`select * from ctm.monthly_trend(${id}, 'TASKS')`)
    expect(trend).toHaveLength(13) // 19 Jun 2025 to 18 Jun 2026 touches 13 calendar months
    expect(Number(trend.find((m) => m.month.toISOString().startsWith('2026-06'))!.peak)).toBe(11888)
    const cov = await as('ctm_reader', (tx) => tx`select * from ctm.coverage(${id})`)
    expect(cov.map((c) => [c.environment, c.days, c.missing_days, c.zero_task_days])).toEqual([['PROD', 365, 0, 1], ['QA', 365, 0, 1]])
    const top = await as('ctm_reader', (tx) => tx`select * from ctm.top_days(${id}, 'TASKS', 4)`)
    expect(top.map((t) => Number(t.total))).toEqual([11888, 11664, 11574, 11571])
  })

  it('least privilege: the reader cannot write and cannot load; the loader cannot read tables', async () => {
    await expect(as('ctm_reader', (tx) => tx`insert into ctm.customers (name) values ('X')`)).rejects.toThrow(/permission denied/)
    await expect(as('ctm_reader', (tx) => tx`select ctm.load_file_set('{}')`)).rejects.toThrow(/permission denied/)
    await expect(as('ctm_loader', (tx) => tx`select * from ctm.customers`)).rejects.toThrow(/permission denied/)
    await expect(as('ctm_loader', (tx) => tx`select * from ctm.compliance_summary(1)`)).rejects.toThrow(/permission denied/)
  })

  it('the database refuses a payload missing File 2, even if the API forgot to check', async () => {
    const p = payload('DCS', 'QA')
    p.files = p.files.filter((f) => f.kind !== 'dist_endpoints')
    await expect(load(p)).rejects.toThrow(/both dist_tasks and dist_endpoints/)
  })
})
