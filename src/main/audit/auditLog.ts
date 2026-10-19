import type { Clock } from '../lib/clock'
import type { Database } from '../db/database'

export interface AuditEntry {
  /** `area.verb`, e.g. "user.sign_in". */
  action: string
  /** Who did it; null for the system or an unknown user. */
  userId: number | null
  entity?: { type: string; id: number }
  /** Extra facts. Never passwords or hashes. */
  details?: Record<string, unknown>
}

/**
 * Append-only record of sensitive actions (FR-013). Call it inside the same
 * transaction as the change it describes, so the two succeed or fail together.
 * M07 adds the viewer and instruments the remaining actions.
 */
export class AuditLog {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock
  ) {}

  record({ action, userId, entity, details }: AuditEntry): void {
    this.db.run(
      `INSERT INTO audit_logs (occurred_at, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        this.clock.now(),
        userId,
        action,
        entity?.type ?? null,
        entity?.id ?? null,
        details === undefined ? null : JSON.stringify(details)
      ]
    )
  }
}
