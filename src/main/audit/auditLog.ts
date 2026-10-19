import type { AuditAction, AuditChanges } from '@shared/audit'
import type { Actor } from '../auth/access'
import type { Database } from '../db/database'
import type { Clock } from '../lib/clock'
import { redact } from '../logging/redact'

/** Large enough for any summary of a change; anything bigger is a bug. */
const MAX_DETAILS_LENGTH = 8_000

export interface AuditEntry {
  action: AuditAction
  /** The record the action was about. */
  entity?: { type: string; id: number }
  /**
   * Extra facts, written for people reading the log later: names rather than
   * ids where it helps, and `changes: { field: { from, to } }` for edits.
   * Fields that look secret (passwords, PINs, tokens) are masked.
   */
  details?: Record<string, unknown>
}

/**
 * Who did it: the request's actor (which also records who approved it, if a
 * manager approval was used), a user known some other way, or null for
 * StorePro itself.
 */
export type AuditSubject = { actor: Actor } | { userId: number | null }

/**
 * The append-only record of important actions (FR-013, M07-01). Every module
 * records through this; the table rejects updates and deletes.
 *
 *  - `change()` for an action that changes stored data. It must be called
 *    inside that change's transaction, so the change and its audit entry are
 *    saved together or not at all (M07-02). Calling it outside one throws.
 *  - `event()` for something that happened without changing a record: a
 *    sign-in, a refused request, a failed approval.
 */
export class AuditLog {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock
  ) {}

  change(entry: AuditEntry & AuditSubject): void {
    if (!this.db.inTransaction) {
      throw new Error(`Audit entry ${entry.action} must be written in the change's transaction`)
    }
    this.write(entry)
  }

  event(entry: AuditEntry & AuditSubject): void {
    this.write(entry)
  }

  private write(entry: AuditEntry & AuditSubject): void {
    const userId = 'actor' in entry ? entry.actor.userId : entry.userId
    const approvedBy = 'actor' in entry ? (entry.actor.override?.approvedBy.userId ?? null) : null
    const details = entry.details === undefined ? null : JSON.stringify(redact(entry.details))
    if (details !== null && details.length > MAX_DETAILS_LENGTH) {
      throw new Error(`Audit details for ${entry.action} are too large (${details.length} chars)`)
    }
    this.db.run(
      `INSERT INTO audit_logs
         (occurred_at, user_id, approved_by_user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.clock.now(),
        userId,
        approvedBy,
        entry.action,
        entry.entity?.type ?? null,
        entry.entity?.id ?? null,
        details
      ]
    )
  }
}

/**
 * The fields that differ between two snapshots of a record, for
 * `details.changes`. Pass values as people read them (names, not ids).
 * Returns null when nothing changed, so a no-op edit records nothing.
 */
export function changesBetween<T extends Record<string, unknown>>(
  before: T,
  after: T
): AuditChanges | null {
  const changes: AuditChanges = {}
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null }
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}
