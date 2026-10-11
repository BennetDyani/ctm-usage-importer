import { useEffect, useState } from 'react'
import { AlertIcon, CheckIcon } from '../components/Icons'
import {
  getContract, listCustomers, saveContract,
  type ApiResult, type ContractData, type CustomerRow, type MetricCode,
} from '../lib/api'
import { fmt, fmtDate, productName } from '../lib/format'
import { CUSTOMERS, METRIC_LABEL, type Contract, type ContractMetric } from '../lib/types'

interface Props {
  customerName: string
  onCustomer: (name: string) => void
  onSaved: (name: string, c: Contract) => void // keeps the (preview) report in step until Phase 6
  onViewReport: () => void
}

const METRICS: ContractMetric[] = ['tasks', 'sep', 'mips']
const CODE: Record<ContractMetric, MetricCode> = { tasks: 'TASKS', sep: 'SEP', mips: 'MIPS' }
const ID_KEY = 'ctm-entered-by'

const clean = (v: string) => v.replace(/[\s,]/g, '')
const invalid = (v: string) => clean(v) !== '' && !/^\d+$/.test(clean(v))
const toNumber = (v: string) => (clean(v) === '' ? null : Number(clean(v)))

function rememberedId() {
  try { return localStorage.getItem(ID_KEY) ?? '' } catch { return '' }
}

export default function ContractsPage({ customerName, onCustomer, onSaved, onViewReport }: Props) {
  const [customers, setCustomers] = useState<ApiResult<{ customers: CustomerRow[] }> | null>(null)
  const [data, setData] = useState<ApiResult<ContractData> | null>(null)
  const [values, setValues] = useState<Record<ContractMetric, string>>({ tasks: '', sep: '', mips: '' })
  const [validFrom, setValidFrom] = useState('')
  const [enteredBy, setEnteredBy] = useState(rememberedId)
  const [licensed, setLicensed] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => { listCustomers().then(setCustomers) }, [])

  const list = customers?.kind === 'ok' ? customers.data.customers : []
  const current = list.find((c) => c.name.toLowerCase() === customerName.toLowerCase()) ?? list[0]

  // Load the saved contract whenever the customer changes.
  useEffect(() => {
    if (!current) return
    let live = true
    getContract(current.id).then((r) => {
      if (!live) return
      setData(r)
      setResult(null)
      if (r.kind !== 'ok') return
      const c = r.data.contract
      setValues({ tasks: c.TASKS?.value.toString() ?? '', sep: c.SEP?.value.toString() ?? '', mips: c.MIPS?.value.toString() ?? '' })
      setValidFrom(c.TASKS?.validFrom ?? c.SEP?.validFrom ?? c.MIPS?.validFrom ?? '')
      setLicensed(r.data.addons.filter((a) => a.licensed).map((a) => a.product))
    })
    return () => { live = false }
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setResult(null) }
  const loaded = data?.kind === 'ok' ? data.data : null
  const hasError = METRICS.some((m) => invalid(values[m]))
  const products = loaded?.addons ?? []
  const shown = showAll ? products : products.filter((a) => a.installedIn.length > 0 || a.licensed)
  const lastSaved = loaded && Object.values(loaded.contract).sort((a, b) => (b!.enteredAt > a!.enteredAt ? 1 : -1))[0]

  async function save() {
    if (!current) return
    setBusy(true)
    const r = await saveContract({
      customerId: current.id,
      enteredBy: enteredBy.trim(),
      validFrom: validFrom || null,
      values: { TASKS: toNumber(values.tasks), SEP: toNumber(values.sep), MIPS: toNumber(values.mips) },
      licensed,
    })
    setBusy(false)
    if (r.kind !== 'ok') return setResult({ ok: false, message: r.message })
    try { localStorage.setItem(ID_KEY, enteredBy.trim()) } catch { /* ignore */ }
    setData({ kind: 'ok', data: r.data })
    onSaved(current.name, {
      tasks: r.data.contract.TASKS?.value, sep: r.data.contract.SEP?.value, mips: r.data.contract.MIPS?.value,
      validFrom: validFrom || undefined, licensed,
    })
    setResult({ ok: true, message: 'Saved to the database.' })
  }

  if (customers && customers.kind !== 'ok') {
    return (
      <article className="sheet">
        <header className="page-head"><h1>Contracted values</h1></header>
        <div className="result bad"><h3>Contracts can't be loaded</h3><p className="result-text">{customers.message}</p></div>
      </article>
    )
  }
  if (customers && list.length === 0) {
    return (
      <article className="sheet">
        <header className="page-head">
          <h1>Contracted values</h1>
          <p>Contracts belong to a customer, and customers are created by their first upload. Upload a customer's usage files first.</p>
        </header>
      </article>
    )
  }

  return (
    <article className="sheet">
      <header className="page-head">
        <h1>Contracted values</h1>
        <p>What the customer is licensed for. The report compares the 4th-busiest day against these numbers. Leave a field empty if that measure isn't contracted.</p>
      </header>

      <div className="fields-3" style={{ marginBottom: '2rem' }}>
        <div className="field">
          <label htmlFor="c-customer">Customer</label>
          <select id="c-customer" className="select" value={current?.name ?? ''} onChange={(e) => onCustomer(e.target.value)} disabled={!customers}>
            {(list.length ? list.map((c) => c.name) : CUSTOMERS.map((c) => c.name)).map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="valid-from">Contract valid from</label>
          <input id="valid-from" type="date" className="input" value={validFrom} onChange={(e) => edit(setValidFrom)(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="entered-by">Your ID</label>
          <input id="entered-by" className="input" value={enteredBy} onChange={(e) => edit(setEnteredBy)(e.target.value)} autoComplete="username" />
          <span className="hint">Recorded with every change.</span>
        </div>
      </div>

      <div className="contract-grid">
        {METRICS.map((m) => {
          const s = loaded?.summary[CODE[m]]
          return (
            <div className="contract-card" key={m}>
              <h3><label htmlFor={`v-${m}`}>{METRIC_LABEL[m].name}</label></h3>
              <input id={`v-${m}`} className="input num" inputMode="numeric" value={values[m]}
                aria-invalid={invalid(values[m]) || undefined} aria-describedby={`ref-${m}`}
                onChange={(e) => edit(setValues)({ ...values, [m]: e.target.value })}
                placeholder={`Contracted ${METRIC_LABEL[m].unit}`} />
              <span id={`ref-${m}`} className="ref num">
                {invalid(values[m])
                  ? <span style={{ color: 'var(--bad-text)' }}>Enter a whole number, for example 120000.</span>
                  : !s ? (m === 'mips' ? 'No mainframe data loaded' : 'No usage loaded yet')
                  : s.status === 'no_usage' ? 'No usage recorded'
                  : `Current 4th-busiest day: ${fmt(s.fourthHighest!)}`}
              </span>
              {s?.status === 'within_contract' && <span className="status good" style={{ fontSize: 'var(--step--1)' }}><CheckIcon size={16} /> Within, {fmt(s.headroom!)} to spare</span>}
              {s?.status === 'over_contract' && <span className="status bad" style={{ fontSize: 'var(--step--1)' }}><AlertIcon size={16} /> Over by {fmt(-s.headroom!)}</span>}
            </div>
          )
        })}
      </div>

      <section className="section" aria-labelledby="lic">
        <div className="section-head">
          <h2 id="lic">Licensed add-ons</h2>
          <button className="link-btn" onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Show installed add-ons only' : `Show all ${products.length} add-ons`}
          </button>
        </div>
        <ul className="addon-list">
          {shown.map((a) => (
            <li key={a.product}>
              <label>
                <input type="checkbox" checked={licensed.includes(a.product)}
                  onChange={(e) => edit(setLicensed)(e.target.checked ? [...licensed, a.product] : licensed.filter((p) => p !== a.product))} />
                <span>{productName(a.product)} <span className="inst">{a.installedIn.length ? `installed in ${a.installedIn.join(', ')}` : 'not installed'}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div className="form-actions">
        <button className="btn" onClick={save} disabled={hasError || busy || !enteredBy.trim() || !current}>{busy ? 'Saving…' : 'Save contract'}</button>
        {!enteredBy.trim() && <span className="muted" style={{ fontSize: 'var(--step--1)' }}>Enter your ID to save.</span>}
        {result?.ok && (
          <>
            <span className="saved" role="status"><CheckIcon size={16} /> {result.message}</span>
            <button className="link-btn" onClick={onViewReport}>View the report</button>
          </>
        )}
        {result && !result.ok && <span className="file-error" role="alert" style={{ color: 'var(--bad-text)' }}>{result.message}</span>}
      </div>
      {lastSaved && (
        <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: '1rem' }}>
          Last saved by {lastSaved.enteredBy} on {fmtDate(lastSaved.enteredAt.slice(0, 10))}.
        </p>
      )}
    </article>
  )
}
