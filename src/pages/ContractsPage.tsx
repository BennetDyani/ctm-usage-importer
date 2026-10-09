import { useState } from 'react'
import { CheckIcon } from '../components/Icons'
import { summarise, type Customer } from '../lib/compliance'
import { fmt, productName } from '../lib/format'
import { CUSTOMERS, METRIC_LABEL, type Contract, type ContractMetric } from '../lib/types'

interface Props {
  customer: Customer
  onCustomer: (name: string) => void
  contract?: Contract
  onSave: (c: Contract) => void
  onViewReport: () => void
}

const METRICS: ContractMetric[] = ['tasks', 'sep', 'mips']

export default function ContractsPage({ customer, onCustomer, contract, onSave, onViewReport }: Props) {
  // Form state starts from the saved contract; App re-mounts this page per customer (key).
  const [values, setValues] = useState<Record<ContractMetric, string>>(() => ({
    tasks: contract?.tasks?.toString() ?? '',
    sep: contract?.sep?.toString() ?? '',
    mips: contract?.mips?.toString() ?? '',
  }))
  const [validFrom, setValidFrom] = useState(contract?.validFrom ?? '')
  const [licensed, setLicensed] = useState<string[]>(contract?.licensed ?? [])
  const [showAll, setShowAll] = useState(false)
  const [saved, setSaved] = useState(false)

  // People type "12,000" or "12 000": accept thousands separators, reject anything else.
  const clean = (v: string) => v.replace(/[\s,]/g, '')
  const invalid = (v: string) => clean(v) !== '' && !/^\d+$/.test(clean(v))
  const hasError = METRICS.some((m) => invalid(values[m]))
  const products = Object.entries(customer.addons)
  const shown = showAll ? products : products.filter(([, envs]) => Object.values(envs).some(Boolean))

  const save = () => {
    const num = (v: string) => (clean(v) === '' ? undefined : Number(clean(v)))
    onSave({ tasks: num(values.tasks), sep: num(values.sep), mips: num(values.mips), validFrom: validFrom || undefined, licensed })
    setSaved(true)
  }

  return (
    <article className="sheet">
      <header className="page-head">
        <h1>Contracted values</h1>
        <p>What the customer is licensed for. The report compares the 4th-busiest day against these numbers. Leave a field empty if that measure isn't contracted.</p>
      </header>

      <div className="field" style={{ maxWidth: '20rem', marginBottom: '2rem' }}>
        <label htmlFor="c-customer">Customer</label>
        <select id="c-customer" className="select" value={customer.name} onChange={(e) => onCustomer(e.target.value)}>
          {CUSTOMERS.map((c) => <option key={c.name}>{c.name}</option>)}
        </select>
      </div>

      <div className="contract-grid">
        {METRICS.map((m) => {
          const s = m === 'mips' ? null : summarise(customer, m)
          return (
            <div className="contract-card" key={m}>
              <h3><label htmlFor={`v-${m}`}>{METRIC_LABEL[m].name}</label></h3>
              <input id={`v-${m}`} className="input num" inputMode="numeric" value={values[m]}
                aria-invalid={invalid(values[m]) || undefined} aria-describedby={`ref-${m}`}
                onChange={(e) => { setValues({ ...values, [m]: e.target.value }); setSaved(false) }}
                placeholder={`Contracted ${METRIC_LABEL[m].unit}`} />
              <span id={`ref-${m}`} className="ref num">
                {invalid(values[m])
                  ? <span style={{ color: 'var(--bad-text)' }}>Enter a whole number, for example 120000.</span>
                  : s?.fourth && !s.allZero
                    ? `Current 4th-busiest day: ${fmt(s.fourth.total)}`
                    : m === 'mips' ? 'No mainframe data loaded' : 'No usage recorded'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="field" style={{ maxWidth: '20rem', marginTop: '1.5rem' }}>
        <label htmlFor="valid-from">Contract valid from</label>
        <input id="valid-from" type="date" className="input" value={validFrom} onChange={(e) => { setValidFrom(e.target.value); setSaved(false) }} />
      </div>

      <section className="section" aria-labelledby="lic">
        <div className="section-head">
          <h2 id="lic">Licensed add-ons</h2>
          <button className="link-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show installed add-ons only' : `Show all ${products.length} add-ons`}
          </button>
        </div>
        <ul className="addon-list">
          {shown.map(([product, envs]) => {
            const where = Object.entries(envs).filter(([, v]) => v).map(([e]) => e)
            return (
              <li key={product}>
                <label>
                  <input type="checkbox" checked={licensed.includes(product)}
                    onChange={(e) => { setLicensed(e.target.checked ? [...licensed, product] : licensed.filter((p) => p !== product)); setSaved(false) }} />
                  <span>{productName(product)} <span className="inst">{where.length ? `installed in ${where.join(', ')}` : 'not installed'}</span></span>
                </label>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="form-actions">
        <button className="btn" onClick={save} disabled={hasError}>Save contract</button>
        {saved && (
          <>
            <span className="saved" role="status"><CheckIcon size={16} /> Contract saved for this session</span>
            <button className="link-btn" onClick={onViewReport}>View the report</button>
          </>
        )}
      </div>
    </article>
  )
}
