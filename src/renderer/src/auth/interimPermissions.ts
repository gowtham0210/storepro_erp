import type { RoleCode } from '@shared/ipc/contract'
import { NAVIGATION } from '../navigation/navigation'

/**
 * Which screens a role sees, until M06 introduces real role permissions.
 * Administrators see everything; everyone else sees everything except user
 * management. This only shapes the UI: the main process enforces access.
 */
export function interimPermissionsFor(roleCode: RoleCode): readonly string[] | 'all' {
  if (roleCode === 'administrator') return 'all'
  return NAVIGATION.flatMap((group) => group.items)
    .map((item) => item.permission)
    .filter(
      (permission): permission is string => permission !== undefined && permission !== 'user.manage'
    )
}
