// Shared by the Report page and the analysis agent, so both explain the "wrong method" with the same numbers.

export interface DayWithEnvs { total: number; byEnv: Record<string, number> }

/** Each environment's own 4th-highest day (ties count as separate days, like ROW_NUMBER). */
export function perEnvFourths(envs: string[], days: DayWithEnvs[]): Record<string, number> {
  return Object.fromEntries(envs.map((env) => {
    const vals = days.map((d) => d.byEnv[env] ?? 0).sort((a, b) => b - a)
    return [env, vals[3] ?? 0]
  }))
}

/** The tempting wrong answer: each environment's own 4th-highest day, added together. */
export function sumOfPerEnvFourths(envs: string[], days: DayWithEnvs[]): number {
  return Object.values(perEnvFourths(envs, days)).reduce((a, b) => a + b, 0)
}
