import { QueryClient } from '@tanstack/react-query'

/**
 * Data comes from the local database over IPC: no network flakiness to retry
 * around and no other writers, so results stay fresh until a mutation
 * invalidates them.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  })
}
