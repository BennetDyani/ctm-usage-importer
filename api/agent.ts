// /api/agent  POST { message, customer?, history? }  ->  { answer, toolsUsed, model }
// The analysis agent. The model picks fixed read-only tools (lib/agent/tools.ts); the database
// (as ctm_reader) does every calculation. Model keys (Groq / Gemini / OpenRouter) stay on the server.
import { chatClient, LlmConfigError, LlmUnavailableError } from '../lib/agent/llm.js'
import { checkBody } from '../lib/agent/request.js'
import { runAgent } from '../lib/agent/run.js'
import { db } from '../lib/server/db.js'
import { failure, json, methodNotAllowed } from '../lib/server/http.js'

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request', message: 'Send the question as JSON: { "message": "..." }.' }, 400)
  }
  const v = checkBody(body)
  if (!v.ok) return json({ error: 'bad_request', message: v.reason }, 400)

  try {
    const llm = chatClient(process.env, v.only)
    const sql = db('reader')
    // Only pass the page's customer to the model if it really exists (it ends up in the system prompt).
    let inView: string | null = null
    if (v.customer) {
      const key = v.customer.toLowerCase().replace(/\s+/g, '')
      const [hit] = await sql`select name from ctm.list_customers() where lower(regexp_replace(name, '\\s+', '', 'g')) = ${key}`
      inView = hit?.name ?? null
    }
    const out = await runAgent({ message: v.message, history: v.history, customerInView: inView }, { llm, sql })
    console.log('[agent]', JSON.stringify({ steps: out.steps, model: out.model, tools: out.toolsUsed.map((t) => t.tool) }))
    return json(out)
  } catch (err) {
    if (err instanceof LlmConfigError) {
      console.error('[agent]', err.message)
      if (v.only) return json({ error: 'agent_not_configured', message: err.message }, 503)
      return json({ error: 'agent_not_configured', message: "The agent isn't set up on the server yet: no working model key (GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY)." }, 503)
    }
    if (err instanceof LlmUnavailableError) {
      console.error('[agent]', err.message)
      return json({ error: 'agent_unavailable', message: "The language model didn't answer in time. Try again in a moment." }, 502)
    }
    return failure(err, 'agent')
  }
}

export const GET = () => methodNotAllowed('POST')
