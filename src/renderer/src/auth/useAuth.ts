import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { AuthState, SessionUser } from '@shared/ipc/contract'
import { useIpcQuery } from '../ipc/hooks'

export const AUTH_STATE_KEY = ['auth:get-state'] as const

/** The current authentication state from the main process. */
export function useAuthState(): { state: AuthState | undefined; isLoading: boolean } {
  const { data, isLoading } = useIpcQuery('auth:get-state')
  return { state: data, isLoading }
}

/** The signed-in user. Only use below <AuthGate>, where someone is always signed in. */
export function useCurrentUser(): SessionUser {
  const { state } = useAuthState()
  if (state?.status !== 'signed-in' && state?.status !== 'locked') {
    throw new Error('useCurrentUser used outside a signed-in session')
  }
  return state.user
}

/**
 * Re-read the auth state after a sign-in, sign-out, lock or unlock. Signing
 * out also forgets every cached query, so nothing one user saw is shown to the next.
 */
export function useRefreshAuth(): (options?: { forgetData?: boolean }) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async ({ forgetData = false } = {}) => {
      if (forgetData)
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== AUTH_STATE_KEY[0] })
      await queryClient.invalidateQueries({ queryKey: AUTH_STATE_KEY })
    },
    [queryClient]
  )
}
