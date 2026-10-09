import type { Customer } from './compliance'
import data from '../preview/sample-data.json'

export type Page = 'report' | 'upload' | 'contracts'
export type ContractMetric = 'tasks' | 'sep' | 'mips'

export interface Contract {
  tasks?: number
  sep?: number
  mips?: number
  validFrom?: string
  licensed: string[]
}

export const METRIC_LABEL: Record<ContractMetric, { name: string; unit: string; long: string }> = {
  tasks: { name: 'Tasks', unit: 'tasks', long: 'Tasks per day' },
  sep: { name: 'SEP', unit: 'server endpoints', long: 'Server endpoints per day' },
  mips: { name: 'MIPS', unit: 'MIPS', long: 'Mainframe MIPS per day' },
}

export const CUSTOMERS = data.customers as unknown as Customer[]

/** Colour follows the environment, never its rank: index in the customer's own env order. */
export const envColor = (customer: Customer, env: string) =>
  `var(--env-${(customer.envs.indexOf(env) % 3) + 1})`
