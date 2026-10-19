import { create } from 'zustand'
import { readPreference, writePreference } from '../lib/storage'

/** Text size steps (% of 16px). 100% is the default; up to 150% for low vision. */
export const UI_SCALES = [87.5, 100, 112.5, 125, 137.5, 150] as const
export type UiScale = (typeof UI_SCALES)[number]

const isScale = (value: unknown): value is UiScale => UI_SCALES.includes(value as UiScale)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

interface UiState {
  sidebarCollapsed: boolean
  uiScale: UiScale
  recoveryNoticeDismissed: boolean
  toggleSidebar(): void
  changeScale(direction: 1 | -1 | 0): void
  dismissRecoveryNotice(): void
}

/** Per-device presentation preferences (not business data). */
export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: readPreference('sidebarCollapsed', false, isBoolean),
  uiScale: readPreference('uiScale', 100, isScale),
  recoveryNoticeDismissed: false,
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed
    writePreference('sidebarCollapsed', sidebarCollapsed)
    set({ sidebarCollapsed })
  },
  changeScale: (direction) => {
    const index = UI_SCALES.indexOf(get().uiScale)
    const next =
      direction === 0
        ? 100
        : (UI_SCALES[Math.min(Math.max(index + direction, 0), UI_SCALES.length - 1)] ?? 100)
    writePreference('uiScale', next)
    set({ uiScale: next })
  },
  dismissRecoveryNotice: () => set({ recoveryNoticeDismissed: true })
}))
