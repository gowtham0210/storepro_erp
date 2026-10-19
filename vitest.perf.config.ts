import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Performance tests only (`npm run test:perf`); they seed a large database and take a while.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
  },
  test: {
    include: ['src/**/*.perf.test.ts'],
    execArgv: ['--disable-warning=ExperimentalWarning'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
})
