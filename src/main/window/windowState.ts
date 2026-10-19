import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { writeFileAtomicSync } from '../lib/atomicWrite'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  /** Absent when the window should be centred by the OS. */
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export const MIN_WINDOW_SIZE = { width: 1024, height: 700 } as const
export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800, isMaximized: true }

/** How much of the title bar must be on a display for a saved position to be reused. */
const MIN_VISIBLE_PX = 100

const storedState = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  isMaximized: z.boolean()
})

/**
 * Validate a saved window state against the current displays. Falls back to
 * defaults for corrupt data, and drops the position if the window would open
 * off-screen (e.g. a second monitor was unplugged).
 */
export function sanitizeWindowState(raw: unknown, workAreas: readonly Rect[]): WindowState {
  const parsed = storedState.safeParse(raw)
  if (!parsed.success) return { ...DEFAULT_WINDOW_STATE }

  const { x, y, isMaximized } = parsed.data
  const largest = workAreas.reduce<Rect | undefined>(
    (best, area) => (!best || area.width * area.height > best.width * best.height ? area : best),
    undefined
  )
  const maxWidth = largest ? Math.max(largest.width, MIN_WINDOW_SIZE.width) : Infinity
  const maxHeight = largest ? Math.max(largest.height, MIN_WINDOW_SIZE.height) : Infinity
  const width = clamp(parsed.data.width, MIN_WINDOW_SIZE.width, maxWidth)
  const height = clamp(parsed.data.height, MIN_WINDOW_SIZE.height, maxHeight)

  const state: WindowState = { width, height, isMaximized }
  if (x !== undefined && y !== undefined && isTitleBarVisible({ x, y, width, height }, workAreas)) {
    state.x = x
    state.y = y
  }
  return state
}

function isTitleBarVisible(bounds: Rect, workAreas: readonly Rect[]): boolean {
  const titleBar: Rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: 30 }
  return workAreas.some((area) => {
    const overlapX =
      Math.min(titleBar.x + titleBar.width, area.x + area.width) - Math.max(titleBar.x, area.x)
    const overlapY =
      Math.min(titleBar.y + titleBar.height, area.y + area.height) - Math.max(titleBar.y, area.y)
    return overlapX >= MIN_VISIBLE_PX && overlapY > 0
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export class WindowStateStore {
  constructor(private readonly filePath: string) {}

  load(workAreas: readonly Rect[]): WindowState {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch {
      raw = undefined
    }
    return sanitizeWindowState(raw, workAreas)
  }

  save(state: WindowState): void {
    writeFileAtomicSync(this.filePath, JSON.stringify(state))
  }
}
