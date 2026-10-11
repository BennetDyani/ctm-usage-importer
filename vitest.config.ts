import { defineConfig } from 'vitest/config'

// Unit tests live next to the code they test: lib/**/x.test.ts, api/**/x.test.ts
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'api/**/*.test.ts', 'src/**/*.test.ts', 'db/**/*.test.ts'],
    environment: 'node',
  },
})
