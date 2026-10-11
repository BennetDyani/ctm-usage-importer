// The agent's tools. Each one is a fixed, read-only call to a SQL function in db/migrations/004,
// run as ctm_reader. The model only chooses a tool and fills in arguments; every argument is
// checked here before any SQL runs, and the model never writes SQL.
import type postgres from 'postgres'
import { perEnvFourths } from '../shared/ranking.js'

export const METRICS = ['TASKS', 'SEP', 'MIPS', 'FT_TASKS', 'MFT_FILES'] as const
export type Metric = (typeof METRICS)[number]

/** OpenAI-compatible tool definitions, sent to the model with every request. */
const customer = { type: 'string', description: 'Customer name, as the user wrote it (case does not matter).' }
const metric = {
  type: 'string', enum: METRICS,
  description: 'TASKS = tasks per day; SEP = server endpoints; MIPS = mainframe; FT_TASKS = file transfer jobs; MFT_FILES = files transferred.',
}
const from = { type: 'string', description: 'Optional start date, YYYY-MM-DD. Leave out for the default 12 months.' }
const to = { type: 'string', description: 'Optional end date, YYYY-MM-DD. Leave out for the default 12 months.' }
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } })

export const TOOL_DEFS = [
  fn('list_customers', 'List every customer with stored data, their environments and date range. Use when the customer is unclear or not found.'),
  fn('get_coverage', 'Which dates each environment covers, and any missing days. Call before answering anything about dates or periods.', { customer }, ['customer']),
  fn('get_compliance_summary', 'For every measure: the busiest day, the 4th-busiest combined day (the compliance figure), the contracted value, headroom and status.', { customer, from, to }, ['customer']),
  fn('get_top_days', 'The busiest combined days for one measure, ranked, with each environment\'s share.', { customer, metric, n: { type: 'integer', minimum: 1, maximum: 15, description: 'How many days (1-15). Default 10.' }, from, to }, ['customer', 'metric']),
  fn('get_monthly_trend', 'Month by month: busiest day and average day for one measure over the 12 months. Use for trends and growth.', { customer, metric }, ['customer', 'metric']),
  fn('get_addon_usage', 'Add-on products: which are installed in which environment, and which are licensed in the contract.', { customer }, ['customer']),
  fn('get_env_breakdown', 'One day\'s usage split by environment, with that day\'s rank. Use to explain which environment drove a day.', { customer, metric, date: { type: 'string', description: 'YYYY-MM-DD' } }, ['customer', 'metric', 'date']),
  fn('compare_methods', 'Compares the correct compliance figure (combine environments per day, then take the 4th-busiest day) with the wrong shortcut (add each environment\'s own 4th-busiest day).', { customer, metric }, ['customer', 'metric']),
]

export type ToolName = (typeof TOOL_DEFS)[number]['function']['name']
export const TOOL_NAMES = TOOL_DEFS.map((t) => t.function.name)

// ---------------------------------------------------------------- argument checks
export class ToolArgError extends Error {}

const isoDate = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolArgError(`${field} must be a date written YYYY-MM-DD.`)
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new ToolArgError(`${field} is not a real date.`)
  return v
}

export interface Args { customer?: string; metric?: Metric; n?: number; from?: string | null; to?: string | null; date?: string | null }

/** Check the model's arguments against the tool's definition. Throws ToolArgError with a reason the model can fix. */
export function checkArgs(tool: string, raw: unknown): Args {
  const def = TOOL_DEFS.find((t) => t.function.name === tool)
  if (!def) throw new ToolArgError(`There is no tool called "${tool}".`)
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const props = def.function.parameters.properties as Record<string, unknown>
  const unknown = Object.keys(a).filter((k) => !(k in props))
  if (unknown.length) throw new ToolArgError(`Unexpected argument(s): ${unknown.join(', ')}.`)
  for (const r of def.function.parameters.required) {
    if (a[r] === undefined || a[r] === null || a[r] === '') throw new ToolArgError(`${r} is required.`)
  }
  const out: Args = {}
  if ('customer' in a) {
    if (typeof a.customer !== 'string' || a.customer.trim().length === 0 || a.customer.length > 100) throw new ToolArgError('customer must be a name.')
    out.customer = a.customer.trim()
  }
  if ('metric' in a) {
    const m = typeof a.metric === 'string' ? a.metric.toUpperCase() : ''
    if (!(METRICS as readonly string[]).includes(m)) throw new ToolArgError(`metric must be one of ${METRICS.join(', ')}.`)
    out.metric = m as Metric
  }
  if ('n' in a) {
    const n = Number(a.n)
    if (!Number.isInteger(n) || n < 1 || n > 15) throw new ToolArgError('n must be a whole number from 1 to 15.')
    out.n = n
  }
  if ('from' in a) out.from = isoDate(a.from, 'from')
  if ('to' in a) out.to = isoDate(a.to, 'to')
  if (out.from && out.to && out.from > out.to) throw new ToolArgError('from must be on or before to.')
  if ('date' in a) out.date = isoDate(a.date, 'date')
  return out
}

// ---------------------------------------------------------------- running a tool
const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export interface ToolResult { data: unknown; source: string } // source: the "Based on" line shown under the answer

export async function runTool(sql: postgres.Sql, tool: string, rawArgs: unknown): Promise<ToolResult> {
  const args = checkArgs(tool, rawArgs)

  if (tool === 'list_customers') {
    const rows = await sql`select name, environments, first_day::text as first_day, last_day::text as last_day from ctm.list_customers()`
    return { source: 'list_customers', data: { customers: rows.map((r) => ({ name: r.name, environments: r.environments, firstDay: r.first_day, lastDay: r.last_day })) } }
  }

  // Every other tool is about one customer: resolve the name the way uploads do (case and spaces ignored, A12).
  const all = await sql`select id, name, environments from ctm.list_customers()`
  const c = all.find((r) => nameKey(r.name) === nameKey(args.customer!))
  if (!c) {
    return {
      source: 'list_customers',
      data: { error: 'unknown_customer', message: `No customer called "${args.customer}" has data.`, customers: all.map((r) => r.name) },
    }
  }
  const id = Number(c.id)
  const envs = c.environments as string[]
  const [w] = await sql`select from_date::text as from_date, to_date::text as to_date from ctm.report_window(${id}, ${args.from ?? null}, ${args.to ?? null})`
  const window = { from: w?.from_date ?? null, to: w?.to_date ?? null }
  const label = (fnName: string, extra = '') => `${fnName} (${c.name}${extra}${window.from ? `, ${window.from} to ${window.to}` : ''})`
  const base = { customer: c.name, environments: envs, period: window }

  switch (tool) {
    case 'get_coverage': {
      const rows = await sql`select environment, first_day::text as f, last_day::text as l, days, missing_days, zero_task_days from ctm.coverage(${id})`
      return {
        source: `coverage (${c.name})`,
        data: { ...base, coverage: rows.map((r) => ({ environment: r.environment, firstDay: r.f, lastDay: r.l, days: r.days, missingDays: r.missing_days, zeroTaskDays: r.zero_task_days })) },
      }
    }
    case 'get_compliance_summary': {
      const rows = await sql`select metric, days_with_data, peak, peak_date::text as peak_date, fourth_highest, fourth_date::text as fourth_date,
                                    contracted, headroom, status from ctm.compliance_summary(${id}, ${args.from ?? null}, ${args.to ?? null})`
      const measures = rows.map((r) => ({
        metric: r.metric, daysWithData: r.days_with_data, peak: num(r.peak), peakDate: r.peak_date,
        fourthHighest: num(r.fourth_highest), fourthDate: r.fourth_date, contracted: num(r.contracted), headroom: num(r.headroom), status: r.status,
      }))
      const notes = rows.some((r) => r.metric === 'MIPS') ? [] : ['No MIPS (mainframe) data is loaded for this customer.']
      return { source: label('compliance_summary'), data: { ...base, environmentCount: envs.length, measures, notes } }
    }
    case 'get_top_days': {
      const rows = await sql`select rank, usage_date::text as date, total, by_env from ctm.top_days(${id}, ${args.metric!}, ${args.n ?? 10}, ${args.from ?? null}, ${args.to ?? null})`
      return {
        source: label('top_days', `, ${args.metric}`),
        data: { ...base, metric: args.metric, days: rows.map((r) => ({ rank: r.rank, date: r.date, total: Number(r.total), byEnvironment: r.by_env })), ...noData(args.metric!, rows.length) },
      }
    }
    case 'get_monthly_trend': {
      const rows = await sql`select month::text as month, peak, peak_date::text as peak_date, average, days from ctm.monthly_trend(${id}, ${args.metric!})`
      return {
        source: label('monthly_trend', `, ${args.metric}`),
        data: {
          ...base, metric: args.metric,
          months: rows.map((r) => ({ month: r.month.slice(0, 7), busiestDay: Number(r.peak), busiestDate: r.peak_date, averageDay: Number(r.average), daysInData: r.days, partialMonth: r.days < daysIn(r.month) })),
          ...noData(args.metric!, rows.length),
        },
      }
    }
    case 'get_addon_usage': {
      const rows = await sql`select product, licensed, installed_in from ctm.addon_usage(${id})`
      const used = rows.filter((r) => r.licensed || r.installed_in.length > 0)
      return {
        source: `addon_usage (${c.name})`,
        data: {
          customer: c.name, environments: envs,
          addons: used.map((r) => ({ product: r.product, installedIn: r.installed_in, licensed: r.licensed })),
          notInstalledOrLicensed: rows.length - used.length,
          notes: ['File transfer volumes are measures, not add-ons: use FT_TASKS (jobs) or MFT_FILES (files) with the other tools.'],
        },
      }
    }
    case 'get_env_breakdown': {
      const [r] = await sql`select usage_date::text as date, total, rank, by_env from ctm.daily_series(${id}, ${args.metric!}) where usage_date = ${args.date!}::date`
      return {
        source: label('daily_series', `, ${args.metric}, ${args.date}`),
        data: r
          ? { ...base, metric: args.metric, date: r.date, total: Number(r.total), rankInPeriod: r.rank, byEnvironment: r.by_env }
          : { ...base, metric: args.metric, error: 'no_data_for_date', message: `No ${args.metric} data for ${args.date} in ${c.name}'s 12-month period.` },
      }
    }
    case 'compare_methods': {
      const days = await sql`select total, by_env from ctm.daily_series(${id}, ${args.metric!})`
      const [s] = await sql`select fourth_highest, fourth_date::text as fourth_date from ctm.compliance_summary(${id}) where metric = ${args.metric!}`
      if (!s || s.fourth_highest === null) return { source: label('compare_methods', `, ${args.metric}`), data: { ...base, metric: args.metric, ...noData(args.metric!, 0), error: 'not_enough_data' } }
      const series = days.map((d) => ({ total: Number(d.total), byEnv: d.by_env as Record<string, number> }))
      const each = perEnvFourths(envs, series)
      const wrong = Object.values(each).reduce((a, b) => a + b, 0)
      const right = Number(s.fourth_highest)
      return {
        source: label('compare_methods', `, ${args.metric}`),
        data: {
          ...base, metric: args.metric,
          correct: { method: 'combine environments per day, then take the 4th-busiest day', value: right, date: s.fourth_date },
          wrongShortcut: { method: "add each environment's own 4th-busiest day", value: wrong, perEnvironment: each },
          overstatement: wrong - right,
        },
      }
    }
  }
  throw new ToolArgError(`There is no tool called "${tool}".`)
}

function noData(metric: string, rows: number) {
  if (rows > 0) return {}
  return { note: metric === 'MIPS' ? 'No MIPS (mainframe) data is loaded for this customer.' : `No ${metric} data in this period.` }
}

function daysIn(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
