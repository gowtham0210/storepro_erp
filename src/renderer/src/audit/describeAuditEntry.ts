import type { AuditLogEntry } from '@shared/ipc/contract'
import { isPermissionCode, permissionDescription } from '@shared/permissions'
import { PRODUCT_FIELD_LABELS } from '@shared/schemas/catalog'
import { PRICING_FIELD_LABELS } from '@shared/schemas/pricing'
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
    case 'tax_class.created': {
      const cess = d['cess'] && d['cess'] !== '0%' ? ` + ${text(d['cess'])} cess` : ''
      return `${text(d['name'] ?? subject)}: ${text(d['rate'])}${cess}`
    }
    case 'tax_class.updated':
      return `${text(d['name'] ?? subject)}: ${changes(d['changes'], PRICING_FIELD_LABELS)}`
    case 'tax_class.archived':
    case 'tax_class.restored':
      return text(d['name'] ?? subject)
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
