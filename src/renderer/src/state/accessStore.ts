import { create } from 'zustand'

export interface AccessState {
  /** Enabled business modules (M04). */
  modules: readonly string[]
  setModules(modules: readonly string[]): void
}

/**
 * Which business modules are switched on. Until module activation (M04)
 * exists, that is the grocery edition. The user's permissions come with the
 * session instead (see auth/permissions.ts).
 */
export const useAccessStore = create<AccessState>((set) => ({
  modules: ['grocery'],
  setModules: (modules) => set({ modules })
}))
