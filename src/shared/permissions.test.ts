import { describe, expect, it } from 'vitest'
import {
  canGrant,
  inCatalogueOrder,
  isPermissionCode,
  PERMISSION_CODES,
  PERMISSION_GROUPS,
  permissionDenialFrom,
  permissionDescription
} from './permissions'

describe('permission catalogue', () => {
  it('has unique, well-formed codes', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z]+\.[a-z_]+$/)
    expect(PERMISSION_GROUPS.every((group) => group.permissions.length > 0)).toBe(true)
  })

  it('covers the sensitive operations the PRD names (FR-012)', () => {
    for (const code of [
      'discount.override',
      'stock.adjust',
      'sale.void',
      'settings.edit',
      'sale.reprint'
    ]) {
      expect(isPermissionCode(code)).toBe(true)
    }
    expect(isPermissionCode('sale.fly')).toBe(false)
    expect(permissionDescription('sale.void')).toBe('Void a completed sale')
  })

  it('sorts codes into catalogue order', () => {
    expect(inCatalogueOrder(['user.manage', 'sale.create', 'stock.adjust'])).toEqual([
      'sale.create',
      'stock.adjust',
      'user.manage'
    ])
  })

  it('only lets someone grant a role whose permissions they all hold', () => {
    expect(canGrant(['sale.create', 'sale.view'], ['sale.create'])).toBe(true)
    expect(canGrant(new Set(['sale.create'] as const), ['sale.create', 'sale.void'])).toBe(false)
    expect(canGrant([], [])).toBe(true)
  })

  it('reads the details of a permission denial, ignoring anything else', () => {
    expect(permissionDenialFrom({ permission: 'sale.void', overridable: true })).toEqual({
      permission: 'sale.void',
      overridable: true
    })
    expect(permissionDenialFrom({ permission: 'sale.void' })).toEqual({
      permission: 'sale.void',
      overridable: false
    })
    expect(permissionDenialFrom({ permission: 'sale.fly', overridable: true })).toBeNull()
    expect(permissionDenialFrom([{ path: 'x', message: 'y' }])).toBeNull()
    expect(permissionDenialFrom(null)).toBeNull()
  })
})
