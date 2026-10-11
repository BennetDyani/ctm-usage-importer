// Runs db/tests/known_answers.sql against a freshly loaded local database, then proves the
// script really fails when a single stored number is wrong.
//   npm run db:up && npm run db:test
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toLoadPayload } from '../../lib/load/payload.js'
import { parseFileSet, type FileSetInput } from '../../lib/parse/index.js'
import { resetDatabase, TEST_URL } from './setup.js'

const SCRIPT = readFileSync(join('db', 'tests', 'known_answers.sql'), 'utf8')
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const file = (customer: string, name: string) => {
  const text = readFileSync(join('data', 'samples', customer, name), 'utf8')
  return { name, text, size: Buffer.byteLength(text) }
}

describe.skipIf(!TEST_URL)('known_answers.sql (local Postgres)', () => {
  const sql = postgres(TEST_URL ?? '', { max: 1, onnotice: () => {} })
  const results = () => sql<{ n: number; check_name: string; expected: string; actual: string; pass: boolean }[]>`select * from ka_results order by n`

  beforeAll(async () => {
    await resetDatabase(sql)
    for (const [c, envs] of [['BANK', ['Dev', 'Prod', 'UAT']], ['DCS', ['PROD', 'QA']]] as const) {
      for (const e of envs) {
        const input: FileSetInput = {
          uploaderId: 'bdyani', customer: c, environment: e,
          file1: file(c, `ALL_per_task_${e}.csv`), file2: file(c, `ALL${e}.csv`), addons: file(c, `addons_${e}.csv`),
        }
        await sql`select ctm.load_file_set(${sql.json(toLoadPayload(input, parseFileSet(input), sha) as never)})`
      }
    }
  }, 60_000)
  afterAll(() => sql.end())

  it('passes all 20 checks on correctly loaded data', async () => {
    await sql.unsafe(SCRIPT)
    const rows = await results()
    expect(rows).toHaveLength(20)
    expect(rows.filter((r) => !r.pass).map((r) => `${r.n} ${r.check_name}: expected ${r.expected}, got ${r.actual}`)).toEqual([])
  })

  it('fails loudly when one stored value is changed by one', async () => {
    // BANK Prod, 7 Aug 2025: the tasks value behind the 4th-busiest day
    const [row] = await sql`
      update ctm.dist_task_rows t set total_task_count = total_task_count + 1
        from ctm.uploads u join ctm.environments e on e.id = u.environment_id
       where t.upload_id = u.id and u.status = 'current' and u.file_kind = 'dist_tasks'
         and e.name = 'Prod' and t.usage_date = '2025-08-07'
      returning t.upload_id, t.line_no`
    try {
      // The error rolls the whole run back, so the message is where the failed checks are named.
      const err = await sql.unsafe(SCRIPT).then(() => null, (e: Error) => e)
      expect(err?.message).toMatch(/^KNOWN-ANSWER CHECKS FAILED: /)
      const failed = [...(err?.message ?? '').matchAll(/(?:: |; )(\d+) /g)].map((m) => Number(m[1]))
      expect(failed).toEqual([2, 10, 11]) // the 4th-busiest answer, the BMC total, and the day-by-day fingerprint
    } finally {
      await sql`update ctm.dist_task_rows set total_task_count = total_task_count - 1 where upload_id = ${row.upload_id} and line_no = ${row.line_no}`
    }
    await sql.unsafe(SCRIPT) // back to all passing
  })
})
