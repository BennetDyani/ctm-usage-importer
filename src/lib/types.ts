export type Page = 'report' | 'upload' | 'contracts'
export type ContractMetric = 'tasks' | 'sep' | 'mips'

export const METRIC_LABEL: Record<ContractMetric, { name: string; unit: string; long: string }> = {
  tasks: { name: 'Tasks', unit: 'tasks', long: 'Tasks per day' },
  sep: { name: 'SEP', unit: 'server endpoints', long: 'Server endpoints per day' },
  mips: { name: 'MIPS', unit: 'MIPS', long: 'Mainframe MIPS per day' },
}

/** Colour follows the environment, never its rank: index in the customer's own environment order. */
export const envColor = (envs: string[], env: string) => `var(--env-${(envs.indexOf(env) % 3) + 1})`
