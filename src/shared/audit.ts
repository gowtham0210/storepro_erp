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
      { code: 'module.disabled', label: 'Switched a module off' }
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
