import { defineConfig } from 'vitest/config'

// Unit tests live next to the code they test: lib/**/x.test.ts, api/**/x.test.ts
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts', 'src/**/*.test.ts', 'db/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one local database, so test files run one at a time.
    fileParallelism: false,
  },
})
