import type { RoleCode, RoleSummary } from '@shared/ipc/contract'
import { inCatalogueOrder, type PermissionCode } from '@shared/permissions'
import { Repository } from '../db/repository'

/** Roles and what they may do. Read-only: the mapping is set by migrations (M06-02). */
export class RoleRepository extends Repository {
  permissionsOf(roleCode: RoleCode): PermissionCode[] {
    return inCatalogueOrder(
      this.db
        .all<{ permission_code: PermissionCode }>(
          `SELECT rp.permission_code FROM role_permissions rp
           JOIN roles r ON r.role_id = rp.role_id
           WHERE r.role_code = ?`,
          [roleCode]
        )
        .map((row) => row.permission_code)
    )
  }

  nameOf(roleCode: RoleCode): string {
    return (
      this.db.get<{ name: string }>('SELECT name FROM roles WHERE role_code = ?', [roleCode])
        ?.name ?? roleCode
    )
  }

  list(): RoleSummary[] {
    const roles = this.db.all<{ role_code: RoleCode; name: string }>(
      'SELECT role_code, name FROM roles ORDER BY role_id'
    )
    const grants = this.db.all<{ role_code: RoleCode; permission_code: PermissionCode }>(
      `SELECT r.role_code, rp.permission_code FROM role_permissions rp
       JOIN roles r ON r.role_id = rp.role_id`
    )
    return roles.map((role) => ({
      roleCode: role.role_code,
      name: role.name,
      permissions: inCatalogueOrder(
        grants.filter((g) => g.role_code === role.role_code).map((g) => g.permission_code)
      )
    }))
  }
}
