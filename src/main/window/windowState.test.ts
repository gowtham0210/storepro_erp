import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { useTempDir } from '../test/helpers'
import {
  DEFAULT_WINDOW_STATE,
  MIN_WINDOW_SIZE,
  sanitizeWindowState,
  WindowStateStore
} from './windowState'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const secondary = { x: 1920, y: 0, width: 1366, height: 728 }

describe('sanitizeWindowState', () => {
  it('falls back to defaults for missing or corrupt data', () => {
    expect(sanitizeWindowState(undefined, [primary])).toEqual(DEFAULT_WINDOW_STATE)
    expect(sanitizeWindowState({ width: 'big' }, [primary])).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps a valid saved state', () => {
    const saved = { x: 100, y: 50, width: 1300, height: 800, isMaximized: false }
    expect(sanitizeWindowState(saved, [primary])).toEqual(saved)
  })

  it('drops the position when the window would be off-screen', () => {
    const saved = { x: 2200, y: 100, width: 1200, height: 700, isMaximized: false }
    expect(sanitizeWindowState(saved, [primary, secondary])).toMatchObject({ x: 2200, y: 100 })
    const result = sanitizeWindowState(saved, [primary])
    expect(result.x).toBeUndefined()
    expect(result.y).toBeUndefined()
  })

  it('clamps size to the minimum and to the largest display', () => {
    const tooSmall = sanitizeWindowState({ width: 300, height: 200, isMaximized: false }, [primary])
    expect(tooSmall).toMatchObject(MIN_WINDOW_SIZE)
    const tooBig = sanitizeWindowState({ width: 5000, height: 4000, isMaximized: false }, [primary])
    expect(tooBig).toMatchObject({ width: 1920, height: 1040 })
  })
})

describe('WindowStateStore', () => {
  const tempDir = useTempDir()

  it('round-trips state through disk', () => {
    const store = new WindowStateStore(join(tempDir(), 'window-state.json'))
    const state = { x: 10, y: 20, width: 1400, height: 900, isMaximized: false }
    store.save(state)
    expect(store.load([primary])).toEqual(state)
  })

  it('ignores an unreadable file', () => {
    const file = join(tempDir(), 'window-state.json')
    writeFileSync(file, '{not json')
    expect(new WindowStateStore(file).load([primary])).toEqual(DEFAULT_WINDOW_STATE)
  })
})
