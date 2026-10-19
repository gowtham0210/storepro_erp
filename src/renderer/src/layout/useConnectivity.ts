import { useEffect, useSyncExternalStore } from 'react'
import type { ConnectivityStatus } from '@shared/ipc/contract'
import { invoke } from '../ipc/client'

/**
 * The main process's connectivity monitor (M08-01), as the screens see it:
 * read once, then kept current by 'connectivity:changed' events. The newest
 * check wins, so a slow first answer can't overwrite a newer event.
 */
let latest: ConnectivityStatus | undefined
const subscribers = new Set<() => void>()

function update(status: ConnectivityStatus): void {
  if (latest && latest.checkedAt > status.checkedAt) return
  latest = status
  for (const notify of subscribers) notify()
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange)
  return () => subscribers.delete(onChange)
}

/** Whether the computer is online; undefined until the first answer arrives. */
export function useConnectivity(): ConnectivityStatus | undefined {
  useEffect(() => {
    const stop = window.storepro.on('connectivity:changed', update)
    invoke('connectivity:get-status').then(update, () => {
      // Not knowing isn't worth an error: the indicator just waits for the next event.
    })
    return stop
  }, [])
  return useSyncExternalStore(subscribe, () => latest)
}

/** For tests: forget what is known, as on a fresh start. */
export function resetConnectivity(): void {
  latest = undefined
}
