import { describe, expect, it } from 'vitest'
import { validateContract } from '../lib/server/contracts.js'

const ok = (body: unknown) => {
  const r = validateContract(body)
  if (!r.ok) throw new Error(r.errors.join(' '))
  return r.value
}
const errors = (body: unknown) => {
  const r = validateContract(body)
  return r.ok ? [] : r.errors
}

describe('validateContract', () => {
  it('accepts whole numbers, numbers typed with separators, and null (not contracted)', () => {
    expect(ok({ customerId: 2, enteredBy: ' bdyani ', validFrom: '2025-06-01', values: { TASKS: '12,000', SEP: 200, MIPS: null } }))
      .toEqual({ customerId: 2, enteredBy: 'bdyani', validFrom: '2025-06-01', values: { TASKS: 12000, SEP: 200, MIPS: null }, licensed: [] })
  })
  it('removes duplicate add-ons', () => {
    expect(ok({ customerId: 1, enteredBy: 'x', licensed: ['Control-M for SAP', 'Control-M for SAP'] }).licensed).toEqual(['Control-M for SAP'])
  })
  it('needs a customer and a name for the audit trail', () => {
    expect(errors({ values: {} })).toEqual([
      'customerId must be a positive whole number.',
      'Your ID is required, so every contract change has a name on it.',
    ])
  })
  it('refuses decimals, negatives, unknown measures and impossible dates', () => {
    expect(errors({ customerId: 1, enteredBy: 'x', validFrom: '2025-02-30', values: { TASKS: 12.5, SEP: -1, CPU: 5 } })).toEqual([
      'Valid from must be a real date (YYYY-MM-DD).',
      'TASKS must be a whole number of 0 or more.',
      'SEP must be a whole number of 0 or more.',
      'Unknown measure "CPU".',
    ])
  })
})
