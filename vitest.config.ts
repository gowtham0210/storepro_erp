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
