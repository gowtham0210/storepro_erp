import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDir } from '../test/helpers'
import { createFileLogger } from './logger'
import { REDACTED, redact } from './redact'

describe('createFileLogger', () => {
  const tempDir = useTempDir()

  it('writes scoped, levelled lines with context', () => {
    const dir = tempDir()
    const logger = createFileLogger({ dir, minLevel: 'debug' })
    logger.child('ipc').info('Handled call', { channel: 'app:get-info' })
    const content = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(content).toMatch(
      /^\d{4}-\d\d-\d\dT[\d:.]+Z \[INFO\] \[main:ipc\] Handled call \{"channel":"app:get-info"\}\n$/
    )
  })

  it('drops entries below the minimum level', () => {
    const dir = tempDir()
    const logger = createFileLogger({ dir, minLevel: 'warn' })
    logger.info('hidden')
    logger.warn('shown')
    const content = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(content).not.toContain('hidden')
    expect(content).toContain('shown')
  })

  it('rotates by size and keeps at most maxFiles files', () => {
    const dir = tempDir()
    const logger = createFileLogger({ dir, maxBytes: 200, maxFiles: 3 })
    for (let i = 0; i < 40; i++) logger.info(`entry ${i} ${'x'.repeat(40)}`)

    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log'])
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file)).length).toBeLessThanOrEqual(200)
    }
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('entry 39')
    expect(existsSync(join(dir, 'main.3.log'))).toBe(false)
  })

  it('never writes sensitive values', () => {
    const dir = tempDir()
    createFileLogger({ dir }).info('Login attempt', { username: 'cashier1', password: 'hunter2' })
    const content = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(content).toContain('cashier1')
    expect(content).not.toContain('hunter2')
  })
})

describe('redact', () => {
  it('masks sensitive keys at any depth', () => {
    expect(
      redact({ user: { pin: '1234', passwordHash: 'abc', name: 'A' }, apiKey: 'k', authToken: 't' })
    ).toEqual({
      user: { pin: REDACTED, passwordHash: REDACTED, name: 'A' },
      apiKey: REDACTED,
      authToken: REDACTED
    })
  })

  it('serialises errors and breaks cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic['self'] = cyclic
    const result = redact({ error: new Error('boom'), cyclic }) as Record<
      string,
      Record<string, unknown>
    >
    expect(result['error']).toMatchObject({ name: 'Error', message: 'boom' })
    expect(result['cyclic']?.['self']).toBe('[Circular]')
  })

  it('truncates very long strings and stringifies bigints', () => {
    const result = redact({ text: 'a'.repeat(5000), big: 10n }) as Record<string, string>
    expect(result['text']?.length).toBeLessThan(2100)
    expect(result['big']).toBe('10')
  })
})

describe('console mirroring', () => {
  const tempDir = useTempDir()

  it('swallows console stream errors such as EPIPE', () => {
    createFileLogger({ dir: tempDir(), mirrorToConsole: true })
    expect(process.stdout.listenerCount('error')).toBeGreaterThan(0)
    expect(() => process.stdout.emit('error', new Error('write EPIPE'))).not.toThrow()
  })
})
