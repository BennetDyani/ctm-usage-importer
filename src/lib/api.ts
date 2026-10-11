// Browser client for our own /api routes. Every call resolves to a tagged result, never throws,
// so pages can always show a clear message (including "the API isn't running").
import type { Issue } from '../../lib/parse'

export interface UploadOk {
  status: 'loaded' | 'already_loaded'
  batchId: number
  environment: string
  files: { kind: string; name: string; action: 'inserted' | 'unchanged' | 'reactivated'; rows?: number }[]
  summary: { taskRows: number; endpointRows: number; days: number; firstDay?: string; lastDay?: string }
  warnings: Issue[]
}
export interface UploadRejected { status: 'rejected'; batchId: number; issues: Issue[] }
export interface Batch {
  id: number
  createdAt: string
  uploaderId: string
  customer: string
  environment: string
  status: 'loaded' | 'already_loaded' | 'rejected'
  files: { name: string; kind: string; rows: number; status: string }[]
  errorCount: number
  warningCount: number
}

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'offline'; message: string }

const OFFLINE = 'The server functions aren\'t running here. Use the deployed site, or run "npx vercel dev" locally.'

async function call<T>(url: string, init?: RequestInit, accept: number[] = [200]): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { kind: 'offline', message: 'The server could not be reached. Check your connection and try again.' }
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  if (!isJson) return { kind: 'offline', message: OFFLINE } // e.g. Vite dev server answering 404 with HTML
  const body = await res.json().catch(() => null)
  if (accept.includes(res.status) && body) return { kind: 'ok', data: body as T }
  return { kind: 'error', status: res.status, message: body?.message ?? `The server answered ${res.status}.` }
}

export function uploadFileSet(fields: { uploaderId: string; customer: string; environment: string }, files: { file1: File; file2: File; addons?: File }) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('file1', files.file1)
  form.set('file2', files.file2)
  if (files.addons) form.set('addons', files.addons)
  // 422 (refused, with reasons) is an expected answer, not a failure
  return call<UploadOk | UploadRejected>('/api/upload', { method: 'POST', body: form }, [200, 422])
}

export const recentBatches = (limit = 10) => call<{ batches: Batch[] }>(`/api/batches?limit=${limit}`)

// ---------------------------------------------------------------- customers & contracts
export type MetricCode = 'TASKS' | 'SEP' | 'MIPS'
export interface CustomerRow { id: number; name: string; environments: string[]; firstDay: string | null; lastDay: string | null }
export interface ContractData {
  customer: { id: number; name: string }
  contract: Partial<Record<MetricCode, { value: number; validFrom: string | null; enteredBy: string; enteredAt: string }>>
  addons: { product: string; licensed: boolean; installedIn: string[] }[]
  summary: Record<string, { fourthHighest: number | null; fourthDate: string | null; contracted: number | null; headroom: number | null; status: string }>
}
export interface ContractSave {
  customerId: number
  enteredBy: string
  validFrom: string | null
  values: Record<MetricCode, number | null>
  licensed: string[]
}

export const listCustomers = () => call<{ customers: CustomerRow[] }>('/api/customers')
export const getContract = (customerId: number) => call<ContractData>(`/api/contracts?customerId=${customerId}`)
export const saveContract = (body: ContractSave) =>
  call<ContractData & { status: 'saved' }>('/api/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

// ---------------------------------------------------------------- report (Phase 6)
export type ReportMetric = 'TASKS' | 'SEP' | 'FT_TASKS' | 'MFT_FILES'
export type ComplianceStatus = 'not_enough_data' | 'no_usage' | 'no_contract' | 'over_contract' | 'within_contract'
export interface MetricSummary {
  daysWithData: number
  peak: number | null
  peakDate: string | null
  fourthHighest: number | null
  fourthDate: string | null
  contracted: number | null
  headroom: number | null
  status: ComplianceStatus
}
export interface MonthRow { month: string; peak: number; peakDate: string; average: number; days: number }
export interface ReportData {
  customer: { id: number; name: string }
  environments: string[]
  window: { from: string | null; to: string | null }
  contract: ContractData['contract']
  metrics: Record<ReportMetric, {
    summary: MetricSummary | null // null: no rows for this measure at all
    days: { date: string; total: number; rank: number; byEnv: Record<string, number> }[]
    monthly: MonthRow[]
  }>
  addons: { product: string; licensed: boolean; installedIn: string[] }[]
  coverage: { environment: string; firstDay: string; lastDay: string; days: number; missingDays: number; zeroTaskDays: number; uploadedAt: string }[]
}

export const getReport = (customerId: number) => call<ReportData>(`/api/report?customerId=${customerId}`)

// ---------------------------------------------------------------- analysis agent (Phase 7)
export interface AgentAnswer {
  answer: string
  toolsUsed: { tool: string; args: unknown; source: string; ok: boolean }[]
  model: string | null
}
export const askAgent = (body: { message: string; customer?: string; history: { role: 'user' | 'assistant'; content: string }[] }) =>
  call<AgentAnswer>('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
