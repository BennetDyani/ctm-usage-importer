// The agent loop (docs/06): ask the model, run the tools it picks, feed the results back,
// until it answers in words. Capped at 6 model steps and a time budget, so a confused model
// can't loop forever or run past Vercel's 60 s function limit.
import type postgres from 'postgres'
import type { ChatFn, ChatMessage } from './llm.js'
import { systemPrompt } from './prompt.js'
import { runTool, ToolArgError, TOOL_DEFS } from './tools.js'

export const MAX_STEPS = 6
const BUDGET_MS = 34_000 // don't start a new step after this (a step can take up to 24 s)
const MAX_TOOL_RESULT_CHARS = 12_000

export interface Turn { role: 'user' | 'assistant'; content: string }
export interface AgentInput { message: string; history?: Turn[]; customerInView?: string | null }
export interface ToolUse { tool: string; args: unknown; source: string; ok: boolean }
export interface AgentOutput { answer: string; toolsUsed: ToolUse[]; model: string | null; steps: number }

export async function runAgent(input: AgentInput, deps: { llm: ChatFn; sql: postgres.Sql; now?: () => number }): Promise<AgentOutput> {
  const now = deps.now ?? Date.now
  const started = now()
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(input.customerInView ?? null) },
    ...(input.history ?? []).slice(-12), // last 6 turns (a turn = question + answer)
    { role: 'user', content: input.message },
  ]
  const toolsUsed: ToolUse[] = []
  let model: string | null = null

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (step > 1 && now() - started > BUDGET_MS) break
    const reply = await deps.llm(messages, TOOL_DEFS)
    model = reply.model
    const calls = reply.message.tool_calls ?? []
    if (calls.length === 0) {
      const answer = (reply.message.content ?? '').trim()
      return { answer: answer || "I couldn't put an answer together. Try asking in a different way.", toolsUsed, model, steps: step }
    }
    messages.push({ ...reply.message, tool_calls: calls }) // keeps Gemini's thought signature (extra_content) for the next step
    for (const call of calls) {
      let args: unknown = {}
      let content: string
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        const result = await runTool(deps.sql, call.function.name, args)
        toolsUsed.push({ tool: call.function.name, args, source: result.source, ok: true })
        content = JSON.stringify(result.data)
      } catch (err) {
        // Bad arguments go back to the model as an error it can fix. Database failures stop the run.
        if (!(err instanceof ToolArgError) && !(err instanceof SyntaxError)) throw err
        toolsUsed.push({ tool: call.function.name, args, source: call.function.name, ok: false })
        content = JSON.stringify({ error: 'invalid_arguments', message: err.message })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, MAX_TOOL_RESULT_CHARS) })
    }
  }
  return {
    answer: "That question needed more steps than I'm allowed. Try asking about one customer and one measure at a time.",
    toolsUsed, model, steps: MAX_STEPS,
  }
}
