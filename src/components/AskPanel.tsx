import { useEffect, useRef, useState } from 'react'
import { askAgent } from '../lib/api'
import { CloseIcon } from './Icons'

const SUGGESTIONS = [
  'What is the 4th-busiest task day, and is it within contract?',
  'Which environment drove the busiest day?',
  'How has usage changed over the 12 months?',
  'How many files were transferred on the peak day?',
]
const MAX = 500

interface Msg { from: 'user' | 'bot'; text: string; sources?: string[]; error?: boolean }

export default function AskPanel({ customer, onClose }: { customer: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [msgs, busy])

  async function send(q: string) {
    const question = q.trim()
    if (!question || busy || question.length > MAX) return
    // Earlier answered turns go along as history, so "Are you sure?" knows what "that" was.
    const history = msgs.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.from === 'user' ? 'user' as const : 'assistant' as const, content: m.text }))
    setMsgs((m) => [...m, { from: 'user', text: question }])
    setText('')
    setBusy(true)
    const r = await askAgent({ message: question, customer: customer || undefined, history })
    setBusy(false)
    if (r.kind === 'ok') {
      const sources = [...new Set(r.data.toolsUsed.filter((t) => t.ok).map((t) => t.source))]
      setMsgs((m) => [...m, { from: 'bot', text: r.data.answer, sources }])
    } else {
      // A failed question is dropped from the history, so a retry starts clean.
      setMsgs((m) => [...m.slice(0, -1), { from: 'user', text: question, error: true }, { from: 'bot', text: r.message, error: true }])
    }
    inputRef.current?.focus()
  }

  return (
    <>
      <div className="ask-backdrop" onClick={onClose} />
      <aside className="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <header>
          <h2 id="ask-title">Ask about {customer || 'this data'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="ask-body" aria-live="polite">
          <p className="ask-intro">Answers come only from the uploaded usage data. The agent picks a fixed database query and the database does the maths; each answer shows which query it used.</p>
          {msgs.length === 0 && (
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.from}${m.error ? ' is-error' : ''}`}>
              <p>{m.text}</p>
              {m.sources && m.sources.length > 0 && (
                <p className="msg-source"><span>Based on:</span> {m.sources.join(' · ')}</p>
              )}
            </div>
          ))}
          {busy && <div className="msg bot is-pending" role="status"><p>Checking the data<span className="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p></div>}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text) }}>
          <label htmlFor="ask-input" className="visually-hidden">Your question</label>
          <input id="ask-input" ref={inputRef} className="input" value={text} maxLength={MAX}
            onChange={(e) => setText(e.target.value)} placeholder={busy ? 'Waiting for the answer…' : 'Ask a question'} disabled={busy} />
          <button className="btn" disabled={!text.trim() || busy}>Ask</button>
          {text.length > MAX - 100 && <span className="ask-count num" aria-live="polite">{MAX - text.length} left</span>}
        </form>
      </aside>
    </>
  )
}
