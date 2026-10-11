// Database connections for the Vercel functions. Server-only: never import this from src/.
//
// Two roles, two connection strings (docs/05 Security):
//   DATABASE_URL_LOADER  -> ctm_loader: can only call the write functions
//   DATABASE_URL_READER  -> ctm_reader: can only call the read functions, read-only
// Use Supabase's TRANSACTION pooler (port 6543). It doesn't support prepared statements,
// so prepare: false. One small pool per warm function instance, reused between requests.
import postgres from 'postgres'

export type Role = 'loader' | 'reader'

const ENV: Record<Role, string> = { loader: 'DATABASE_URL_LOADER', reader: 'DATABASE_URL_READER' }
const pools = new Map<Role, postgres.Sql>()

export class ConfigError extends Error {}

export function db(role: Role): postgres.Sql {
  const existing = pools.get(role)
  if (existing) return existing
  const url = process.env[ENV[role]]
  if (!url) throw new ConfigError(`${ENV[role]} is not set`)
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)
  const sql = postgres(url, {
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    onnotice: () => {},
  })
  pools.set(role, sql)
  return sql
}

/** For tests: close and forget all pools. */
export async function closeAll() {
  await Promise.all([...pools.values()].map((p) => p.end({ timeout: 2 })))
  pools.clear()
}
