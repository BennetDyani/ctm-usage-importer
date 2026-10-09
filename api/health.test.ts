import { describe, expect, it } from 'vitest'
import { GET } from './health'

describe('GET /api/health', () => {
  it('returns status ok as JSON and is never cached', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })
})
