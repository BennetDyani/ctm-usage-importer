// File-name rules (brief + slide 4):
//   File 1 (tasks):     ALL_per_task_<ENV>.csv   e.g. ALL_per_task_QA.csv
//   File 2 (endpoints): ALL<ENV>.csv             e.g. ALLQA.csv
//   Add-ons (optional): addons_<ENV>.csv         e.g. addons_QA.csv
// File 1 names also start with "ALL", so File 1's pattern is always tested first.

const ENV = '([A-Za-z0-9][A-Za-z0-9-]*)'
const TASKS = new RegExp(`^ALL_per_task_${ENV}\\.csv$`, 'i')
const ENDPOINTS = new RegExp(`^ALL${ENV}\\.csv$`, 'i')
const ADDONS = new RegExp(`^addons_${ENV}\\.csv$`, 'i')

export type FileKind = 'dist_tasks' | 'dist_endpoints' | 'addons'

/** The environment written in a file name, or null if the name breaks the rule for that kind. */
export function envFromFileName(name: string, kind: FileKind): string | null {
  const base = name.split(/[\\/]/).pop() ?? name
  if (kind === 'dist_tasks') return TASKS.exec(base)?.[1] ?? null
  if (kind === 'addons') return ADDONS.exec(base)?.[1] ?? null
  if (TASKS.test(base) || /^ALL_/i.test(base)) return null // a File 1 name is never a valid File 2
  return ENDPOINTS.exec(base)?.[1] ?? null
}

/** Which kind of file a name looks like (used later by multi-file and folder import). */
export function detectKind(name: string): FileKind | null {
  for (const kind of ['dist_tasks', 'addons', 'dist_endpoints'] as const) {
    if (envFromFileName(name, kind)) return kind
  }
  return null
}

/** Environment names are compared case-insensitively (Prod = PROD), assumption A11. */
export const sameEnv = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
