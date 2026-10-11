import { describe, expect, it } from 'vitest'
import data from '../preview/sample-data.json'
import { summarise, sumOfPerEnvFourths, type Customer } from './compliance'

// Ground truth from docs/01_data_profile.md (verified against raw CSVs and SQL).
// This is the independent second implementation: the live report uses SQL, these must agree.
const customer = (name: string) => (data.customers as Customer[]).find((c) => c.name === name)!

describe('combine-then-rank (4th highest)', () => {
  it.each([
    ['BANK', 'sep', 348, '2025-09-11'],
    ['BANK', 'tasks', 121970, '2025-08-07'],
    ['DCS', 'sep', 181, '2026-06-16'],
    ['DCS', 'tasks', 11571, '2026-05-21'],
    ['DCS', 'ft', 2785, '2026-05-04'],
    ['DCS', 'mft', 157032, '2026-05-26'],
  ] as const)('%s %s = %d on %s', (name, metric, value, date) => {
    const s = summarise(customer(name), metric)
    expect(s.fourth?.total).toBe(value)
    expect(s.fourth?.date).toBe(date)
  })

  it('flags all-zero metrics (BANK file transfers)', () => {
    expect(summarise(customer('BANK'), 'ft').allZero).toBe(true)
  })

  it('the wrong method overstates usage', () => {
    const bank = customer('BANK')
    expect(sumOfPerEnvFourths(bank.envs, summarise(bank, 'sep').days)).toBe(361)
    expect(sumOfPerEnvFourths(bank.envs, summarise(bank, 'tasks').days)).toBe(133478)
  })
})
