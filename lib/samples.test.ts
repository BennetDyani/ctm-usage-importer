import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Phase 0 guard: the sample data the whole test plan depends on is present and paired.
const SAMPLES = join(process.cwd(), 'data', 'samples')

const expected: Record<string, string[]> = {
  BANK: ['Dev', 'Prod', 'UAT'],
  DCS: ['PROD', 'QA'],
}

describe('sample data', () => {
  for (const [customer, envs] of Object.entries(expected)) {
    it(`${customer} has File 1 and File 2 for every environment`, () => {
      const files = readdirSync(join(SAMPLES, customer))
      for (const env of envs) {
        expect(files).toContain(`ALL_per_task_${env}.csv`) // File 1: tasks
        expect(files).toContain(`ALL${env}.csv`) // File 2: endpoints
      }
    })
  }
})
