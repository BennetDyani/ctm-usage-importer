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
  if (e?.code === '28P01') { // wrong username or password for the database role
    return json({ error: 'database_login_failed', message: 'The server could not log in to the database: wrong database username or password in the server settings.' }, 503)
  }
  if (e?.code === '42501') { // the role is not allowed to run this function (e.g. loader and reader swapped)
    return json({ error: 'database_permission', message: 'The server is connected with the wrong database role for this action. Check that the loader and reader settings are not swapped.' }, 500)
  }
  if (e?.code === '23503') { // foreign key: refers to something that doesn't exist (e.g. an unknown add-on)
    return json({ error: 'invalid', message: 'The request refers to something that does not exist.' }, 422)
  }
  if (e?.code === 'CONNECT_TIMEOUT' || e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.code === 'ETIMEDOUT') {
    return json({ error: 'database_unavailable', message: 'The database could not be reached. Try again shortly.' }, 503)
  }
  return json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500)
}
