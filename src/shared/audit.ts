/**
 * The audit action catalogue (M07, FR-013).
 *
 * Every action written to the audit log is named here once, with the label
 * the audit log viewer shows. The main process can only record actions from
 * this list, so a new kind of entry is always registered (and labelled)
 * first. Modules add their actions as they are built; docs/audit-log.md lists
 * which module records what.
 *
 * This file must stay free of runtime dependencies: the renderer imports it.
 */
export const AUDIT_CATEGORIES = [
  {
    id: 'access',
    label: 'Sign-in and access',
    actions: [
      { code: 'user.sign_in', label: 'Signed in' },
      { code: 'user.sign_in_failed', label: 'Sign-in failed' },
      { code: 'user.sign_out', label: 'Signed out' },
      { code: 'user.password_changed', label: 'Changed their password' },
      { code: 'access.denied', label: 'Refused: not allowed' },
      { code: 'override.approved', label: 'Approved a restricted action' },
      { code: 'override.denied', label: 'Approval refused' }
    ]
  },
  {
    id: 'users',
    label: 'User accounts',
    actions: [
      { code: 'user.created', label: 'Added a user' },
      { code: 'user.updated', label: 'Changed a user' },
      { code: 'user.password_reset', label: 'Reset a password' },
      { code: 'user.deactivated', label: 'Deactivated a user' },
      { code: 'user.reactivated', label: 'Reactivated a user' }
    ]
  },
  {
    id: 'settings',
    label: 'Store settings',
    actions: [
      { code: 'store.set_up', label: 'Set up the store' },
      { code: 'store.updated', label: 'Changed store settings' },
      { code: 'module.enabled', label: 'Switched a module on' },
      { code: 'module.disabled', label: 'Switched a module off' },
      { code: 'pricing.updated', label: 'Changed rounding or discount limit' },
      { code: 'tax_class.created', label: 'Added a tax rate' },
      { code: 'tax_class.updated', label: 'Changed a tax rate' },
      { code: 'tax_class.archived', label: 'Archived a tax rate' },
      { code: 'tax_class.restored', label: 'Restored a tax rate' },
      { code: 'payment_method.created', label: 'Added a payment method' },
      { code: 'payment_method.updated', label: 'Changed a payment method' },
      { code: 'payment_method.archived', label: 'Archived a payment method' },
      { code: 'payment_method.restored', label: 'Restored a payment method' },
      { code: 'printer.updated', label: 'Changed printer settings' },
      { code: 'weigh_barcode.updated', label: 'Changed scale barcode settings' }
    ]
  },
  {
    id: 'sales',
    label: 'Sales and billing',
    actions: [
      { code: 'sale.created', label: 'Completed a sale' },
      { code: 'sale.voided', label: 'Voided a sale' },
      { code: 'sale.reprinted', label: 'Reprinted an invoice' }
    ]
  },
  {
    id: 'catalogue',
    label: 'Products and prices',
    actions: [
      { code: 'product.created', label: 'Added a product' },
      { code: 'product.updated', label: 'Changed a product' },
      { code: 'product.price_changed', label: 'Changed a price' },
      { code: 'product.archived', label: 'Archived a product' },
      { code: 'product.restored', label: 'Restored a product' },
      { code: 'variant.created', label: 'Added a pack size' },
      { code: 'variant.archived', label: 'Archived a pack size' },
      { code: 'variant.restored', label: 'Restored a pack size' },
      { code: 'category.created', label: 'Added a category' },
      { code: 'category.updated', label: 'Renamed a category' },
      { code: 'category.archived', label: 'Archived a category' },
      { code: 'category.restored', label: 'Restored a category' },
      { code: 'unit.created', label: 'Added a unit' },
      { code: 'unit.updated', label: 'Renamed a unit' }
    ]
  },
  {
    id: 'stock',
    label: 'Stock',
    actions: [
      { code: 'stock.adjusted', label: 'Adjusted stock' },
      { code: 'stock.counted', label: 'Counted stock' }
    ]
  },
  {
    id: 'purchasing',
    label: 'Suppliers and purchases',
    actions: [
      { code: 'supplier.created', label: 'Added a supplier' },
      { code: 'supplier.updated', label: 'Changed a supplier' },
      { code: 'supplier.archived', label: 'Archived a supplier' },
      { code: 'supplier.restored', label: 'Restored a supplier' },
      { code: 'purchase_order.created', label: 'Started a purchase order' },
      { code: 'purchase_order.updated', label: 'Changed a draft purchase order' },
      { code: 'purchase_order.confirmed', label: 'Confirmed a purchase order' },
      { code: 'purchase_order.closed', label: 'Closed a purchase order' },
      { code: 'purchase_order.cancelled', label: 'Cancelled a purchase order' },
      { code: 'purchase_order.deleted', label: 'Deleted a draft purchase order' },
      { code: 'goods_receipt.created', label: 'Started a goods receipt' },
      { code: 'goods_receipt.updated', label: 'Changed a draft goods receipt' },
      { code: 'goods_receipt.posted', label: 'Received goods into stock' },
      { code: 'goods_receipt.deleted', label: 'Deleted a draft goods receipt' }
    ]
  },
  {
    id: 'expenses',
    label: 'Expenses',
    actions: [
      { code: 'expense.recorded', label: 'Recorded an expense' },
      { code: 'expense.updated', label: 'Changed an expense' },
      { code: 'expense.voided', label: 'Voided an expense' },
      { code: 'expense.restored', label: 'Restored an expense' },
      { code: 'expense_category.created', label: 'Added an expense category' },
      { code: 'expense_category.updated', label: 'Renamed an expense category' },
      { code: 'expense_category.archived', label: 'Archived an expense category' },
      { code: 'expense_category.restored', label: 'Restored an expense category' }
    ]
  },
  {
    id: 'system',
    label: 'StorePro',
    actions: [
      { code: 'system.database_upgraded', label: 'Store data upgraded' },
      { code: 'system.unclean_shutdown', label: 'Recovered from an unexpected shutdown' },
      { code: 'system.integrity_problems', label: 'Data check found problems' }
    ]
  }
] as const

export type AuditAction = (typeof AUDIT_CATEGORIES)[number]['actions'][number]['code']

export const AUDIT_ACTIONS: readonly AuditAction[] = AUDIT_CATEGORIES.flatMap((category) =>
  category.actions.map((action) => action.code)
)

const LABELS = new Map<string, string>(
  AUDIT_CATEGORIES.flatMap((category) =>
    category.actions.map((action) => [action.code, action.label] as const)
  )
)

export function isAuditAction(value: string): value is AuditAction {
  return LABELS.has(value)
}

/** The viewer's name for an action; codes from a newer version show as they are. */
export function auditActionLabel(action: string): string {
  return LABELS.get(action) ?? action
}

/**
 * A changed field in `details.changes`: what it was and what it became, as
 * people read them (role names, not role codes). Shared by every "changed"
 * action so the viewer can describe them all the same way.
 */
export type AuditChanges = Record<string, { from: unknown; to: unknown }>
