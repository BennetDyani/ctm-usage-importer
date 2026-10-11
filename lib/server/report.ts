// Everything the Report page shows for one customer, read through ctm_reader only.
// Every number comes from the read functions in db/migrations/004 — the browser does no ranking.
import { db } from './db.js'

export const REPORT_METRICS = ['TASKS', 'SEP', 'FT_TASKS', 'MFT_FILES'] as const
export type ReportMetric = (typeof REPORT_METRICS)[number]

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function readReport(customerId: number) {
  const sql = db('reader')
  const [customer] = await sql`
    select id, name, environments, first_day::text as first_day, last_day::text as last_day
      from ctm.list_customers() where id = ${customerId}`
  if (!customer) return null

  const series = (metric: ReportMetric) => sql`
    select usage_date::text as date, total, rank, by_env from ctm.daily_series(${customerId}, ${metric})`
  const monthly = (metric: ReportMetric) => sql`
    select month::text as month, peak, peak_date::text as peak_date, average, days from ctm.monthly_trend(${customerId}, ${metric})`

  const [window, summary, contract, addons, coverage, ...perMetric] = await Promise.all([
    sql`select from_date::text as from_date, to_date::text as to_date from ctm.report_window(${customerId})`,
    sql`select metric, days_with_data, peak, peak_date::text as peak_date, fourth_highest, fourth_date::text as fourth_date,
               contracted, headroom, status from ctm.compliance_summary(${customerId})`,
    sql`select metric, contracted_value, valid_from::text as valid_from, entered_by, entered_at from ctm.get_contract(${customerId})`,
    sql`select product, licensed, installed_in from ctm.addon_usage(${customerId})`,
    sql`select environment, first_day::text as first_day, last_day::text as last_day, days, missing_days, zero_task_days, uploaded_at
          from ctm.coverage(${customerId})`,
    ...REPORT_METRICS.flatMap((m) => [series(m), monthly(m)]),
  ])

  const metrics = Object.fromEntries(REPORT_METRICS.map((m, i) => {
    const s = summary.find((r) => r.metric === m)
    const days = perMetric[i * 2]
    const months = perMetric[i * 2 + 1]
    return [m, {
      summary: s ? {
        daysWithData: s.days_with_data,
        peak: num(s.peak), peakDate: s.peak_date,
        fourthHighest: num(s.fourth_highest), fourthDate: s.fourth_date,
        contracted: num(s.contracted), headroom: num(s.headroom),
        status: s.status as string,
      } : null,
      days: days.map((d) => ({ date: d.date, total: Number(d.total), rank: d.rank, byEnv: d.by_env as Record<string, number> })),
      monthly: months.map((r) => ({
        month: r.month, peak: Number(r.peak), peakDate: r.peak_date, average: Number(r.average), days: r.days,
      })),
    }]
  }))

  return {
    customer: { id: Number(customer.id), name: customer.name as string },
    environments: customer.environments as string[],
    window: window[0] ? { from: window[0].from_date as string | null, to: window[0].to_date as string | null } : { from: null, to: null },
    contract: Object.fromEntries(contract.map((c) => [c.metric, {
      value: Number(c.contracted_value), validFrom: c.valid_from, enteredBy: c.entered_by, enteredAt: c.entered_at,
    }])),
    metrics,
    addons: addons.map((a) => ({ product: a.product as string, licensed: a.licensed as boolean, installedIn: a.installed_in as string[] })),
    coverage: coverage.map((c) => ({
      environment: c.environment as string, firstDay: c.first_day as string, lastDay: c.last_day as string,
      days: c.days as number, missingDays: c.missing_days as number, zeroTaskDays: c.zero_task_days as number,
      uploadedAt: c.uploaded_at,
    })),
  }
}

export type ReportData = NonNullable<Awaited<ReturnType<typeof readReport>>>
