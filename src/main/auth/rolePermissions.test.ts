import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES, PERMISSION_GROUPS } from '@shared/permissions'
import { useMigratedDb } from '../db/test/testDb'
import { RoleRepository } from './roleRepository'

const clock = { now: () => 0 }

describe('seeded permissions (migration 0003)', () => {
  const getDb = useMigratedDb()

  it('match the shared catalogue exactly, codes and descriptions', () => {
    const rows = getDb().all<{ permission_code: string; description: string }>(
      'SELECT permission_code, description FROM permissions ORDER BY permission_code'
    )
    const catalogue = PERMISSION_GROUPS.flatMap((group) =>
      group.permissions.map((p) => ({ permission_code: p.code, description: p.description }))
    ).sort((a, b) => a.permission_code.localeCompare(b.permission_code))
    expect(rows).toEqual(catalogue)
  })

  it('give administrators every permission', () => {
    expect(new RoleRepository(getDb(), clock).permissionsOf('administrator')).toEqual(
      PERMISSION_CODES
    )
  })

  // The mapping is a product decision (docs/permissions.md). Changing it must
  // be deliberate: update this test together with a new migration.
  it('map the other roles as documented', () => {
    const roles = new RoleRepository(getDb(), clock)
    expect(PERMISSION_CODES.filter((c) => !roles.permissionsOf('manager').includes(c))).toEqual([
      'settings.edit',
      'backup.restore',
      'data.import'
    ])
    expect(roles.permissionsOf('cashier')).toEqual([
      'sale.create',
      'sale.view',
      'discount.apply',
      'customer.view',
      'customer.manage',
      'product.view',
      'inventory.view'
    ])
    expect(roles.permissionsOf('inventory_operator')).toEqual([
      'product.view',
      'product.manage',
      'inventory.view',
      'stock.adjust',
      'purchase.view',
      'purchase.manage',
      'supplier.view',
      'supplier.manage'
    ])
  })

  it('keep the restricted operations away from cashiers (FR-012)', () => {
    const cashier = new RoleRepository(getDb(), clock).permissionsOf('cashier')
    for (const code of [
      'discount.override',
      'price.override',
      'stock.adjust',
      'sale.void',
      'sale.reprint',
      'settings.edit',
      'user.manage'
    ] as const) {
      expect(cashier).not.toContain(code)
    }
  })

  it('list roles with their permissions, in a stable order', () => {
    const roles = new RoleRepository(getDb(), clock).list()
    expect(roles.map((r) => r.roleCode)).toEqual([
      'administrator',
      'manager',
      'cashier',
      'inventory_operator'
    ])
    expect(roles[2]?.permissions[0]).toBe('sale.create')
  })
})
