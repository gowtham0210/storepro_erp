import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import type { Logger } from '../logging/logger'

export function createTestLogger(): Logger & {
  [K in 'debug' | 'info' | 'warn' | 'error']: ReturnType<typeof vi.fn>
} {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger
  }
  return logger
}

/** A fresh temporary directory, removed after the current test. */
export function useTempDir(): () => string {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })
  return () => (dir ??= mkdtempSync(join(tmpdir(), 'storepro-test-')))
}
