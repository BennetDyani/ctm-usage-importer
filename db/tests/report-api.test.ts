// Report API against a real local Postgres, through the route handler, as ctm_reader.
// Every expected number is ground truth from docs/01_data_profile.md (computed from the raw CSVs).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { POST as saveContract } from '../../api/contracts.js'
import { GET as customers } from '../../api/customers.js'
import { GET as report } from '../../api/report.js'
import { POST as upload } from '../../api/upload.js'
import { closeAll } from '../../lib/server/db.js'
import { sumOfPerEnvFourths } from '../../src/lib/compliance.js'
import { resetDatabase, roleUrls, TEST_URL } from './setup.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (r: Response): Promise<any> => r.json()
const sample = (c: string, n: string) => new File([readFileSync(join('data', 'samples', c, n))], n)
const get = (id: number | string) => report(new Request(`http://x/api/report?customerId=${id}`))

describe.skipIf(!TEST_URL)('report API (local Postgres)', () => {
  const admin = postgres(TEST_URL ?? '', { max: 1, onnotice: () => {} })
  const ids: Record<string, number> = {}

  beforeAll(async () => {
    await resetDatabase(admin)
    const urls = await roleUrls(admin)
    process.env.DATABASE_URL_LOADER = urls.loader
    process.env.DATABASE_URL_READER = urls.reader
    await closeAll()
    for (const [c, env] of [['BANK', 'Dev'], ['BANK', 'Prod'], ['BANK', 'UAT'], ['DCS', 'PROD'], ['DCS', 'QA']]) {
      const form = new FormData()
      form.set('uploaderId', 'bdyani'); form.set('customer', c); form.set('environment', env)
      form.set('file1', sample(c, `ALL_per_task_${env}.csv`)); form.set('file2', sample(c, `ALL${env}.csv`))
      form.set('addons', sample(c, `addons_${env}.csv`))
      expect((await upload(new Request('http://x/api/upload', { method: 'POST', body: form }))).status).toBe(200)
    }
    for (const c of (await read(await customers())).customers) ids[c.name] = c.id
    await saveContract(new Request('http://x/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: ids.DCS, enteredBy: 'bdyani', validFrom: '2025-06-01', values: { TASKS: 12000, SEP: 180, MIPS: null }, licensed: [] }),
    }))
  }, 90_000)
  afterAll(async () => { await closeAll(); await admin.end() })

  it('BANK: combine-then-rank answers, 365 ranked days, three environments', async () => {
    const body = await read(await get(ids.BANK))
    expect(body.customer.name).toBe('BANK')
    expect(body.environments).toEqual(['Dev', 'Prod', 'UAT'])
    expect(body.window).toEqual({ from: '2025-06-02', to: '2026-06-01' }) // BANK's raw files: 2025/06/02 to 2026/06/01
    const tasks = body.metrics.TASKS
    expect(tasks.summary).toMatchObject({ fourthHighest: 121970, fourthDate: '2025-08-07', status: 'no_contract', daysWithData: 365 })
    expect(tasks.days).toHaveLength(365)
    expect(tasks.days.find((d: { rank: number }) => d.rank === 4)).toMatchObject({ date: '2025-08-07', total: 121970 })
    // each day's environments add up to its combined total
    for (const d of tasks.days) expect(Object.values(d.byEnv as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(d.total)
    expect(body.metrics.SEP.summary).toMatchObject({ fourthHighest: 348, fourthDate: '2025-09-11' })
    expect(body.metrics.FT_TASKS.summary.status).toBe('no_usage') // A18
  })

  it('the "wrong method" note uses the same daily rows: 361 vs 348 SEP, 133,478 vs 121,970 tasks', async () => {
    const body = await read(await get(ids.BANK))
    expect(sumOfPerEnvFourths(body.environments, body.metrics.SEP.days)).toBe(361)
    expect(sumOfPerEnvFourths(body.environments, body.metrics.TASKS.days)).toBe(133478)
  })

  it('monthly trend agrees with the daily series it summarises', async () => {
    const body = await read(await get(ids.BANK))
    for (const m of ['TASKS', 'SEP', 'MFT_FILES']) {
      const { days, monthly, summary } = body.metrics[m]
      expect(monthly).toHaveLength(13) // 2 Jun 2025 to 1 Jun 2026: a partial June at each end
      expect(monthly.reduce((s: number, r: { days: number }) => s + r.days, 0)).toBe(365)
      for (const r of monthly) {
        const inMonth = days.filter((d: { date: string }) => d.date.slice(0, 7) === r.month.slice(0, 7))
        const peak = Math.max(...inMonth.map((d: { total: number }) => d.total))
        const avg = inMonth.reduce((s: number, d: { total: number }) => s + d.total, 0) / inMonth.length
        expect(r.peak).toBe(peak)
        expect(r.average).toBeCloseTo(avg, 1)
      }
      expect(Math.max(...monthly.map((r: { peak: number }) => r.peak))).toBe(summary.peak)
    }
  })

  it('DCS: saved contract gives the database verdict (within by 429, over by 1)', async () => {
    const body = await read(await get(ids.DCS))
    expect(body.contract.TASKS.value).toBe(12000)
    expect(body.metrics.TASKS.summary).toMatchObject({ fourthHighest: 11571, contracted: 12000, headroom: 429, status: 'within_contract' })
    expect(body.metrics.SEP.summary).toMatchObject({ fourthHighest: 181, fourthDate: '2026-06-16', contracted: 180, headroom: -1, status: 'over_contract' })
    expect(body.metrics.FT_TASKS.summary).toMatchObject({ fourthHighest: 2785, fourthDate: '2026-05-04' })
    expect(body.metrics.MFT_FILES.summary).toMatchObject({ fourthHighest: 157032, fourthDate: '2026-05-26' })
  })

  it('add-ons and coverage come with the report', async () => {
    const body = await read(await get(ids.DCS))
    expect(body.addons).toHaveLength(21)
    expect(body.coverage.map((c: { environment: string }) => c.environment)).toEqual(['PROD', 'QA'])
    for (const c of body.coverage) expect(c).toMatchObject({ days: 365, missingDays: 0, firstDay: '2025-06-19', lastDay: '2026-06-18' })
  })

  it('answers 400 for a bad id and 404 for an unknown customer', async () => {
    expect((await get('abc')).status).toBe(400)
    expect((await get(999999)).status).toBe(404)
  })
})
