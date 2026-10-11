import { useState } from 'react'
import { AlertIcon, CheckIcon, DotIcon } from '../components/Icons'
import { checkFile, checkSet, sameEnv, type FileCheck, type Kind } from '../lib/fileCheck'
import type { ParsedFileSet } from '../../lib/parse'
import { fmt, fmtDate } from '../lib/format'
import { CUSTOMERS } from '../lib/types'

export default function UploadPage() {
  const [uploader, setUploader] = useState('')
  const [customer, setCustomer] = useState('')
  const [env, setEnv] = useState('')
  const [tasks, setTasks] = useState<FileCheck | null>(null)
  const [endpoints, setEndpoints] = useState<FileCheck | null>(null)
  const [result, setResult] = useState<ParsedFileSet | null>(null)

  const promptsDone = uploader.trim() && customer.trim() && env.trim()
  const envMismatch = [tasks?.env, endpoints?.env].filter(Boolean).some((e) => env.trim() && !sameEnv(e, env))
  const pairMismatch = tasks?.env && endpoints?.env && !sameEnv(tasks.env, endpoints.env)
  const fileErrors = [...(tasks?.errors ?? []), ...(endpoints?.errors ?? [])]

  const checks: { ok: boolean | null; text: string }[] = [
    { ok: promptsDone ? true : null, text: 'Uploader ID, customer and environment entered' },
    { ok: tasks && endpoints ? true : null, text: 'Both files chosen' },
    { ok: tasks || endpoints ? fileErrors.length === 0 : null, text: 'File names and contents are valid' },
    {
      ok: (tasks?.env || endpoints?.env) && env.trim() ? !envMismatch && !pairMismatch : null,
      text: env.trim() ? `Both files are for ${env.trim()}` : 'Both files match the environment',
    },
  ]
  const ready = checks.every((c) => c.ok === true)

  return (
    <article className="sheet">
      <header className="page-head">
        <h1>Upload usage files</h1>
        <p>One environment at a time. Control-M exports two files per environment, and both are loaded together so an environment is never half imported.</p>
      </header>

      <div className="steps">
        <section className="step" aria-labelledby="who">
          <div>
            <h2 id="who">Who is uploading, and for which environment?</h2>
            <div className="fields-3">
              <div className="field">
                <label htmlFor="uploader">Uploader ID</label>
                <input id="uploader" className="input" value={uploader} onChange={(e) => { setUploader(e.target.value); setResult(null) }} autoComplete="username" />
              </div>
              <div className="field">
                <label htmlFor="cust">Customer name</label>
                <input id="cust" className="input" list="customers" value={customer} onChange={(e) => { setCustomer(e.target.value); setResult(null) }} />
                <datalist id="customers">{CUSTOMERS.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="env">Environment</label>
                <input id="env" className="input" value={env} onChange={(e) => { setEnv(e.target.value); setResult(null) }} placeholder="For example PROD" aria-invalid={envMismatch || undefined} />
                <span className="hint">Must match the name inside both file names.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="step" aria-labelledby="files">
          <div>
            <h2 id="files">Choose the two files</h2>
            <div className="pair">
              <Slot kind="tasks" title="File 1: tasks" pattern={`ALL_per_task_${env.trim() || '<ENV>'}.csv`} value={tasks} onChange={(v) => { setTasks(v); setResult(null) }} expectedEnv={env} />
              <div className="pair-link" aria-live="polite">
                <span>Environment</span>
                <span className={`env-chip ${tasks?.env && endpoints?.env ? (pairMismatch ? 'bad' : 'ok') : ''}`}>
                  {tasks?.env || endpoints?.env || env.trim() || 'Not set'}
                </span>
                {pairMismatch && <span style={{ color: 'var(--bad-text)' }}>Files don't match</span>}
              </div>
              <Slot kind="endpoints" title="File 2: server endpoints" pattern={`ALL${env.trim() || '<ENV>'}.csv`} value={endpoints} onChange={(v) => { setEndpoints(v); setResult(null) }} expectedEnv={env} />
            </div>
            <p className="optional-slot">The add-ons file (addons_&lt;ENV&gt;.csv) is optional and can be added after the main pair is loaded.</p>
          </div>
        </section>

        <section className="step" aria-labelledby="checkhead">
          <div>
            <h2 id="checkhead">Check and upload</h2>
            <ul className="checklist">
              {checks.map((c) => (
                <li key={c.text}>
                  <span className={c.ok === null ? 'wait' : c.ok ? 'ok' : 'err'}>
                    {c.ok === null ? <DotIcon /> : c.ok ? <CheckIcon /> : <AlertIcon />}
                  </span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
            <div className="form-actions" style={{ marginTop: '1.25rem' }}>
              <button className="btn" disabled={!ready} onClick={() => setResult(checkSet({ uploaderId: uploader, customer, environment: env }, tasks!, endpoints!))}>Upload files</button>
              {!ready && <span className="muted" style={{ fontSize: 'var(--step--1)' }}>Finish the checks above to upload.</span>}
            </div>
            {result && <SetResult result={result} customer={customer.trim()} />}
          </div>
        </section>
      </div>
    </article>
  )
}

function Slot({ kind, title, pattern, value, onChange, expectedEnv }: {
  kind: Kind; title: string; pattern: string; value: FileCheck | null; onChange: (v: FileCheck | null) => void; expectedEnv: string
}) {
  const [drag, setDrag] = useState(false)
  const take = async (f?: File) => onChange(f ? await checkFile(f, kind) : null)
  const wrongEnv = value?.env && expectedEnv.trim() && !sameEnv(value.env, expectedEnv)
  const invalid = !!value && (value.errors.length > 0 || !!wrongEnv)
  const id = `slot-${kind}`
  return (
    <div
      className={['slot', drag && 'drag', value && 'filled', invalid && 'invalid'].filter(Boolean).join(' ')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files[0]) }}
    >
      <input id={id} type="file" accept=".csv,text/csv" aria-label={`${title}, expected ${pattern}`} onChange={(e) => take(e.target.files?.[0])} />
      <span className="slot-title">{title}</span>
      {!value ? (
        <>
          <span className="slot-pattern">{pattern}</span>
          <span className="muted" style={{ fontSize: 'var(--step--1)', marginTop: 'auto' }}>Drop the file here or click to choose it</span>
        </>
      ) : (
        <>
          <span className="file-name">{value.file.name}</span>
          {value.errors.length === 0 && value.first && (
            <span className="file-meta num">
              {fmt(value.rows)} rows, {fmt(value.days)} days<br />{fmtDate(value.first)} to {fmtDate(value.last!)}
            </span>
          )}
          {value.errors.map((e) => <span key={e} className="file-error">{e}</span>)}
          {value.errors.length === 0 && value.warnings.map((w) => <span key={w} className="file-warn">{w}</span>)}
          {wrongEnv && <span className="file-error">This file is for {value.env}, but the environment is {expectedEnv.trim()}.</span>}
        </>
      )}
    </div>
  )
}

function SetResult({ result, customer }: { result: ParsedFileSet; customer: string }) {
  const errors = result.issues.filter((i) => i.severity === 'error')
  const warnings = result.issues.filter((i) => i.severity === 'warning')
  const where = (i: ParsedFileSet['issues'][number]) =>
    [i.file === 'file1' ? 'File 1' : i.file === 'file2' ? 'File 2' : i.file === 'addons' ? 'Add-ons' : '', i.line ? `line ${i.line}` : '']
      .filter(Boolean).join(', ')
  return (
    <div className={`result ${result.ok ? 'good' : 'bad'}`} role="status">
      <h3>{result.ok ? 'Files passed every check' : 'These files can\'t be uploaded'}</h3>
      {result.ok && result.summary.firstDay && (
        <p className="num result-text">
          {customer} {result.environment}: {fmt(result.summary.taskRows)} task rows and {fmt(result.summary.endpointRows)} endpoint rows,
          {' '}{fmtDate(result.summary.firstDay)} to {fmtDate(result.summary.lastDay!)}. Saving to the database isn't switched on in this preview yet.
        </p>
      )}
      {errors.length > 0 && (
        <ul className="issue-list">
          {errors.map((i, k) => <li key={k}><strong>{where(i) || 'Upload'}</strong> {i.message}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <>
          <p className="result-text">{result.ok ? 'Stored with these notes:' : 'Also noted:'}</p>
          <ul className="issue-list muted">
            {warnings.map((i, k) => <li key={k}>{where(i) && <strong>{where(i)}</strong>} {i.message}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}
