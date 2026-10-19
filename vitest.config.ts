import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
}

export default defineConfig({
  resolve: { alias },
  test: {
    // node:sqlite prints an ExperimentalWarning on Node 22 (not in Electron's newer Node).
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/**/test/**',
        'src/main/db/dev/**',
        'src/renderer/src/pages/dev/**',
        // Thin Electron wiring, exercised by the end-to-end tests instead.
        'src/main/index.ts',
        'src/main/security/hardening.ts',
        'src/main/window/mainWindow.ts',
        'src/main/lifecycle/processHandlers.ts',
        'src/preload/index.ts',
        'src/renderer/src/main.tsx'
      ],
      // Set just below the measured level: coverage may grow, never quietly shrink.
      thresholds: { statements: 92, branches: 85, functions: 91, lines: 94 },
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage'
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.perf.test.ts'],
          environment: 'node'
        }
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
