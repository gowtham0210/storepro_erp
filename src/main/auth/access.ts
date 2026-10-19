import type { RoleCode } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import {
  permissionDescription,
  type PermissionCode,
  type PermissionDenial
} from '@shared/permissions'

/**
 * Who may call an IPC channel. Every handler declares one (M06-03):
 *
 *  - `public`: no session needed (start-up, sign-in, logging).
 *  - `password-change`: signed in and unlocked, even if a new password is
 *    still required. Only for choosing that password.
 *  - `signed-in`: any signed-in, unlocked user.
 *  - a permission code: a signed-in user whose role grants it.
 */
export type HandlerAccess = 'public' | 'password-change' | 'signed-in' | PermissionCode

/**
 * The user a request runs as, resolved by the service host before the handler
 * runs and passed down to services, which check permissions against it.
 * Re-read from the database for every request, so role changes and
 * deactivation take effect at once.
 */
export interface Actor {
  userId: number
  username: string
  displayName: string
  roleCode: RoleCode
  /** The role's permissions, plus an approved override for this one request. */
  permissions: ReadonlySet<PermissionCode>
  /** Set when another user approved this request (M06-05). */
  override: {
    permission: PermissionCode
    approvedBy: { userId: number; displayName: string }
  } | null
}

export function can(actor: Actor, permission: PermissionCode): boolean {
  return actor.permissions.has(permission)
}

export function forbidden(permission: PermissionCode, overridable = false): AppError {
  const details: PermissionDenial = { permission, overridable }
  return new AppError(
    'FORBIDDEN',
    `Your role doesn't allow this: ${permissionDescription(permission).toLowerCase()}.`,
    details
  )
}

/** Services call this even when the service host already checked: it is their own guarantee. */
export function assertCan(actor: Actor, permission: PermissionCode): void {
  if (!can(actor, permission)) throw forbidden(permission)
}
