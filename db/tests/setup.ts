// Shared by the integration tests: a throwaway LOCAL database, reset to the migrations.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const DOCKER_URL = 'postgres://postgres:postgres@localhost:54322/postgres'

export const TEST_URL = process.env.TEST_DATABASE_URL ?? (process.env.npm_lifecycle_event === 'db:test' ? DOCKER_URL : undefined)

if (TEST_URL) {
  const host = new URL(TEST_URL).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`integration tests drop schema ctm; refusing to run against non-local host "${host}"`)
  }
}

/** Drop and recreate schema ctm from db/migrations, in order. */
export async function resetDatabase(sql: postgres.Sql) {
  await sql.unsafe('drop schema if exists ctm cascade')
  const dir = join('db', 'migrations')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(join(dir, f), 'utf8'))
  }
}

/** Give the app roles a local-only password and return their connection strings. */
export async function roleUrls(sql: postgres.Sql) {
  await sql.unsafe(`alter role ctm_loader with login password 'local-test-only'`)
  await sql.unsafe(`alter role ctm_reader with login password 'local-test-only'`)
  const u = new URL(TEST_URL!)
  const as = (role: string) => `postgres://${role}:local-test-only@${u.host}${u.pathname}`
  return { loader: as('ctm_loader'), reader: as('ctm_reader') }
}
