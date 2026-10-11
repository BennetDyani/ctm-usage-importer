import { useEffect, useMemo, useState } from 'react'
import MonthlyTrend from '../components/MonthlyTrend'
import UsageStrip from '../components/UsageStrip'
import { AlertIcon, AskIcon, CheckIcon } from '../components/Icons'
import {
  getReport, listCustomers,
  type ApiResult, type CustomerRow, type MetricSummary, type MonthRow, type ReportData, type ReportMetric,
} from '../lib/api'
import { summaryFromSeries, sumOfPerEnvFourths, type Summary } from '../lib/compliance'
import { daysInMonth, fmt, fmtDate, possessive, productName } from '../lib/format'
import { METRIC_LABEL, envColor, type ContractMetric } from '../lib/types'

interface Props {
  customerName: string
  onCustomer: (name: string) => void
  onEditContract: () => void
  onUpload: () => void
  onAsk: () => void
}

const CODE: Record<Exclude<ContractMetric, 'mips'>, ReportMetric> = { tasks: 'TASKS', sep: 'SEP' }
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function ReportPage({ customerName, onCustomer, onEditContract, onUpload, onAsk }: Props) {
  const [customers, setCustomers] = useState<ApiResult<{ customers: CustomerRow[] }> | null>(null)
  const [report, setReport] = useState<ApiResult<ReportData> | null>(null)
  const [metric, setMetric] = useState<ContractMetric>('tasks')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { listCustomers().then(setCustomers) }, [attempt])

  const list = customers?.kind === 'ok' ? customers.data.customers : []
  const current = list.find((c) => c.name.toLowerCase() === customerName.toLowerCase()) ?? list[0]

  // When nothing is picked yet, the first customer is shown: tell the app, so the Ask panel knows the context.
  useEffect(() => {
    if (current && current.name !== customerName) onCustomer(current.name)
  }, [current?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the report whenever the customer changes. The previous report stays on screen (dimmed) meanwhile.
  useEffect(() => {
    if (!current) return
    let live = true
    getReport(current.id).then((r) => { if (live) setReport(r) })
    return () => { live = false }
  }, [current?.id, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => { setReport(null); setAttempt((a) => a + 1) }

  if (customers && customers.kind !== 'ok') return <Problem title="The report can't be loaded" message={customers.message} onRetry={retry} />
  if (customers && list.length === 0) {
    return (
      <article className="sheet">
        <div className="report-state">
          <h2>No usage data yet</h2>
          <p>The report appears once a customer's usage files are uploaded. Start with one environment; each one you add is combined per day automatically.</p>
          <button className="btn" onClick={onUpload}>Upload usage files</button>
        </div>
      </article>
    )
  }
  if (report && report.kind !== 'ok') return <Problem title="The report can't be loaded" message={report.message} onRetry={retry} />
  if (!report || !customers) {
    return (
      <article className="sheet" aria-busy="true">
        <div className="report-state"><p className="muted">Loading the report from the database…</p></div>
      </article>
    )
  }

  return (
    <Report data={report.data} customers={list} metric={metric} onMetric={setMetric} refreshing={report.data.customer.id !== current?.id}
      onCustomer={onCustomer} onEditContract={onEditContract} onAsk={onAsk} />
  )
}

function Problem({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <article className="sheet">
      <div className="report-state" role="alert">
        <h2>{title}</h2>
        <p>{message}</p>
        <button className="btn secondary" onClick={onRetry}>Try again</button>
      </div>
    </article>
  )
}

function Report({ data, customers, metric, onMetric, refreshing, onCustomer, onEditContract, onAsk }: {
  data: ReportData; customers: CustomerRow[]; metric: ContractMetric; onMetric: (m: ContractMetric) => void
  refreshing: boolean; onCustomer: (n: string) => void; onEditContract: () => void; onAsk: () => void
}) {
  const [showTable, setShowTable] = useState(false)
  const [showMonthTable, setShowMonthTable] = useState(false)
  const envs = data.environments
  const name = data.customer.name
  const code = metric === 'mips' ? null : CODE[metric]
  const block = code ? data.metrics[code] : null
  const summary = useMemo(() => (block ? summaryFromSeries(block.days) : null), [block])
  const label = METRIC_LABEL[metric]
  const contracted = block?.summary?.contracted ?? undefined

  return (
    <article className={refreshing ? 'sheet is-refreshing' : 'sheet'} aria-busy={refreshing}>
      <div className="report-top">
        <div className="context">
          <label className="visually-hidden" htmlFor="customer">Customer</label>
          <select id="customer" className="select" value={name} onChange={(e) => onCustomer(e.target.value)}>
            {customers.map((c) => <option key={c.id}>{c.name}</option>)}
          </select>
          {data.window.from && data.window.to && <span className="num">{fmtDate(data.window.from)} to {fmtDate(data.window.to)}</span>}
          <span className="env-list" aria-label="Environments">
            {envs.map((env) => (
              <span key={env}><i className="env-dot" style={{ background: envColor(envs, env) }} />{env}</span>
            ))}
          </span>
        </div>
        <div className="segmented" role="group" aria-label="Usage measure">
          {(Object.keys(METRIC_LABEL) as ContractMetric[]).map((m) => (
            <button key={m} aria-pressed={m === metric} onClick={() => onMetric(m)}>{METRIC_LABEL[m].name}</button>
          ))}
        </div>
      </div>

      {block && block.summary && summary ? (
        <>
          <Hero name={name} envCount={envs.length} s={block.summary} unit={label.unit} onEditContract={onEditContract} />

          <div className="strip-wrap">
            <div className="strip-tools">
              <span className="strip-key">
                <span><i className="key-bar" style={{ background: 'var(--bar-day)' }} />Every other day</span>
                <span><i className="key-bar" style={{ background: 'var(--bar-top)' }} />Busiest three days</span>
                <span><i className="key-bar" style={{ background: 'var(--bar-fourth)' }} />4th busiest: the day BMC uses</span>
              </span>
              <button className="link-btn" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
                {showTable ? 'Show chart' : 'Show as table'}
              </button>
            </div>
            {showTable
              ? <DayTable envs={envs} summary={summary} />
              : <UsageStrip key={`${name}-${metric}`} envs={envs} summary={summary} unit={label.unit} contract={contracted} />}
          </div>

          <section className="section" aria-labelledby="trend">
            <div className="section-head">
              <h2 id="trend">Month by month</h2>
              <p>Each bar is the busiest day of that month; the line across it is the average day. A rising trend shows how close the next renewal could get to the contract.</p>
            </div>
            <div className="strip-wrap" style={{ marginTop: 0 }}>
              <div className="strip-tools">
                <span className="strip-key">
                  <span><i className="key-bar" style={{ background: 'var(--bar-month)' }} />Busiest day of the month</span>
                  <span><i className="key-tick" />Average day</span>
                  <span><i className="key-bar" style={{ background: 'var(--bar-fourth)' }} />Month holding the 4th-busiest day</span>
                  {block.monthly.some((m) => m.days < daysInMonth(m.month)) && (
                    <span><i className="key-bar is-partial" style={{ background: 'var(--bar-month)' }} />Partial month</span>
                  )}
                </span>
                <button className="link-btn" onClick={() => setShowMonthTable((s) => !s)} aria-expanded={showMonthTable}>
                  {showMonthTable ? 'Show chart' : 'Show as table'}
                </button>
              </div>
              {showMonthTable
                ? <MonthTable months={block.monthly} fourthDate={block.summary.fourthDate} />
                : <MonthlyTrend key={`${name}-${metric}`} months={block.monthly} unit={label.unit} fourthDate={block.summary.fourthDate} contract={contracted} />}
            </div>
          </section>

          <section className="section two-col" aria-labelledby="busiest">
            <div>
              <div className="section-head">
                <h2 id="busiest">Busiest days</h2>
                <p>Each bar adds the environments together for that day. Ranking happens after adding.</p>
              </div>
              <p className="env-list ladder-key" aria-hidden="true">
                {envs.map((env) => (
                  <span key={env}><i className="env-dot" style={{ background: envColor(envs, env) }} />{env}</span>
                ))}
              </p>
              <Ladder envs={envs} summary={summary} />
              <Trap envs={envs} summary={summary} unit={label.unit} />
            </div>
            <aside>
              <h2 className="aside-title">How the figure is made</h2>
              <ol className="method">
                <li><div><strong>Add up each day</strong>Every environment's usage for the same date is added together, {envs.length} {envs.length === 1 ? 'environment' : 'environments'} per day.</div></li>
                <li><div><strong>Rank the days</strong>All {summary.days.length} combined days are sorted from busiest to quietest.</div></li>
                <li><div><strong>Take the 4th</strong>BMC evaluates compliance on the 4th-highest day, so one or two unusual spikes don't decide the renewal.</div></li>
              </ol>
              <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: '1rem' }}>Calculated in the database from the stored rows, every time this page loads.</p>
              <button className="btn secondary" style={{ marginTop: '1.5rem' }} onClick={onAsk}>
                <AskIcon /> Ask about this data
              </button>
            </aside>
          </section>
        </>
      ) : (
        <div className="empty">
          {metric === 'mips' ? (
            <>
              <h2>No mainframe data for {name}</h2>
              <p>MIPS comes from SCRT reports produced by Control-M for z/OS. This customer's uploads are distributed files only, so there is nothing to rank yet.</p>
              {data.contract.MIPS && <p className="num">Contracted: {fmt(data.contract.MIPS.value)} MIPS.</p>}
            </>
          ) : (
            <>
              <h2>No {label.unit} data for {name}</h2>
              <p>None of this customer's current uploads contain this measure.</p>
            </>
          )}
        </div>
      )}

      <AddOns data={data} />
      <Coverage data={data} />
    </article>
  )
}

function Hero({ name, envCount, s, unit, onEditContract }: {
  name: string; envCount: number; s: MetricSummary; unit: string; onEditContract: () => void
}) {
  if (s.status === 'not_enough_data' || s.fourthHighest === null || !s.fourthDate) {
    return (
      <div className="hero">
        <h1>{name} has fewer than four days of data.</h1>
        <p className="sub">Upload at least four days before a compliance figure can be calculated.</p>
      </div>
    )
  }
  if (s.status === 'no_usage') {
    return (
      <div className="hero">
        <h1>{name} recorded no {unit} in this period.</h1>
        <p className="sub">Every day is 0, so there is no 4th-highest day to evaluate.</p>
      </div>
    )
  }
  return (
    <div className="hero">
      <h1>{possessive(name)} 4th-busiest day used {fmt(s.fourthHighest)} {unit}.</h1>
      <p className="sub">
        On {fmtDate(s.fourthDate)}, with {envCount === 1 ? 'its only environment' : envCount === 2 ? 'both environments added together' : `all ${envCount} environments added together`}. BMC uses this day to check the contract.
      </p>
      <div className="verdict">
        {s.status === 'no_contract' || s.contracted === null || s.headroom === null ? (
          <>
            <span className="muted">No contracted value for {unit} yet.</span>
            <button className="link-btn" onClick={onEditContract}>Add contracted values</button>
          </>
        ) : s.status === 'within_contract' ? (
          <span className="status good"><CheckIcon /> Within contract: {fmt(s.headroom)} below the {fmt(s.contracted)} contracted</span>
        ) : (
          <span className="status bad"><AlertIcon /> Over contract by {fmt(-s.headroom)} ({fmt(s.contracted)} contracted)</span>
        )}
      </div>
    </div>
  )
}

function Ladder({ envs, summary }: { envs: string[]; summary: Summary }) {
  const top = summary.ranked.slice(0, 10)
  const max = top[0]?.total || 1
  return (
    <div className="ladder" role="list">
      {top.map((d) => (
        <div key={d.date} role="listitem" className={d.rank === 4 ? 'ladder-row is-fourth' : 'ladder-row'}>
          <span className="rank">{d.rank}</span>
          <span className="num">{fmtDate(d.date)}</span>
          <span className="stack" style={{ width: `${(d.total / max) * 100}%` }} aria-label={envs.map((e) => `${e} ${fmt(d.byEnv[e] ?? 0)}`).join(', ')}>
            {envs.map((env) => {
              const v = d.byEnv[env] ?? 0
              return v > 0 ? <i key={env} title={`${env}: ${fmt(v)}`} style={{ flex: v, background: envColor(envs, env) }} /> : null
            })}
          </span>
          <span className="value">{fmt(d.total)}</span>
          {d.rank === 4 && <span className="fourth-tag">This is the day BMC uses for compliance.</span>}
        </div>
      ))}
    </div>
  )
}

function Trap({ envs, summary, unit }: { envs: string[]; summary: Summary; unit: string }) {
  if (!summary.fourth || summary.allZero || envs.length < 2) return null
  const wrong = sumOfPerEnvFourths(envs, summary.days)
  const diff = wrong - summary.fourth.total
  if (diff === 0) return null
  return (
    <p className="trap">
      <strong>Why not add each environment's own 4th-busiest day?</strong> That gives {fmt(wrong)} {unit}, {fmt(diff)} more than the real figure.
      The environments peak on different days, so adding their peaks counts usage that never happened on a single day.
    </p>
  )
}

function DayTable({ envs, summary }: { envs: string[]; summary: Summary }) {
  return (
    <div className="table-scroll">
      <table className="data num">
        <thead>
          <tr><th>Date</th>{envs.map((e) => <th key={e} className="r">{e}</th>)}<th className="r">Combined</th><th className="r">Rank</th></tr>
        </thead>
        <tbody>
          {[...summary.days].reverse().map((d) => (
            <tr key={d.date}>
              <td>{fmtDate(d.date)}</td>
              {envs.map((e) => <td key={e} className="r">{fmt(d.byEnv[e] ?? 0)}</td>)}
              <td className="r">{fmt(d.total)}</td>
              <td className="r">{d.rank}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MonthTable({ months, fourthDate }: { months: MonthRow[]; fourthDate: string | null }) {
  return (
    <div className="table-scroll" style={{ maxHeight: 'none' }}>
      <table className="data num nowrap">
        <thead>
          <tr><th>Month</th><th className="r">Busiest day</th><th>On</th><th className="r">Average day</th><th className="r">Days in data</th></tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{monthYear.format(new Date(`${m.month}T00:00:00Z`))}{fourthDate?.slice(0, 7) === m.month.slice(0, 7) && ' (4th-busiest day)'}</td>
              <td className="r">{fmt(m.peak)}</td>
              <td>{fmtDate(m.peakDate)}</td>
              <td className="r">{fmt(Math.round(m.average))}</td>
              <td className="r">{m.days} of {daysInMonth(m.month)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AddOns({ data }: { data: ReportData }) {
  const envs = data.environments
  const installed = data.addons.filter((a) => a.installedIn.length > 0)
  const notInstalled = data.addons.length - installed.length
  const hasContract = Object.keys(data.contract).length > 0 || data.addons.some((a) => a.licensed)
  const figures: { s: MetricSummary | null; name: string; unit: string }[] = [
    { s: data.metrics.FT_TASKS.summary, name: 'File transfer jobs', unit: 'jobs' },
    { s: data.metrics.MFT_FILES.summary, name: 'Files transferred', unit: 'files' },
  ]
  return (
    <section className="section" aria-labelledby="addons">
      <div className="section-head">
        <h2 id="addons">Add-ons</h2>
        <p>File transfer usage comes from the task files. Installed status comes from each environment's add-ons file; licensed comes from the contract.</p>
      </div>
      <div className="figures">
        {figures.map(({ s, name, unit }) => (
          <div className="figure" key={name}>
            <div className="label">{name}, 4th-busiest day</div>
            {!s || s.status === 'no_usage' || s.fourthHighest === null || !s.fourthDate ? (
              <div className="meta">No file transfer activity</div>
            ) : (
              <>
                <div className="value">{fmt(s.fourthHighest)}</div>
                <div className="meta">{unit} on {fmtDate(s.fourthDate)}</div>
              </>
            )}
          </div>
        ))}
      </div>
      {installed.length > 0 && (
        <div className="table-scroll" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr><th>Installed add-on</th>{envs.map((e) => <th key={e}>{e}</th>)}<th>Licensed</th></tr>
            </thead>
            <tbody>
              {installed.map((a) => (
                <tr key={a.product}>
                  <td>{productName(a.product)}</td>
                  {envs.map((e) => (
                    <td key={e}>{a.installedIn.includes(e)
                      ? <span className="mark-yes"><CheckIcon size={16} /><span className="visually-hidden">Installed</span></span>
                      : <span className="mark-no" aria-label="Not installed">–</span>}</td>
                  ))}
                  <td>{!hasContract ? <span className="no">Not recorded</span> : a.licensed ? 'Yes' : <span className="no">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: '0.75rem' }}>
        {installed.length === 0 ? 'No add-ons file uploaded yet, or nothing installed. ' : ''}
        {notInstalled > 0 && installed.length > 0 ? `${notInstalled} other add-ons are not installed in any environment.` : ''}
      </p>
    </section>
  )
}

function Coverage({ data }: { data: ReportData }) {
  const envs = data.environments
  return (
    <section className="section" aria-labelledby="coverage">
      <div className="section-head">
        <h2 id="coverage">Data coverage</h2>
        <p>Every environment should cover the same 12 months. Missing days would make the combined days too low.</p>
      </div>
      <div className="table-scroll" style={{ maxHeight: 'none' }}><table className="data num nowrap">
        <thead><tr><th>Environment</th><th>First day</th><th>Last day</th><th className="r">Days</th><th className="r">Missing days</th><th className="r">Days with no tasks</th></tr></thead>
        <tbody>
          {data.coverage.map((c) => (
            <tr key={c.environment}>
              <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}><i className="env-dot" style={{ background: envColor(envs, c.environment) }} />{c.environment}</span></td>
              <td>{fmtDate(c.firstDay)}</td>
              <td>{fmtDate(c.lastDay)}</td>
              <td className="r">{c.days}</td>
              <td className="r">{c.missingDays > 0 ? <span className="status bad">{c.missingDays}</span> : 0}</td>
              <td className="r">{c.zeroTaskDays}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  )
}
