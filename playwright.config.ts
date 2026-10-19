import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the built app (`out/`) in real Electron.
 * Run with `npm run test:e2e` (builds first) or `npm run test:e2e:only`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every test launches its own app with its own data folder, so files can run in parallel.
  fullyParallel: false,
  workers: process.env['CI'] ? 2 : 1,
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results'
})
