// Combine-then-rank (rules R2 + R4). Used by the preview UI only; the real calculation
// lives in SQL (docs/04_data_model.md) and must produce the same numbers.

export type Metric = 'tasks' | 'sep' | 'ft' | 'mft'
export type EnvUsage = Record<Metric, number>
export interface Day { date: string; env: Record<string, EnvUsage> }
export interface Customer { name: string; envs: string[]; days: Day[]; addons: Record<string, Record<string, boolean>> }

export interface CombinedDay { date: string; total: number; byEnv: Record<string, number>; rank: number }

export interface Summary {
  metric: Metric
  days: CombinedDay[] // chronological, each with its rank (1 = highest)
  ranked: CombinedDay[] // highest first; ties ordered by earlier date
  fourth: CombinedDay | null // null when fewer than 4 days (A7)
  allZero: boolean // A18: every day is 0, so "4th highest" is meaningless
  envCount: number
}

/** Step 1: add every environment together per day. Step 2: rank days. Step 3: take the 4th. */
export function summarise(customer: Customer, metric: Metric, from?: string, to?: string): Summary {
  const inRange = customer.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
  const combined = inRange.map((d) => {
    const byEnv: Record<string, number> = {}
    let total = 0
    for (const [env, u] of Object.entries(d.env)) {
      byEnv[env] = u[metric]
      total += u[metric]
    }
    return { date: d.date, total, byEnv, rank: 0 }
  })
  const ranked = [...combined].sort((a, b) => b.total - a.total || a.date.localeCompare(b.date))
  ranked.forEach((d, i) => (d.rank = i + 1))
  return {
    metric,
    days: combined,
    ranked,
    fourth: ranked.length >= 4 ? ranked[3] : null,
    allZero: combined.every((d) => d.total === 0),
    envCount: customer.envs.length,
  }
}

/** The tempting wrong answer: each environment's own 4th-highest day, added together. */
export function sumOfPerEnvFourths(customer: Customer, metric: Metric): number {
  return customer.envs.reduce((sum, env) => {
    const vals = customer.days.map((d) => d.env[env]?.[metric] ?? 0).sort((a, b) => b - a)
    return sum + (vals[3] ?? 0)
  }, 0)
}
