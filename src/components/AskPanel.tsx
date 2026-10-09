import { useEffect, useRef, useState } from 'react'
import { CloseIcon } from './Icons'

const SUGGESTIONS = [
  'What is the 4th-busiest task day, and is it within contract?',
  'Which environment drove the busiest day?',
  'How has usage changed over the 12 months?',
  'How many files were transferred on the peak day?',
]

interface Msg { from: 'user' | 'bot'; text: string }

export default function AskPanel({ customer, onClose }: { customer: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = (q: string) => {
    const question = q.trim().slice(0, 500)
    if (!question) return
    setMsgs((m) => [
      ...m,
      { from: 'user', text: question },
      { from: 'bot', text: "The analysis agent isn't connected in this preview. When it is, it will answer from the stored usage data and show which query each number came from." },
    ])
    setText('')
  }

  return (
    <>
      <div className="ask-backdrop" onClick={onClose} />
      <aside className="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <header>
          <h2 id="ask-title">Ask about {customer}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="ask-body" aria-live="polite">
          <p className="ask-intro">Answers come only from the uploaded usage data. Every number is calculated by the database, not guessed.</p>
          {msgs.length === 0 && (
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
          {msgs.map((m, i) => <p key={i} className={`msg ${m.from}`}>{m.text}</p>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text) }}>
          <label htmlFor="ask-input" className="visually-hidden">Your question</label>
          <input id="ask-input" ref={inputRef} className="input" value={text} maxLength={500}
            onChange={(e) => setText(e.target.value)} placeholder="Ask a question" />
          <button className="btn" disabled={!text.trim()}>Ask</button>
        </form>
      </aside>
    </>
  )
}
