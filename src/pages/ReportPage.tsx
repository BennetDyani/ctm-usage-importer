import { useMemo, useState } from 'react'
import UsageStrip from '../components/UsageStrip'
import { AlertIcon, AskIcon, CheckIcon } from '../components/Icons'
import { summarise, sumOfPerEnvFourths, type Customer, type Summary } from '../lib/compliance'
import { fmt, fmtDate, possessive, productName } from '../lib/format'
import { CUSTOMERS, METRIC_LABEL, envColor, type Contract, type ContractMetric } from '../lib/types'

interface Props {
  customer: Customer
  onCustomer: (name: string) => void
  contract?: Contract
  onEditContract: () => void
  onAsk: () => void
}

export default function ReportPage({ customer, onCustomer, contract, onEditContract, onAsk }: Props) {
  const [metric, setMetric] = useState<ContractMetric>('tasks')
  const [showTable, setShowTable] = useState(false)
  const first = customer.days[0]?.date
  const last = customer.days.at(-1)?.date

  const summary = useMemo(() => (metric === 'mips' ? null : summarise(customer, metric)), [customer, metric])
  const label = METRIC_LABEL[metric]
  const contracted = contract?.[metric]

  return (
    <article className="sheet">
      <div className="report-top">
        <div className="context">
          <label className="visually-hidden" htmlFor="customer">Customer</label>
          <select id="customer" className="select" value={customer.name} onChange={(e) => onCustomer(e.target.value)}>
            {CUSTOMERS.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          {first && last && <span className="num">{fmtDate(first)} to {fmtDate(last)}</span>}
          <span className="env-list" aria-label="Environments">
            {customer.envs.map((env) => (
              <span key={env}><i className="env-dot" style={{ background: envColor(customer, env) }} />{env}</span>
            ))}
          </span>
        </div>
        <div className="segmented" role="group" aria-label="Usage measure">
          {(Object.keys(METRIC_LABEL) as ContractMetric[]).map((m) => (
            <button key={m} aria-pressed={m === metric} onClick={() => setMetric(m)}>{METRIC_LABEL[m].name}</button>
          ))}
        </div>
      </div>

      {summary ? (
        <>
          <Hero customer={customer} summary={summary} unit={label.unit} contracted={contracted} onEditContract={onEditContract} />

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
            {showTable ? (
              <DayTable customer={customer} summary={summary} />
            ) : (
              <UsageStrip key={`${customer.name}-${metric}`} customer={customer} summary={summary} unit={label.unit} contract={contracted} />
            )}
          </div>

          <section className="section two-col" aria-labelledby="busiest">
            <div>
              <div className="section-head">
                <h2 id="busiest">Busiest days</h2>
                <p>Each bar adds the environments together for that day. Ranking happens after adding.</p>
              </div>
              <p className="env-list ladder-key" aria-hidden="true">
                {customer.envs.map((env) => (
                  <span key={env}><i className="env-dot" style={{ background: envColor(customer, env) }} />{env}</span>
                ))}
              </p>
              <Ladder customer={customer} summary={summary} />
              <Trap customer={customer} summary={summary} unit={label.unit} />
            </div>
            <aside>
              <h2 className="aside-title">How the figure is made</h2>
              <ol className="method">
                <li><div><strong>Add up each day</strong>Every environment's usage for the same date is added together, {customer.envs.length} environments per day.</div></li>
                <li><div><strong>Rank the days</strong>All {summary.days.length} combined days are sorted from busiest to quietest.</div></li>
                <li><div><strong>Take the 4th</strong>BMC evaluates compliance on the 4th-highest day, so one or two unusual spikes don't decide the renewal.</div></li>
              </ol>
              <button className="btn secondary" style={{ marginTop: '1.5rem' }} onClick={onAsk}>
                <AskIcon /> Ask about this data
              </button>
            </aside>
          </section>
        </>
      ) : (
        <div className="empty">
          <h2>No mainframe data for {customer.name}</h2>
          <p>MIPS comes from SCRT reports produced by Control-M for z/OS. This customer's uploads are distributed files only, so there is nothing to rank yet.</p>
          {contract?.mips !== undefined && <p className="num">Contracted: {fmt(contract.mips)} MIPS.</p>}
        </div>
      )}

      <AddOns customer={customer} contract={contract} />
      <Coverage customer={customer} />
    </article>
  )
}

function Hero({ customer, summary, unit, contracted, onEditContract }: {
  customer: Customer; summary: Summary; unit: string; contracted?: number; onEditContract: () => void
}) {
  const { fourth, allZero, envCount } = summary
  if (!fourth) {
    return (
      <div className="hero">
        <h1>{customer.name} has fewer than four days of data.</h1>
        <p className="sub">Upload at least four days before a compliance figure can be calculated.</p>
      </div>
    )
  }
  if (allZero) {
    return (
      <div className="hero">
        <h1>{customer.name} recorded no {unit} in this period.</h1>
        <p className="sub">Every day is 0, so there is no 4th-highest day to evaluate.</p>
      </div>
    )
  }
  const headroom = contracted !== undefined ? contracted - fourth.total : undefined
  return (
    <div className="hero">
      <h1>{possessive(customer.name)} 4th-busiest day used {fmt(fourth.total)} {unit}.</h1>
      <p className="sub">
        On {fmtDate(fourth.date)}, with {envCount === 1 ? 'its only environment' : envCount === 2 ? 'both environments added together' : `all ${envCount} environments added together`}. BMC uses this day to check the contract.
      </p>
      <div className="verdict">
        {headroom === undefined ? (
          <>
            <span className="muted">No contracted value for {unit} yet.</span>
            <button className="link-btn" onClick={onEditContract}>Add contracted values</button>
          </>
        ) : headroom >= 0 ? (
          <span className="status good"><CheckIcon /> Within contract: {fmt(headroom)} below the {fmt(contracted!)} contracted</span>
        ) : (
          <span className="status bad"><AlertIcon /> Over contract by {fmt(-headroom)} ({fmt(contracted!)} contracted)</span>
        )}
      </div>
    </div>
  )
}

function Ladder({ customer, summary }: { customer: Customer; summary: Summary }) {
  const top = summary.ranked.slice(0, 10)
  const max = top[0]?.total || 1
  return (
    <div className="ladder" role="list">
      {top.map((d) => (
        <div key={d.date} role="listitem" className={d.rank === 4 ? 'ladder-row is-fourth' : 'ladder-row'}>
          <span className="rank">{d.rank}</span>
          <span className="num">{fmtDate(d.date)}</span>
          <span className="stack" style={{ width: `${(d.total / max) * 100}%` }} aria-label={customer.envs.map((e) => `${e} ${fmt(d.byEnv[e] ?? 0)}`).join(', ')}>
            {customer.envs.map((env) => {
              const v = d.byEnv[env] ?? 0
              return v > 0 ? <i key={env} title={`${env}: ${fmt(v)}`} style={{ flex: v, background: envColor(customer, env) }} /> : null
            })}
          </span>
          <span className="value">{fmt(d.total)}</span>
          {d.rank === 4 && <span className="fourth-tag">This is the day BMC uses for compliance.</span>}
        </div>
      ))}
    </div>
  )
}

function Trap({ customer, summary, unit }: { customer: Customer; summary: Summary; unit: string }) {
  if (!summary.fourth || summary.allZero || customer.envs.length < 2) return null
  const wrong = sumOfPerEnvFourths(customer, summary.metric)
  const diff = wrong - summary.fourth.total
  if (diff === 0) return null
  return (
    <p className="trap">
      <strong>Why not add each environment's own 4th-busiest day?</strong> That gives {fmt(wrong)} {unit}, {fmt(diff)} more than the real figure.
      The environments peak on different days, so adding their peaks counts usage that never happened on a single day.
    </p>
  )
}

function DayTable({ customer, summary }: { customer: Customer; summary: Summary }) {
  return (
    <div className="table-scroll">
      <table className="data num">
        <thead>
          <tr><th>Date</th>{customer.envs.map((e) => <th key={e} className="r">{e}</th>)}<th className="r">Combined</th><th className="r">Rank</th></tr>
        </thead>
        <tbody>
          {[...summary.days].reverse().map((d) => (
            <tr key={d.date}>
              <td>{fmtDate(d.date)}</td>
              {customer.envs.map((e) => <td key={e} className="r">{fmt(d.byEnv[e] ?? 0)}</td>)}
              <td className="r">{fmt(d.total)}</td>
              <td className="r">{d.rank}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AddOns({ customer, contract }: { customer: Customer; contract?: Contract }) {
  const ft = summarise(customer, 'ft')
  const mft = summarise(customer, 'mft')
  const products = Object.entries(customer.addons)
  const installed = products.filter(([, envs]) => Object.values(envs).some(Boolean))
  const notInstalled = products.length - installed.length
  return (
    <section className="section" aria-labelledby="addons">
      <div className="section-head">
        <h2 id="addons">Add-ons</h2>
        <p>File transfer usage comes from the task files. Installed status comes from each environment's add-ons file.</p>
      </div>
      <div className="figures">
        {[{ s: ft, name: 'File transfer jobs', unit: 'jobs' }, { s: mft, name: 'Files transferred', unit: 'files' }].map(({ s, name, unit }) => (
          <div className="figure" key={name}>
            <div className="label">{name}, 4th-busiest day</div>
            {s.allZero || !s.fourth ? (
              <div className="meta">No file transfer activity</div>
            ) : (
              <>
                <div className="value">{fmt(s.fourth.total)}</div>
                <div className="meta">{unit} on {fmtDate(s.fourth.date)}</div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="data">
          <thead>
            <tr><th>Installed add-on</th>{customer.envs.map((e) => <th key={e}>{e}</th>)}<th>Licensed</th></tr>
          </thead>
          <tbody>
            {installed.map(([product, envs]) => (
              <tr key={product}>
                <td>{productName(product)}</td>
                {customer.envs.map((e) => (
                  <td key={e}>{envs[e]
                    ? <span className="mark-yes"><CheckIcon size={16} /><span className="visually-hidden">Installed</span></span>
                    : <span className="mark-no" aria-label="Not installed">–</span>}</td>
                ))}
                <td>{!contract ? <span className="no">Not recorded</span>
                  : contract.licensed.includes(product) ? 'Yes' : <span className="no">No</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notInstalled > 0 && <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: '0.75rem' }}>{notInstalled} other add-ons are not installed in any environment.</p>}
    </section>
  )
}

function Coverage({ customer }: { customer: Customer }) {
  return (
    <section className="section" aria-labelledby="coverage">
      <div className="section-head">
        <h2 id="coverage">Data coverage</h2>
        <p>Every environment should cover the same 12 months. Gaps would make the combined days too low.</p>
      </div>
      <div className="table-scroll" style={{ maxHeight: 'none' }}><table className="data num nowrap">
        <thead><tr><th>Environment</th><th>First day</th><th>Last day</th><th className="r">Days</th><th className="r">Days with no tasks</th></tr></thead>
        <tbody>
          {customer.envs.map((env) => {
            const days = customer.days.filter((d) => d.env[env])
            const zero = days.filter((d) => d.env[env].tasks === 0).length
            return (
              <tr key={env}>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}><i className="env-dot" style={{ background: envColor(customer, env) }} />{env}</span></td>
                <td>{days[0] ? fmtDate(days[0].date) : 'None'}</td>
                <td>{days.at(-1) ? fmtDate(days.at(-1)!.date) : 'None'}</td>
                <td className="r">{days.length}</td>
                <td className="r">{zero}</td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </section>
  )
}
