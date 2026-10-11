// Small helpers so every API route answers the same way.
import { ConfigError } from './db.js'

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

export const methodNotAllowed = (allow: string) =>
  json({ error: 'method_not_allowed', message: `Use ${allow}.` }, 405, { Allow: allow })

/** Map an unexpected error to a status the browser can act on, without leaking internals. */
export function failure(err: unknown, where: string): Response {
  const e = err as { code?: string; message?: string }
  console.error(`[${where}]`, e?.code ?? '', e?.message ?? err)
  if (err instanceof ConfigError) {
    return json({ error: 'misconfigured', message: 'The server is missing its database settings.' }, 500)
  }
  if (e?.code === '57014') { // statement_timeout
    return json({ error: 'timeout', message: 'The database took too long. Try again.' }, 504)
  }
  if (e?.code === '22023') { // our own validation inside the database functions
    return json({ error: 'invalid', message: e.message }, 422)
  }
  if (e?.code === 'CONNECT_TIMEOUT' || e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.code === '28P01') {
    return json({ error: 'database_unavailable', message: 'The database could not be reached. Try again shortly.' }, 503)
  }
  return json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500)
}
