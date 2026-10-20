import { defineConfig } from '@playwright/test'

/**
 * Demo data for exploring the app by hand, kept out of the test suite (its files end in
 * `.seed.ts`, which the main config does not pick up). See southIndianStore.seed.ts.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.seed.ts',
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/demo'
})
