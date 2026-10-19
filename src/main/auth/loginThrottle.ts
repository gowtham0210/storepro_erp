import type { Clock } from '../lib/clock'
import type { Database } from '../db/database'

export interface ThrottlePolicy {
  /** Failures allowed before sign-in is blocked. */
  freeAttempts: number
  /** First block length; doubles with each further failure. */
  baseLockMs: number
  maxLockMs: number
  /** A failure older than this no longer counts. */
  resetAfterMs: number
}

export const DEFAULT_THROTTLE: ThrottlePolicy = {
  freeAttempts: 5,
  baseLockMs: 30_000,
  maxLockMs: 15 * 60_000,
  resetAfterMs: 60 * 60_000
}

/**
 * Slows down password guessing (M05-06). Counters are stored, so restarting
 * the app does not reset them, and keyed by the typed username, so unknown
 * usernames are throttled exactly like real ones.
 */
export class LoginThrottle {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly policy: ThrottlePolicy = DEFAULT_THROTTLE
  ) {}

  /** Milliseconds until another attempt is allowed, or 0. */
  retryAfterMs(username: string): number {
    const row = this.row(username)
    if (!row?.locked_until) return 0
    return Math.max(0, row.locked_until - this.clock.now())
  }

  recordFailure(username: string): void {
    const key = normalise(username)
    const now = this.clock.now()
    const row = this.row(username)
    const count =
      row && now - row.last_failed_at < this.policy.resetAfterMs ? row.failed_count + 1 : 1
    const excess = count - this.policy.freeAttempts
    const lockedUntil =
      excess >= 0
        ? now + Math.min(this.policy.baseLockMs * 2 ** excess, this.policy.maxLockMs)
        : null
    this.db.run(
      `INSERT INTO login_throttles (username_key, failed_count, last_failed_at, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (username_key) DO UPDATE SET
         failed_count = excluded.failed_count,
         last_failed_at = excluded.last_failed_at,
         locked_until = excluded.locked_until`,
      [key, count, now, lockedUntil]
    )
  }

  clear(username: string): void {
    this.db.run('DELETE FROM login_throttles WHERE username_key = ?', [normalise(username)])
  }

  private row(username: string) {
    return this.db.get<{
      failed_count: number
      last_failed_at: number
      locked_until: number | null
    }>(
      'SELECT failed_count, last_failed_at, locked_until FROM login_throttles WHERE username_key = ?',
      [normalise(username)]
    )
  }
}

function normalise(username: string): string {
  return username.trim().toLowerCase().slice(0, 64)
}
