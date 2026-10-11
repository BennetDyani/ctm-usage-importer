// Value checks. Nothing is ever rounded or reshaped (rule R7): a value is either an exact
// non-negative whole number or the file is refused.

/** "2026/06/17" -> "2026-06-17" if it is a real calendar date, else null. */
export function parseUsageDate(cell: string): string | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(cell.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Date.UTC(+y, +mo - 1, +d))
  const real = dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d
  return real ? `${y}-${mo}-${d}` : null
}

export type CountResult = { ok: true; value: number } | { ok: false; reason: 'invalid_number' | 'number_too_large' }

/** Exact non-negative integer. "12.5", "-3", "1,000", "" and "1e3" are all refused. */
export function parseCount(cell: string): CountResult {
  const s = cell.trim()
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid_number' }
  const value = Number(s)
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'number_too_large' }
  return { ok: true, value }
}
