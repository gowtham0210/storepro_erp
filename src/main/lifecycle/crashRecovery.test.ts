import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDir } from '../test/helpers'
import { CrashHistory, RendererCrashGuard, SessionMarker } from './crashRecovery'

describe('SessionMarker', () => {
  const tempDir = useTempDir()

  it('reports a clean start when the previous session ended properly', () => {
    const file = join(tempDir(), 'session.lock')
    const first = new SessionMarker(file)
    expect(first.begin('0.1.0').recoveredFromUncleanShutdown).toBe(false)
    first.end()
    expect(existsSync(file)).toBe(false)
    expect(new SessionMarker(file).begin('0.1.0').recoveredFromUncleanShutdown).toBe(false)
  })

  it('detects an unclean shutdown from a leftover marker', () => {
    const file = join(tempDir(), 'session.lock')
    new SessionMarker(file).begin('0.1.0', new Date('2026-10-19T08:00:00.000Z'))
    // No end(): simulates a crash or power loss.
    expect(new SessionMarker(file).begin('0.1.0')).toEqual({
      recoveredFromUncleanShutdown: true,
      previousSessionStartedAt: '2026-10-19T08:00:00.000Z'
    })
  })

  it('treats a corrupt marker as an unclean shutdown', () => {
    const file = join(tempDir(), 'session.lock')
    writeFileSync(file, '\0\0\0')
    expect(new SessionMarker(file).begin('0.1.0')).toEqual({
      recoveredFromUncleanShutdown: true,
      previousSessionStartedAt: null
    })
  })
})

describe('CrashHistory', () => {
  const tempDir = useTempDir()

  it('stops relaunching after too many crashes in the window', () => {
    const history = new CrashHistory(join(tempDir(), 'crashes.json'), 60_000, 3)
    expect(history.recordCrash(1_000).shouldRelaunch).toBe(true)
    expect(history.recordCrash(2_000).shouldRelaunch).toBe(true)
    expect(history.recordCrash(3_000).shouldRelaunch).toBe(true)
    expect(history.recordCrash(4_000)).toEqual({ shouldRelaunch: false, recentCrashes: 4 })
  })

  it('forgets crashes outside the window, across instances', () => {
    const file = join(tempDir(), 'crashes.json')
    for (const time of [1_000, 2_000, 3_000]) new CrashHistory(file, 60_000, 3).recordCrash(time)
    expect(new CrashHistory(file, 60_000, 3).recordCrash(100_000)).toEqual({
      shouldRelaunch: true,
      recentCrashes: 1
    })
  })
})

describe('RendererCrashGuard', () => {
  it('reloads a few times, then gives up', () => {
    const guard = new RendererCrashGuard(60_000, 2)
    expect(guard.onCrash(0)).toBe('reload')
    expect(guard.onCrash(1_000)).toBe('reload')
    expect(guard.onCrash(2_000)).toBe('give-up')
    expect(guard.onCrash(120_000)).toBe('reload')
  })
})
