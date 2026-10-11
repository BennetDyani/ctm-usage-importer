// Contracts API against a real local Postgres, through the route handlers, as the restricted roles.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GET as getContract, POST as saveContract } from '../../api/contracts.js'
import { GET as customers } from '../../api/customers.js'
import { POST as upload } from '../../api/upload.js'
import { closeAll } from '../../lib/server/db.js'
import { resetDatabase, roleUrls, TEST_URL } from './setup.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (r: Response): Promise<any> => r.json()
const sample = (c: string, n: string) => new File([readFileSync(join('data', 'samples', c, n))], n)
const post = (body: unknown) => saveContract(new Request('http://x/api/contracts', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const get = (id: number | string) => getContract(new Request(`http://x/api/contracts?customerId=${id}`))

describe.skipIf(!TEST_URL)('contracts API (local Postgres)', () => {
  const admin = postgres(TEST_URL ?? '', { max: 1, onnotice: () => {} })
  let dcs = 0

  beforeAll(async () => {
    await resetDatabase(admin)
    const urls = await roleUrls(admin)
    process.env.DATABASE_URL_LOADER = urls.loader
    process.env.DATABASE_URL_READER = urls.reader
    await closeAll()
    for (const env of ['PROD', 'QA']) {
      const form = new FormData()
      form.set('uploaderId', 'bdyani'); form.set('customer', 'DCS'); form.set('environment', env)
      form.set('file1', sample('DCS', `ALL_per_task_${env}.csv`)); form.set('file2', sample('DCS', `ALL${env}.csv`))
      form.set('addons', sample('DCS', `addons_${env}.csv`))
      expect((await upload(new Request('http://x/api/upload', { method: 'POST', body: form }))).status).toBe(200)
    }
    const list = (await read(await customers())).customers
    dcs = list.find((c: { name: string }) => c.name === 'DCS').id
  }, 60_000)
  afterAll(async () => { await closeAll(); await admin.end() })

  it('GET /api/customers lists DCS with both environments and its date range', async () => {
    const { customers: list } = await read(await customers())
    expect(list).toEqual([{ id: dcs, name: 'DCS', environments: ['PROD', 'QA'], firstDay: '2025-06-19', lastDay: '2026-06-18' }])
  })

  it('before any contract: verdict is no_contract, but the 4th-busiest figures are there', async () => {
    const body = await read(await get(dcs))
    expect(body.contract).toEqual({})
    expect(body.summary.TASKS).toMatchObject({ fourthHighest: 11571, fourthDate: '2026-05-21', status: 'no_contract' })
    expect(body.addons.find((a: { product: string }) => a.product === 'Control-M for Advanced File Transfer'))
      .toMatchObject({ licensed: false, installedIn: ['PROD', 'QA'] })
  })

  it('saving a contract gives the database verdicts (within 429 / over by 1)', async () => {
    const res = await post({ customerId: dcs, enteredBy: 'bdyani', validFrom: '2025-06-01',
      values: { TASKS: '12,000', SEP: 180, MIPS: null }, licensed: ['Control-M for Advanced File Transfer'] })
    expect(res.status).toBe(200)
    const body = await read(res)
    expect(body.status).toBe('saved')
    expect(body.contract.TASKS).toMatchObject({ value: 12000, validFrom: '2025-06-01', enteredBy: 'bdyani' })
    expect(body.summary.TASKS).toMatchObject({ contracted: 12000, headroom: 429, status: 'within_contract' })
    expect(body.summary.SEP).toMatchObject({ contracted: 180, headroom: -1, status: 'over_contract' })
    expect(body.addons.find((a: { product: string }) => a.product === 'Control-M for Advanced File Transfer').licensed).toBe(true)
  })

  it('saving again with a measure cleared removes it ("not contracted")', async () => {
    const body = await read(await post({ customerId: dcs, enteredBy: 'bdyani', validFrom: '2025-06-01', values: { TASKS: 12000, SEP: null, MIPS: null }, licensed: [] }))
    expect(Object.keys(body.contract)).toEqual(['TASKS'])
    expect(body.summary.SEP.status).toBe('no_contract')
    expect(body.addons.every((a: { licensed: boolean }) => !a.licensed)).toBe(true)
  })

  it('refuses bad input with every reason (422) and changes nothing', async () => {
    const res = await post({ customerId: dcs, enteredBy: '', values: { TASKS: 12.5 } })
    expect(res.status).toBe(422)
    expect((await read(res)).errors).toEqual(['Your ID is required, so every contract change has a name on it.', 'TASKS must be a whole number of 0 or more.'])
    expect((await read(await get(dcs))).contract.TASKS.value).toBe(12000)
  })

  it('an unknown add-on name is refused (422), an unknown customer is 404', async () => {
    expect((await post({ customerId: dcs, enteredBy: 'x', values: {}, licensed: ['Control-M for Toasters'] })).status).toBe(422)
    expect((await post({ customerId: 99999, enteredBy: 'x', values: { TASKS: 1 } })).status).toBe(404)
    expect((await get(99999)).status).toBe(404)
    expect((await get('abc')).status).toBe(400)
  })

  it('swapped roles give a clear "wrong database role" error, not "could not be reached"', async () => {
    const saved = process.env.DATABASE_URL_READER
    process.env.DATABASE_URL_READER = process.env.DATABASE_URL_LOADER // the mix-up from production
    await closeAll()
    const res = await get(dcs)
    expect(res.status).toBe(500)
    expect((await read(res)).error).toBe('database_permission')
    process.env.DATABASE_URL_READER = saved
    await closeAll()
  })

  it('a wrong password gives "wrong username or password"', async () => {
    const saved = process.env.DATABASE_URL_READER!
    process.env.DATABASE_URL_READER = saved.replace(':local-test-only@', ':wrong-password@')
    await closeAll()
    const res = await get(dcs)
    expect(res.status).toBe(503)
    expect((await read(res)).error).toBe('database_login_failed')
    process.env.DATABASE_URL_READER = saved
    await closeAll()
  })
})
