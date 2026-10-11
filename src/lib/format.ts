const n = new Intl.NumberFormat('en-GB')
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const fmt = (v: number) => n.format(v)
export const fmtCompact = (v: number) => compact.format(v)
export const fmtDate = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`))
export const fmtDay = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`))
export const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`)

/** "Control-M for Databases" -> "Databases"; "Control-M Forecast" -> "Forecast". */
export const productName = (p: string) => p.replace(/^Control-M (for )?/, '')

/** Calendar days in the month of an ISO date ('2026-02-01' -> 28). */
export function daysInMonth(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
