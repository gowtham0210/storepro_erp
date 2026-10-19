/**
 * The permission catalogue (M06-01, FR-011, FR-012).
 *
 * Every action the main process restricts is named here once. Migration 0003
 * seeds the same codes and descriptions into the `permissions` table and maps
 * them to roles; a test keeps the two identical. Groups only order the list on
 * screen.
 *
 * This file must stay free of runtime dependencies: the renderer imports it.
 */
export const PERMISSION_GROUPS = [
  {
    id: 'sales',
    label: 'Sales',
    permissions: [
      { code: 'sale.create', description: 'Bill customers at the counter' },
      { code: 'sale.view', description: 'View past sales and invoices' },
      { code: 'sale.reprint', description: 'Reprint invoices and receipts' },
      { code: 'sale.void', description: 'Void a completed sale' },
      { code: 'discount.apply', description: 'Give discounts within the store limit' },
      { code: 'discount.override', description: 'Give discounts above the store limit' },
      { code: 'price.override', description: "Change an item's price on a bill" },
      { code: 'return.create', description: 'Take returns and give refunds' }
    ]
  },
  {
    id: 'customers',
    label: 'Customers',
    permissions: [
      { code: 'customer.view', description: 'View customers' },
      { code: 'customer.manage', description: 'Add and edit customers' }
    ]
  },
  {
    id: 'stock',
    label: 'Products and stock',
    permissions: [
      { code: 'product.view', description: 'View products and prices' },
      { code: 'product.manage', description: 'Add and edit products and prices' },
      { code: 'inventory.view', description: 'View stock levels and movements' },
      { code: 'stock.adjust', description: 'Adjust stock quantities' }
    ]
  },
  {
    id: 'purchasing',
    label: 'Purchasing',
    permissions: [
      { code: 'purchase.view', description: 'View purchases' },
      { code: 'purchase.manage', description: 'Record purchases and goods received' },
      { code: 'supplier.view', description: 'View suppliers' },
      { code: 'supplier.manage', description: 'Add and edit suppliers' }
    ]
  },
  {
    id: 'business',
    label: 'Expenses and reports',
    permissions: [
      { code: 'expense.view', description: 'View expenses' },
      { code: 'expense.manage', description: 'Record expenses' },
      { code: 'report.view', description: 'View reports and the dashboard' }
    ]
  },
  {
    id: 'administration',
    label: 'Administration',
    permissions: [
      { code: 'user.manage', description: 'Add users, change their roles and reset passwords' },
      { code: 'settings.view', description: 'View store settings' },
      { code: 'settings.edit', description: 'Change store settings' },
      { code: 'audit.view', description: 'View the audit log' },
      { code: 'backup.create', description: 'Back up store data' },
      { code: 'backup.restore', description: 'Restore store data from a backup' },
      { code: 'data.export', description: 'Export data to files' },
      { code: 'data.import', description: 'Import data from files' }
    ]
  }
] as const

export type PermissionCode = (typeof PERMISSION_GROUPS)[number]['permissions'][number]['code']

/** Every permission, in catalogue order. */
export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.code)
)

const DESCRIPTIONS = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((permission) => [permission.code, permission.description] as const)
  )
)

export function isPermissionCode(value: string): value is PermissionCode {
  return DESCRIPTIONS.has(value)
}

export function permissionDescription(code: PermissionCode): string {
  return DESCRIPTIONS.get(code) ?? code
}

/** Sorts codes into catalogue order, so lists read the same everywhere. */
export function inCatalogueOrder(codes: Iterable<PermissionCode>): PermissionCode[] {
  const wanted = new Set(codes)
  return PERMISSION_CODES.filter((code) => wanted.has(code))
}

/**
 * The no-escalation rule: someone may give a role to a user, or change the
 * account of a user with that role, only if they hold every permission the
 * role grants. So nobody can hand out, or take over, more access than they have.
 */
export function canGrant(
  held: ReadonlySet<PermissionCode> | readonly PermissionCode[],
  rolePermissions: readonly PermissionCode[]
): boolean {
  const set = held instanceof Set ? held : new Set(held)
  return rolePermissions.every((code) => set.has(code))
}

/** `details` of a FORBIDDEN error raised by the permission guard. */
export interface PermissionDenial {
  permission: PermissionCode
  /** A user who holds the permission may approve this one request (M06-05). */
  overridable: boolean
}

export function permissionDenialFrom(details: unknown): PermissionDenial | null {
  if (typeof details !== 'object' || details === null) return null
  const { permission, overridable } = details as Record<string, unknown>
  if (typeof permission !== 'string' || !isPermissionCode(permission)) return null
  return { permission, overridable: overridable === true }
}
