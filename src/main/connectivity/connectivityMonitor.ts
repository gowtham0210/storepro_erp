import type { ConnectivityStatus } from '@shared/ipc/contract'
import type { Clock } from '../lib/clock'
import type { Logger } from '../logging/logger'

export interface ConnectivityMonitorOptions {
  /** Whether the computer has a network connection; Electron's `net.isOnline()` in the app. */
  isOnline(): boolean
  clock: Clock
  logger: Logger
  /** How often to look. The check is local (no network traffic), so this can be short. */
  intervalMs?: number
}

/**
 * Whether the computer is online (M08-01, FR-004), watched in the main
 * process so that every window, and main-process features such as backups
 * or updates later, see the same answer.
 *
 * The check asks the operating system whether a network connection is up;
 * it sends nothing over the network. A connected network without internet
 * access (a router whose line is down) still counts as online. Nothing in
 * StorePro depends on this status: billing, stock and reports work either way.
 */
export class ConnectivityMonitor {
  private current: ConnectivityStatus
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<(status: ConnectivityStatus) => void>()

  constructor(private readonly options: ConnectivityMonitorOptions) {
    const now = options.clock.now()
    this.current = { online: this.read(), changedAt: now, checkedAt: now }
  }

  status(): ConnectivityStatus {
    return this.current
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.check(), this.options.intervalMs ?? 3_000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Look now, e.g. after the computer wakes from sleep. Tells listeners if it changed. */
  check(): ConnectivityStatus {
    const now = this.options.clock.now()
    const online = this.read()
    if (online === this.current.online) {
      this.current = { ...this.current, checkedAt: now }
      return this.current
    }
    this.current = { online, changedAt: now, checkedAt: now }
    this.options.logger.info(online ? 'Back online' : 'Gone offline')
    for (const listener of this.listeners) listener(this.current)
    return this.current
  }

  onChange(listener: (status: ConnectivityStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private read(): boolean {
    try {
      return this.options.isOnline()
    } catch (error) {
      // Not knowing is treated as offline: the calm, safe answer.
      this.options.logger.warn('Could not read the connection state', { error })
      return false
    }
  }
}
