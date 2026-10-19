import { QueryClient } from '@tanstack/react-query'

/**
 * Data comes from the local database over IPC: no network flakiness to retry
 * around and no other writers, so results stay fresh until a mutation
 * invalidates them.
 *
 * networkMode 'always' is essential: TanStack Query otherwise pauses every
 * query while the browser reports being offline, and StorePro must keep
 * working with no internet connection.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        networkMode: 'always'
      },
      mutations: { retry: false, networkMode: 'always' }
    }
  })
}
