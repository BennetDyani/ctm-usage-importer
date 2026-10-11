import { useCallback, useEffect, useState } from 'react'
import { AlertIcon, CheckIcon, DotIcon } from '../components/Icons'
import { envFromFileName, type Issue } from '../../lib/parse'
import { listCustomers, recentBatches, uploadFileSet, type ApiResult, type Batch, type UploadOk, type UploadRejected } from '../lib/api'
import { checkFile, checkSet, sameEnv, type FileCheck, type Kind } from '../lib/fileCheck'
import { fmt, fmtDate } from '../lib/format'

type Outcome =
  | { kind: 'local'; issues: Issue[] } // refused in the browser, nothing sent
  | { kind: 'server'; result: ApiResult<UploadOk | UploadRejected>; customer: string }

export default function UploadPage() {
  const [uploader, setUploader] = useState('')
  const [customer, setCustomer] = useState('')
  const [env, setEnv] = useState('')
  const [tasks, setTasks] = useState<FileCheck | null>(null)
  const [endpoints, setEndpoints] = useState<FileCheck | null>(null)
  const [addons, setAddons] = useState<File | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<ApiResult<{ batches: Batch[] }> | null>(null)

  const loadHistory = useCallback(() => { recentBatches(10).then(setHistory) }, [])
  useEffect(loadHistory, [loadHistory])
  // Suggest the customers that already exist, so "Bank" and "BANK" never become two customers by accident.
  const [known, setKnown] = useState<string[]>([])
  useEffect(() => { listCustomers().then((r) => r.kind === 'ok' && setKnown(r.data.customers.map((c) => c.name))) }, [])

  const reset = () => setOutcome(null)
  const promptsDone = uploader.trim() && customer.trim() && env.trim()
  const envMismatch = [tasks?.env, endpoints?.env].filter(Boolean).some((e) => env.trim() && !sameEnv(e, env))
  const pairMismatch = tasks?.env && endpoints?.env && !sameEnv(tasks.env, endpoints.env)
  const fileErrors = [...(tasks?.errors ?? []), ...(endpoints?.errors ?? [])]
  const addonsEnv = addons ? envFromFileName(addons.name, 'addons') : null
  const addonsProblem = addons && (!addonsEnv ? 'Name must look like addons_<ENV>.csv' : env.trim() && !sameEnv(addonsEnv, env) ? `This file is for ${addonsEnv}, but the environment is ${env.trim()}.` : null)

  const checks: { ok: boolean | null; text: string }[] = [
    { ok: promptsDone ? true : null, text: 'Uploader ID, customer and environment entered' },
    { ok: tasks && endpoints ? true : null, text: 'Both files chosen' },
    { ok: tasks || endpoints ? fileErrors.length === 0 && !addonsProblem : null, text: 'File names and contents are valid' },
    {
      ok: (tasks?.env || endpoints?.env) && env.trim() ? !envMismatch && !pairMismatch : null,
      text: env.trim() ? `Both files are for ${env.trim()}` : 'Both files match the environment',
    },
  ]
  const ready = checks.every((c) => c.ok === true) && !busy

  async function submit() {
    if (!tasks || !endpoints) return
    const fields = { uploaderId: uploader.trim(), customer: customer.trim(), environment: env.trim() }
    const local = checkSet(fields, tasks, endpoints)
    if (!local.ok) return setOutcome({ kind: 'local', issues: local.issues })
    setBusy(true)
    const result = await uploadFileSet(fields, { file1: tasks.file, file2: endpoints.file, addons: addons ?? undefined })
    setBusy(false)
    setOutcome({ kind: 'server', result, customer: fields.customer })
    loadHistory()
  }

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
                <input id="uploader" className="input" value={uploader} onChange={(e) => { setUploader(e.target.value); reset() }} autoComplete="username" />
              </div>
              <div className="field">
                <label htmlFor="cust">Customer name</label>
                <input id="cust" className="input" list="customers" value={customer} onChange={(e) => { setCustomer(e.target.value); reset() }} />
                <datalist id="customers">{known.map((n) => <option key={n} value={n} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="env">Environment</label>
                <input id="env" className="input" value={env} onChange={(e) => { setEnv(e.target.value); reset() }} placeholder="For example PROD" aria-invalid={envMismatch || undefined} />
                <span className="hint">Must match the name inside both file names.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="step" aria-labelledby="files">
          <div>
            <h2 id="files">Choose the two files</h2>
            <div className="pair">
              <Slot kind="tasks" title="File 1: tasks" pattern={`ALL_per_task_${env.trim() || '<ENV>'}.csv`} value={tasks} onChange={(v) => { setTasks(v); reset() }} expectedEnv={env} />
              <div className="pair-link" aria-live="polite">
                <span>Environment</span>
                <span className={`env-chip ${tasks?.env && endpoints?.env ? (pairMismatch ? 'bad' : 'ok') : ''}`}>
                  {tasks?.env || endpoints?.env || env.trim() || 'Not set'}
                </span>
                {pairMismatch && <span style={{ color: 'var(--bad-text)' }}>Files don't match</span>}
              </div>
              <Slot kind="endpoints" title="File 2: server endpoints" pattern={`ALL${env.trim() || '<ENV>'}.csv`} value={endpoints} onChange={(v) => { setEndpoints(v); reset() }} expectedEnv={env} />
            </div>
            <div className="optional-slot">
              <label className="addons-pick">
                <span>Add-ons file (optional): <strong>{addons ? addons.name : `addons_${env.trim() || '<ENV>'}.csv`}</strong></span>
                <input type="file" accept=".csv,text/csv" onChange={(e) => { setAddons(e.target.files?.[0] ?? null); reset() }} />
              </label>
              {addons && <button className="link-btn" onClick={() => { setAddons(null); reset() }}>Remove</button>}
              {addonsProblem && <span className="file-error">{addonsProblem}</span>}
            </div>
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
              <button className="btn" disabled={!ready} onClick={submit}>{busy ? 'Uploading…' : 'Upload files'}</button>
              {!ready && !busy && <span className="muted" style={{ fontSize: 'var(--step--1)' }}>Finish the checks above to upload.</span>}
            </div>
            {outcome && <OutcomePanel outcome={outcome} />}
          </div>
        </section>
      </div>

      <section className="section" aria-labelledby="history">
        <div className="section-head">
          <h2 id="history">Recent uploads</h2>
          <p>Every attempt is kept, including refused ones, so you can see who uploaded what and when.</p>
        </div>
        <History history={history} />
      </section>
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

const where = (i: Issue) =>
  [i.file === 'file1' ? 'File 1' : i.file === 'file2' ? 'File 2' : i.file === 'addons' ? 'Add-ons' : '', i.line ? `line ${i.line}` : '']
    .filter(Boolean).join(', ')

function IssueList({ issues, muted }: { issues: Issue[]; muted?: boolean }) {
  return (
    <ul className={muted ? 'issue-list muted' : 'issue-list'}>
      {issues.map((i, k) => <li key={k}>{where(i) && <strong>{where(i)}</strong>} {i.message}</li>)}
    </ul>
  )
}

const ACTION: Record<string, string> = { inserted: 'saved', unchanged: 'already saved, unchanged', reactivated: 'restored from an earlier upload' }

function OutcomePanel({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'local') {
    return (
      <div className="result bad" role="status">
        <h3>These files can't be uploaded</h3>
        <IssueList issues={outcome.issues.filter((i) => i.severity === 'error')} />
      </div>
    )
  }
  const r = outcome.result
  if (r.kind !== 'ok') {
    return (
      <div className="result bad" role="status">
        <h3>{r.kind === 'offline' ? 'The upload service isn\'t available' : 'The upload didn\'t go through'}</h3>
        <p className="result-text">{r.message} Nothing was saved, so you can safely try again.</p>
      </div>
    )
  }
  const d = r.data
  if (d.status === 'rejected') {
    return (
      <div className="result bad" role="status">
        <h3>The server refused these files</h3>
        <IssueList issues={d.issues.filter((i) => i.severity === 'error')} />
        <p className="result-text">Nothing was saved. The attempt is recorded in Recent uploads.</p>
      </div>
    )
  }
  return (
    <div className="result good" role="status">
      <h3>{d.status === 'loaded' ? `Saved ${outcome.customer} ${d.environment}` : `${outcome.customer} ${d.environment} was already up to date`}</h3>
      <p className="num result-text">
        {fmt(d.summary.taskRows)} task rows and {fmt(d.summary.endpointRows)} endpoint rows
        {d.summary.firstDay && <>, {fmtDate(d.summary.firstDay)} to {fmtDate(d.summary.lastDay!)}</>}.
      </p>
      <ul className="issue-list muted">
        {d.files.map((f) => <li key={f.kind}><strong>{f.name}</strong> {ACTION[f.action] ?? f.action}</li>)}
      </ul>
      {d.warnings.length > 0 && (
        <>
          <p className="result-text">Stored with these notes:</p>
          <IssueList issues={d.warnings} muted />
        </>
      )}
    </div>
  )
}

const STATUS: Record<Batch['status'], { label: string; cls: string }> = {
  loaded: { label: 'Saved', cls: 'yes' },
  already_loaded: { label: 'Already up to date', cls: 'no' },
  rejected: { label: 'Refused', cls: 'refused' },
}
const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function History({ history }: { history: ApiResult<{ batches: Batch[] }> | null }) {
  if (!history) return <p className="muted">Loading…</p>
  if (history.kind !== 'ok') return <p className="muted">{history.message}</p>
  const list = history.data.batches
  if (list.length === 0) return <p className="muted">No uploads yet. Your first upload will appear here with who sent it and when.</p>
  return (
    <div className="table-scroll" style={{ maxHeight: 'none' }}>
      <table className="data nowrap">
        <thead><tr><th>When</th><th>Uploader</th><th>Customer</th><th>Environment</th><th>Files</th><th>Result</th></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id}>
              <td className="num">{when.format(new Date(b.createdAt))}</td>
              <td>{b.uploaderId}</td>
              <td>{b.customer}</td>
              <td>{b.environment}</td>
              <td>{b.files.length > 0 ? b.files.map((f) => f.name).join(', ') : <span className="muted">{b.status === 'already_loaded' ? 'No new files' : 'None stored'}</span>}</td>
              <td><span className={STATUS[b.status].cls}>{STATUS[b.status].label}</span>{b.errorCount > 0 && <span className="muted"> ({b.errorCount} {b.errorCount === 1 ? 'reason' : 'reasons'})</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
