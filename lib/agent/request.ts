// Checks the browser's request before anything reaches the model or the database.
import type { Turn } from './run.js'

export const MAX_MESSAGE = 500
const MAX_TURN = 2000

export const PROVIDER_NAMES = ['groq', 'gemini', 'openrouter'] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

type Checked = { ok: true; message: string; customer: string | null; history: Turn[]; only: ProviderName | null } | { ok: false; reason: string }

export function checkBody(body: unknown): Checked {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message) return { ok: false, reason: 'Type a question first.' }
  if (message.length > MAX_MESSAGE) return { ok: false, reason: `Keep questions under ${MAX_MESSAGE} characters.` }
  const customer = typeof b.customer === 'string' && b.customer.trim() ? b.customer.trim().slice(0, 100) : null
  const raw = b.history === undefined ? [] : b.history
  if (!Array.isArray(raw) || raw.length > 12) return { ok: false, reason: 'history must be a list of at most 12 messages.' }
  const history: Turn[] = []
  for (const t of raw) {
    const r = t as Record<string, unknown>
    if (!r || (r.role !== 'user' && r.role !== 'assistant') || typeof r.content !== 'string' || r.content.length > MAX_TURN) {
      return { ok: false, reason: 'Each history item needs role "user" or "assistant" and text content.' }
    }
    history.push({ role: r.role, content: r.content })
  }
  // "only" lets the eval script test one provider at a time without changing Vercel settings.
  // It can only narrow the providers already configured on the server; it can't add a provider or a key.
  let only: ProviderName | null = null
  if (b.only !== undefined && b.only !== null) {
    if (typeof b.only !== 'string' || !(PROVIDER_NAMES as readonly string[]).includes(b.only)) {
      return { ok: false, reason: `only must be one of ${PROVIDER_NAMES.join(', ')}.` }
    }
    only = b.only as ProviderName
  }
  return { ok: true, message, customer, history, only }
}
