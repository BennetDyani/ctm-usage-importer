// Validation for the Contracts screen. Pure: tested without a database.
export const METRICS = ['TASKS', 'SEP', 'MIPS'] as const
export type Metric = (typeof METRICS)[number]

export interface ContractInput {
  customerId: number
  validFrom: string | null
  enteredBy: string
  values: Partial<Record<Metric, number | null>>
  licensed: string[]
}

const MAX_VALUE = 1_000_000_000_000 // far above any real licence, well inside bigint

export function validateContract(body: unknown): { ok: true; value: ContractInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const b = (body ?? {}) as Record<string, unknown>

  const customerId = Number(b.customerId)
  if (!Number.isSafeInteger(customerId) || customerId <= 0) errors.push('customerId must be a positive whole number.')

  const enteredBy = typeof b.enteredBy === 'string' ? b.enteredBy.trim().slice(0, 100) : ''
  if (!enteredBy) errors.push('Your ID is required, so every contract change has a name on it.')

  let validFrom: string | null = null
  if (b.validFrom !== undefined && b.validFrom !== null && b.validFrom !== '') {
    const d = String(b.validFrom)
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)
    if (ok) validFrom = d
    else errors.push('Valid from must be a real date (YYYY-MM-DD).')
  }

  const values: ContractInput['values'] = {}
  const rawValues = (b.values ?? {}) as Record<string, unknown>
  if (typeof rawValues !== 'object' || Array.isArray(rawValues)) errors.push('values must be an object.')
  for (const [k, v] of Object.entries(rawValues ?? {})) {
    if (!(METRICS as readonly string[]).includes(k)) { errors.push(`Unknown measure "${k}".`); continue }
    if (v === null || v === '') { values[k as Metric] = null; continue }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''))
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_VALUE) errors.push(`${k} must be a whole number of 0 or more.`)
    else values[k as Metric] = n
  }

  const licensed = Array.isArray(b.licensed) ? b.licensed : []
  if (b.licensed !== undefined && !Array.isArray(b.licensed)) errors.push('licensed must be a list of add-on names.')
  if (licensed.length > 50 || licensed.some((p) => typeof p !== 'string' || p.length > 200)) errors.push('licensed contains invalid add-on names.')

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { customerId, validFrom, enteredBy, values, licensed: [...new Set(licensed as string[])] } }
}
