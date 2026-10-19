import { create } from 'zustand'

export interface AccessState {
  /** Enabled business modules (M04). */
  modules: readonly string[]
  /** Permission codes of the signed-in user, or 'all' (M05/M06). */
  permissions: readonly string[] | 'all'
  setAccess(access: { modules: readonly string[]; permissions: readonly string[] | 'all' }): void
}

/**
 * What the current user may see. This only shapes the UI; the main process
 * enforces permissions on every request (M06). Until sign-in (M05) and
 * module activation (M04) exist, everything in the grocery edition is visible.
 */
export const useAccessStore = create<AccessState>((set) => ({
  modules: ['grocery'],
  permissions: 'all',
  setAccess: ({ modules, permissions }) => set({ modules, permissions })
}))

export function hasPermission(
  state: Pick<AccessState, 'permissions'>,
  permission: string | undefined
): boolean {
  return (
    permission === undefined ||
    state.permissions === 'all' ||
    state.permissions.includes(permission)
  )
}
