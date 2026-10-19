import { useCallback } from 'react'
import type { PermissionCode } from '@shared/permissions'
import { useCurrentUser } from './useAuth'

/**
 * What the signed-in user may do (M06-04). This only shapes the UI, hiding
 * screens and actions the user can't use: the main process checks every
 * request itself.
 */
export function usePermissions(): readonly PermissionCode[] {
  return useCurrentUser().permissions
}

export function hasPermission(
  permissions: readonly PermissionCode[],
  permission: PermissionCode | undefined
): boolean {
  return permission === undefined || permissions.includes(permission)
}

/** `const can = useCan(); {can('sale.void') && <Button>Void</Button>}` */
export function useCan(): (permission: PermissionCode) => boolean {
  const permissions = usePermissions()
  return useCallback((permission) => permissions.includes(permission), [permissions])
}
