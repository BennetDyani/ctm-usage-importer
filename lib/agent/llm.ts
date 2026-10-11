// Model client. Every provider here speaks the OpenAI-style "chat completions" format, so switching
// is configuration, not code. AGENT_PROVIDERS sets the order, e.g.
//   AGENT_PROVIDERS=groq:openai/gpt-oss-120b,gemini:gemini-3.8-flash
// Providers without a key are skipped. Each step tries them in order: if one fails (down, slow,
// refused), the next one answers that step. Server-only: keys never reach the browser.

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; [extra: string]: unknown }
export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; extra_content?: unknown }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatReply { message: AssistantMessage; model: string } // model = "provider:model" that answered
/** Anything that can answer one step. Tests pass a scripted fake; production uses chatClient(). */
export type ChatFn = (messages: ChatMessage[], tools: unknown[]) => Promise<ChatReply>

export class LlmConfigError extends Error {} // no usable key at all: retrying won't help
export class LlmUnavailableError extends Error {} // every provider failed this step

export type ProviderName = 'groq' | 'gemini' | 'openrouter'
interface Provider {
  url: string
  keyVar: string
  /** Provider-specific request settings. Both Groq's gpt-oss and Gemini 3 "think" before answering. */
  settings: (effort: string) => Record<string, unknown>
}

export const PROVIDERS: Record<ProviderName, Provider> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyVar: 'GROQ_API_KEY',
    // include_reasoning: false -> don't send the model's thinking text back to us (we never show it).
    settings: (effort) => ({ temperature: 0, max_completion_tokens: 2000, reasoning_effort: effort, include_reasoning: false }),
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyVar: 'GEMINI_API_KEY',
    // No temperature: Google strongly recommends Gemini 3's default of 1.0 (lower "may lead to ... looping").
    // Thinking tokens count toward max_tokens, so the cap is generous and thinking is kept low.
    settings: (effort) => ({ max_tokens: 4000, reasoning_effort: effort }),
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyVar: 'OPENROUTER_API_KEY',
    settings: () => ({ temperature: 0, max_tokens: 1000 }),
  },
}

// Gemini last: its free tier allows only ~20 requests a day for gemini-3.8-flash.
export const DEFAULT_PROVIDERS = 'groq:openai/gpt-oss-120b,openrouter:openai/gpt-4.1-mini,gemini:gemini-3.8-flash'

// 12 s per provider try: a step that falls back can take 24 s, which still fits Vercel's 60 s limit (see run.ts).
const STEP_TIMEOUT_MS = 12_000

interface Route { provider: ProviderName; model: string; key: string }

/** Parse AGENT_PROVIDERS ("name:model,name:model") and keep the ones that have a key. */
export function routes(env: NodeJS.ProcessEnv): Route[] {
  const list = (env.AGENT_PROVIDERS || DEFAULT_PROVIDERS).split(',').map((s) => s.trim()).filter(Boolean)
  return list.flatMap((entry) => {
    const i = entry.indexOf(':') // model names can contain ':' too, so split on the first one only
    const name = entry.slice(0, i).trim().toLowerCase() as ProviderName
    const model = entry.slice(i + 1).trim()
    if (i < 1 || !model || !(name in PROVIDERS)) throw new LlmConfigError(`AGENT_PROVIDERS entry "${entry}" should look like groq:model-name (groq, gemini or openrouter)`)
    const key = env[PROVIDERS[name].keyVar]
    return key ? [{ provider: name, model, key }] : []
  })
}

/** Gemini's hidden "thought signatures" must go back to Gemini unchanged, and to nobody else. */
function forProvider(provider: ProviderName, messages: ChatMessage[]): ChatMessage[] {
  if (provider === 'gemini') return messages
  return messages.map((m) => {
    if (m.role !== 'assistant') return m
    const { extra_content: _drop, ...rest } = m
    return { ...rest, tool_calls: rest.tool_calls?.map(({ extra_content: _x, ...call }) => call as ToolCall) }
  })
}

interface ApiBody {
  model?: string
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[]; extra_content?: unknown } }[]
  error?: { message?: string } | string
}

/** Error text from any provider. Gemini's compatibility layer wraps errors in a list: [{ error: { message } }]. */
function errorText(body: unknown): string {
  const b = (Array.isArray(body) ? body[0] : body) as ApiBody | null
  const e = b?.error
  return (typeof e === 'string' ? e : e?.message ?? '').replace(/\s+/g, ' ').trim()
}

// A rate limit that clears within this long is worth one wait-and-retry on the same provider
// (Groq's free tier often says "try again in 360ms"). Longer waits go straight to the next provider.
const MAX_RETRY_WAIT_MS = 3000

/** How long the provider asks us to wait: Retry-After header, or "try again in 1.5s / 360ms" in the message. */
export function retryWaitMs(res: Response, text: string): number | null {
  const header = res.headers.get('retry-after')
  if (header && /^\d+(\.\d+)?$/.test(header)) return Math.ceil(Number(header) * 1000)
  const m = /try again in\s+([\d.]+)\s*(ms|s)\b/i.exec(text)
  if (!m) return null
  return Math.ceil(Number(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function chatClient(env: NodeJS.ProcessEnv = process.env, only?: ProviderName | null): ChatFn {
  const order = routes(env).filter((r) => !only || r.provider === only)
  if (order.length === 0 && only) throw new LlmConfigError(`${only} is not configured on the server (no ${PROVIDERS[only].keyVar}, or not in AGENT_PROVIDERS).`)
  if (order.length === 0) {
    throw new LlmConfigError(`No model key is set. Add one of ${Object.values(PROVIDERS).map((p) => p.keyVar).join(', ')}.`)
  }
  const effort = env.AGENT_REASONING_EFFORT || 'low'

  return async (messages, tools) => {
    const errors: string[] = []
    let authFailures = 0
    for (const { provider, model, key } of order) {
      const p = PROVIDERS[provider]
      const send = () => fetch(p.url, {
        method: 'POST',
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: forProvider(provider, messages), tools, tool_choice: 'auto', ...p.settings(effort) }),
      })
      try {
        let res = await send()
        let raw: unknown = await res.json().catch(() => null)
        if (res.status === 429) {
          const wait = retryWaitMs(res, errorText(raw))
          if (wait !== null && wait <= MAX_RETRY_WAIT_MS) {
            await sleep(wait + 250)
            res = await send()
            raw = await res.json().catch(() => null)
          }
        }
        const body = (Array.isArray(raw) ? null : raw) as ApiBody | null
        const message = body?.choices?.[0]?.message
        if (!res.ok || !message) {
          if (res.status === 401 || res.status === 403) authFailures++
          errors.push(`${provider}:${model} HTTP ${res.status} ${errorText(raw)}`.trim())
          continue
        }
        // Keep only what the next step needs: never the model's private reasoning text.
        const reply: AssistantMessage = { role: 'assistant', content: message.content ?? null }
        if (message.tool_calls?.length) reply.tool_calls = message.tool_calls
        if (message.extra_content !== undefined) reply.extra_content = message.extra_content
        return { model: `${provider}:${body?.model ?? model}`, message: reply }
      } catch (err) {
        const e = err as Error
        errors.push(`${provider}:${model} ${e.name === 'TimeoutError' ? 'timed out' : e.message}`)
      }
    }
    const summary = errors.join(' | ')
    if (authFailures === order.length) throw new LlmConfigError(`Every model key was refused: ${summary}`)
    throw new LlmUnavailableError(summary)
  }
}
