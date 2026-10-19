import { randomUUID } from 'node:crypto'
import type { PermissionCode } from '@shared/permissions'
import type { Clock } from '../lib/clock'

export interface OverrideGrant {
  permission: PermissionCode
  /** The signed-in user the approval was given to. */
  requestedBy: number
  approvedBy: number
  expiresAt: number
}

/** How long an approval can wait before it is used. */
export const OVERRIDE_TTL_MS = 2 * 60_000

/**
 * Manager approvals waiting to be used (M06-05). An approval is a random id,
 * held only in memory, that covers one request: one permission, for the user
 * who asked, used once, within OVERRIDE_TTL_MS. The request that uses it names
 * it explicitly, so an approval can't leak into some other action.
 */
export class OverrideGrants {
  private readonly grants = new Map<string, OverrideGrant>()

  constructor(private readonly clock: Clock) {}

  issue(grant: Omit<OverrideGrant, 'expiresAt'>): { overrideId: string; expiresAt: number } {
    this.dropExpired()
    const overrideId = randomUUID()
    const expiresAt = this.clock.now() + OVERRIDE_TTL_MS
    this.grants.set(overrideId, { ...grant, expiresAt })
    return { overrideId, expiresAt }
  }

  /** Removes and returns the grant if it is valid for this user and permission. */
  take(overrideId: string, requestedBy: number, permission: PermissionCode): OverrideGrant | null {
    const grant = this.grants.get(overrideId)
    if (!grant || grant.requestedBy !== requestedBy || grant.permission !== permission) return null
    this.grants.delete(overrideId)
    return grant.expiresAt > this.clock.now() ? grant : null
  }

  /** On sign-out, lock or a new sign-in: approvals never outlive the session they were given in. */
  clear(): void {
    this.grants.clear()
  }

  private dropExpired(): void {
    const now = this.clock.now()
    for (const [id, grant] of this.grants) if (grant.expiresAt <= now) this.grants.delete(id)
  }
}
