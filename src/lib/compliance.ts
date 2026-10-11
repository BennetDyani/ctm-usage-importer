// Combine-then-rank (rules R2 + R4).
// The live report takes its ranks from SQL (ctm.daily_series) via summaryFromSeries().
// summarise() is a second, independent implementation used only by the tests, to prove the
// two agree on the bundled sample files (src/preview/sample-data.json).

export type Metric = 'tasks' | 'sep' | 'ft' | 'mft'
export type EnvUsage = Record<Metric, number>
export interface Day { date: string; env: Record<string, EnvUsage> }
export interface Customer { name: string; envs: string[]; days: Day[]; addons: Record<string, Record<string, boolean>> }

export interface CombinedDay { date: string; total: number; byEnv: Record<string, number>; rank: number }

export interface Summary {
  days: CombinedDay[] // chronological, each with its rank (1 = highest)
  ranked: CombinedDay[] // highest first; ties ordered by earlier date
  fourth: CombinedDay | null // null when fewer than 4 days (A7)
  allZero: boolean // A18: every day is 0, so "4th highest" is meaningless
}

/** Build the view model from rows the database already ranked. */
export function summaryFromSeries(days: CombinedDay[]): Summary {
  const ranked = [...days].sort((a, b) => a.rank - b.rank)
  return {
    days,
    ranked,
    fourth: ranked.length >= 4 ? ranked[3] : null,
    allZero: days.every((d) => d.total === 0),
  }
}

/** Test-only reference: step 1 add every environment per day, step 2 rank, step 3 take the 4th. */
export function summarise(customer: Customer, metric: Metric): Summary {
  const combined = customer.days.map((d) => {
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
  return summaryFromSeries(combined)
}

/** The tempting wrong answer: each environment's own 4th-highest day, added together. */
export function sumOfPerEnvFourths(envs: string[], days: CombinedDay[]): number {
  return envs.reduce((sum, env) => {
    const vals = days.map((d) => d.byEnv[env] ?? 0).sort((a, b) => b - a)
    return sum + (vals[3] ?? 0)
  }, 0)
}
