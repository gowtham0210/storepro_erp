import type { AuditLogEntry } from '@shared/ipc/contract'
import { isPermissionCode, permissionDescription } from '@shared/permissions'
import { PRODUCT_FIELD_LABELS } from '@shared/schemas/catalog'
import { PRICING_FIELD_LABELS } from '@shared/schemas/pricing'
import { PRINTER_FIELD_LABELS } from '@shared/schemas/printing'
import { STORE_FIELD_LABELS } from '@shared/schemas/store'

/** How changed fields are named in sentences. Unknown fields use their key. */
const USER_FIELDS: Record<string, string> = { name: 'name', role: 'role' }

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'nothing'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function permission(value: unknown): string {
  return typeof value === 'string' && isPermissionCode(value)
    ? permissionDescription(value)
    : text(value)
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function changes(value: unknown, names: Record<string, string> = USER_FIELDS): string {
  if (typeof value !== 'object' || value === null) return ''
  return Object.entries(value as Record<string, { from?: unknown; to?: unknown }>)
    .map(
      ([field, change]) =>
        `${names[field] ?? field} from ${text(change.from)} to ${text(change.to)}`
    )
    .join('; ')
}

/** "3 items": the recorded count (entries list only the first lines of a big document), else the lines listed. */
function itemCount(details: Record<string, unknown>): string {
  const count =
    typeof details['itemCount'] === 'number'
      ? details['itemCount']
      : Array.isArray(details['items'])
        ? details['items'].length
        : 0
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

const SUPPLIER_FIELDS: Record<string, string> = {
  name: 'name',
  contactPerson: 'contact person',
  phone: 'phone',
  email: 'email',
  address: 'address',
  taxRegistrationNumber: 'tax number'
}

const CUSTOMER_FIELDS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  taxRegistrationNumber: 'tax number'
}

const DOCUMENT_FIELDS: Record<string, string> = {
  supplier: 'supplier',
  notes: 'note',
  total: 'total',
  order: 'order',
  supplierBill: 'supplier bill',
  supplierBillDate: 'supplier bill date'
}

const EXPENSE_FIELDS: Record<string, string> = {
  category: 'category',
  date: 'date',
  amount: 'amount',
  paymentMethod: 'paid by',
  description: 'note'
}

/** "GRN000004 · Anand Wholesale · against PO000002 · bill AW-1042 · 3 items · ₹1,920.00" */
function documentSummary(d: Record<string, unknown>, number: string): string {
  return [
    text(d[number]),
    text(d['supplier']),
    d['order'] ? `against ${text(d['order'])}` : '',
    d['supplierBill'] ? `bill ${text(d['supplierBill'])}` : '',
    d['items'] ? itemCount(d) : '',
    d['total'] ? text(d['total']) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

function costUpdates(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  const described = (value as { item?: unknown; from?: unknown; to?: unknown }[])
    .map((u) => `${text(u.item)} ${text(u.from)} → ${text(u.to)}`)
    .join(', ')
  return ` — cost prices updated: ${described}`
}

function expenseSummary(d: Record<string, unknown>): string {
  return [
    text(d['category']),
    text(d['amount']),
    text(d['date']),
    d['paymentMethod'] ? `paid by ${text(d['paymentMethod'])}` : '',
    d['description'] ? `“${text(d['description'])}”` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Any other details, as "key: value" pairs, so nothing recorded is hidden. */
function generic(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${text(value)}`)
    .join(', ')
}

/**
 * A short sentence with the facts behind an audit entry, for the viewer's
 * Details column. The action's label (who did what) is shown separately.
 * Returns '' when the label says it all.
 */
export function describeAuditEntry(entry: AuditLogEntry): string {
  const d = entry.details ?? {}
  const subject =
    entry.entity?.label ?? (entry.entity ? `${entry.entity.type} #${entry.entity.id}` : '')
  switch (entry.action) {
    case 'user.sign_in':
    case 'user.sign_out':
    case 'user.password_changed':
      return ''
    case 'user.sign_in_failed':
      return `Username entered: “${text(d['username'])}”`
    case 'access.denied':
      return `Tried to ${lowerFirst(permission(d['permission']))}`
    case 'override.approved':
      return `“${permission(d['permission'])}” for ${subject}`
    case 'override.denied': {
      const why =
        d['reason'] === 'not_permitted'
          ? "the approver isn't allowed to do it"
          : `wrong password for “${text(d['username'])}”`
      return `“${permission(d['permission'])}” for ${subject}: ${why}`
    }
    case 'user.created':
      return `${subject} (${text(d['username'])}) as ${text(d['role'])}${d['initialSetup'] === true ? ', during first-run setup' : ''}`
    case 'user.updated':
      return `${subject}: ${changes(d['changes'])}`
    case 'user.password_reset':
    case 'user.deactivated':
    case 'user.reactivated':
      return subject
    case 'module.enabled':
    case 'module.disabled':
      return text(d['module'])
    case 'store.set_up':
      return text(d['name'])
    case 'store.updated': {
      const described = changes(d['changes'], STORE_FIELD_LABELS)
      return described.charAt(0).toUpperCase() + described.slice(1)
    }
    case 'pricing.updated': {
      const described = changes(d['changes'], PRICING_FIELD_LABELS)
      return described.charAt(0).toUpperCase() + described.slice(1)
    }
    case 'printer.updated':
    case 'weigh_barcode.updated': {
      const described = changes(d['changes'], PRINTER_FIELD_LABELS)
      return described.charAt(0).toUpperCase() + described.slice(1)
    }
    case 'tax_class.created': {
      const cess = d['cess'] && d['cess'] !== '0%' ? ` + ${text(d['cess'])} cess` : ''
      return `${text(d['name'] ?? subject)}: ${text(d['rate'])}${cess}`
    }
    case 'tax_class.updated':
      return `${text(d['name'] ?? subject)}: ${changes(d['changes'], PRICING_FIELD_LABELS)}`
    case 'tax_class.archived':
    case 'tax_class.restored':
      return text(d['name'] ?? subject)
    case 'payment_method.created':
      return `${text(d['name'] ?? subject)} (${text(d['code'])} · ${text(d['kind'])})`
    case 'payment_method.updated':
      return `${text(d['name'] ?? subject)}: ${changes(d['changes'], { name: 'name', kind: 'type', sortOrder: 'order' })}`
    case 'payment_method.archived':
    case 'payment_method.restored':
      return text(d['name'] ?? subject)
    case 'sale.created': {
      const count = Number(d['items'] ?? 0)
      const itemsLabel = `${count} ${count === 1 ? 'item' : 'items'}`
      const discount = d['discount'] ? ` (${text(d['discount'])} discount)` : ''
      return `${text(d['invoiceNumber'] ?? subject)} · ${itemsLabel} · ${text(d['total'])}${discount}`
    }
    case 'sale.voided': {
      const total = d['total'] ? ` (${text(d['total'])})` : ''
      return `${text(d['invoiceNumber'] ?? subject)}${total} — ${text(d['reason'])}`
    }
    case 'sale.reprinted':
      return text(d['invoiceNumber'] ?? subject)
    case 'product.created': {
      const items = Array.isArray(d['items']) ? (d['items'] as unknown[]).map(text) : []
      return [text(d['name']), items.join(', ')].filter(Boolean).join(': ')
    }
    case 'product.updated':
    case 'product.price_changed':
      return `${text(d['item'] ?? d['name'] ?? subject)}: ${changes(d['changes'], PRODUCT_FIELD_LABELS)}`
    case 'product.archived':
    case 'product.restored':
    case 'category.created':
    case 'category.archived':
    case 'category.restored':
      return text(d['name'] ?? subject)
    case 'category.updated':
      return changes(d['changes'], { name: 'name' })
    case 'variant.created':
    case 'variant.archived':
    case 'variant.restored':
      return text(d['item'])
    case 'unit.created':
      return `${text(d['name'])} (${text(d['code'])})${d['fractions'] === 'yes' ? ', sold in fractions' : ''}`
    case 'unit.updated':
      return `${text(d['code'])}: ${changes(d['changes'], { name: 'name' })}`
    case 'stock.adjusted': {
      const items = Array.isArray(d['items'])
        ? (d['items'] as { item?: unknown; change?: unknown }[])
            .map((line) => `${text(line.item)} (${text(line.change)})`)
            .join(', ')
        : ''
      const note = d['notes'] ? ` — ${text(d['notes'])}` : ''
      return `${text(d['adjustmentNumber'] ?? subject)} · ${text(d['reason'])}: ${items}${note}`
    }
    case 'stock.counted': {
      const items = Array.isArray(d['items'])
        ? (
            d['items'] as {
              item?: unknown
              recorded?: unknown
              counted?: unknown
              change?: unknown
            }[]
          )
            .map((line) => `${text(line.item)} ${text(line.recorded)} → ${text(line.counted)}`)
            .join(', ')
        : ''
      const note = d['notes'] ? ` — ${text(d['notes'])}` : ''
      return `${text(d['adjustmentNumber'] ?? subject)}: ${items}${note}`
    }
    case 'customer.created':
      return [text(d['name'] ?? subject), d['phone'] ? text(d['phone']) : '']
        .filter(Boolean)
        .join(' · ')
    case 'customer.archived':
    case 'customer.restored':
      return text(d['name'] ?? subject)
    case 'customer.updated':
      return `${text(d['name'] ?? subject)}: ${changes(d['changes'], CUSTOMER_FIELDS)}`
    case 'return.created': {
      const refunds = Array.isArray(d['refunds'])
        ? (d['refunds'] as { method?: unknown; amount?: unknown }[])
            .map((r) => `${text(r.method)} ${text(r.amount)}`)
            .join(', ')
        : ''
      return `${text(d['returnNumber'])} · invoice ${text(d['invoiceNumber'])} · ${itemCount(d)} · refunded ${refunds || text(d['refundDue'])}${d['reason'] ? ` — ${text(d['reason'])}` : ''}`
    }
    case 'return.printed':
    case 'return.reprinted':
      return `${text(d['returnNumber'])} · invoice ${text(d['invoiceNumber'])}`
    case 'supplier.created':
    case 'supplier.archived':
    case 'supplier.restored':
      return text(d['name'] ?? subject)
    case 'supplier.updated':
      return `${text(d['name'] ?? subject)}: ${changes(d['changes'], SUPPLIER_FIELDS)}`
    case 'purchase_order.created':
      return documentSummary(d, 'orderNumber')
    case 'purchase_order.updated': {
      const described = changes(d['changes'], DOCUMENT_FIELDS)
      return `${text(d['orderNumber'])}: ${described || `items changed (${itemCount(d)})`}`
    }
    case 'purchase_order.confirmed':
      return [text(d['orderNumber']), text(d['supplier']), text(d['total'])].join(' · ')
    case 'purchase_order.closed':
    case 'purchase_order.cancelled':
      return `${text(d['orderNumber'])} · ${text(d['supplier'])}${d['reason'] ? ` — ${text(d['reason'])}` : ''}`
    case 'purchase_order.deleted':
      return `${text(d['orderNumber'])} · ${text(d['supplier'])}`
    case 'goods_receipt.created':
      return documentSummary(d, 'receiptNumber')
    case 'goods_receipt.updated': {
      const described = changes(d['changes'], DOCUMENT_FIELDS)
      return `${text(d['receiptNumber'])}: ${described || `items changed (${itemCount(d)})`}`
    }
    case 'goods_receipt.posted':
      return `${documentSummary(d, 'receiptNumber')}${d['orderClosed'] === true ? ' — order fully received' : ''}${costUpdates(d['costPricesUpdated'])}`
    case 'goods_receipt.deleted':
      return `${text(d['receiptNumber'])} · ${text(d['supplier'])}`
    case 'expense.recorded':
    case 'expense.voided':
    case 'expense.restored':
      return expenseSummary(d)
    case 'expense.updated':
      return `${text(d['category'])} on ${text(d['date'])}: ${changes(d['changes'], EXPENSE_FIELDS)}`
    case 'expense_category.created':
    case 'expense_category.archived':
    case 'expense_category.restored':
      return text(d['name'] ?? subject)
    case 'expense_category.updated':
      return changes(d['changes'], { name: 'name' })
    case 'system.database_upgraded':
      return `From version ${text(d['fromVersion'])} to ${text(d['toVersion'])}${d['backupFile'] ? `. A backup was saved first (${text(d['backupFile'])})` : ''}`
    case 'system.unclean_shutdown': {
      const started = d['previousSessionStartedAt']
      return typeof started === 'string' && !Number.isNaN(Date.parse(started))
        ? `The session started ${dateTime.format(Date.parse(started))} didn't close normally`
        : "The previous session didn't close normally"
    }
    case 'system.integrity_problems': {
      const problems = Array.isArray(d['problems'])
        ? (d['problems'] as { check?: unknown; count?: unknown }[])
        : []
      return problems.map((p) => `${text(p.check)}: ${text(p.count)}`).join(', ')
    }
    default:
      return [subject, generic(d)].filter(Boolean).join(': ')
  }
}
