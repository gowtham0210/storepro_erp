import type {
  AuditFilterOptions,
  AuditLogEntry,
  AuditLogFilter,
  AuditLogPage,
  AuditPerson
} from '@shared/ipc/contract'
import { Repository } from '../db/repository'

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

interface Row {
  audit_log_id: number
  occurred_at: number
  action: string
  entity_type: string | null
  entity_id: number | null
  details: string | null
  actor_id: number | null
  actor_name: string | null
  actor_username: string | null
  approver_id: number | null
  approver_name: string | null
  approver_username: string | null
  entity_label: string | null
}

function person(
  id: number | null,
  name: string | null,
  username: string | null
): AuditPerson | null {
  return id === null ? null : { userId: id, displayName: name ?? '', username: username ?? '' }
}

function toEntry(row: Row): AuditLogEntry {
  return {
    id: row.audit_log_id,
    occurredAt: row.occurred_at,
    action: row.action,
    actor: person(row.actor_id, row.actor_name, row.actor_username),
    approvedBy: person(row.approver_id, row.approver_name, row.approver_username),
    entity:
      row.entity_type === null || row.entity_id === null
        ? null
        : { type: row.entity_type, id: row.entity_id, label: row.entity_label },
    details: row.details === null ? null : (JSON.parse(row.details) as Record<string, unknown>)
  }
}

/**
 * Reads the audit log for the viewer (M07-04). Pages run newest first by id
 * (insertion order, which stays right even if the computer's clock was
 * changed) and continue with a keyset cursor, so a page costs the same however
 * far back it is.
 */
export class AuditLogReader extends Repository {
  list(filter: AuditLogFilter): AuditLogPage {
    const where: string[] = []
    const params: (number | string)[] = []
    if (filter.person === 'system') where.push('a.user_id IS NULL')
    else if (filter.person !== undefined) {
      where.push('(a.user_id = ? OR a.approved_by_user_id = ?)')
      params.push(filter.person, filter.person)
    }
    if (filter.action !== undefined) {
      where.push('a.action = ?')
      params.push(filter.action)
    }
    if (filter.from !== undefined) {
      where.push('a.occurred_at >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      where.push('a.occurred_at < ?')
      params.push(filter.to)
    }
    if (filter.entity !== undefined) {
      where.push('a.entity_type = ? AND a.entity_id = ?')
      params.push(filter.entity.type, filter.entity.id)
    }
    if (filter.before !== undefined) {
      where.push('a.audit_log_id < ?')
      params.push(filter.before)
    }
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const rows = this.db.all<Row>(
      `SELECT a.audit_log_id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.details,
              actor.user_id AS actor_id, actor.display_name AS actor_name,
              actor.username AS actor_username,
              approver.user_id AS approver_id, approver.display_name AS approver_name,
              approver.username AS approver_username,
              subject.display_name AS entity_label
       FROM audit_logs a
       LEFT JOIN users actor ON actor.user_id = a.user_id
       LEFT JOIN users approver ON approver.user_id = a.approved_by_user_id
       LEFT JOIN users subject ON a.entity_type = 'user' AND subject.user_id = a.entity_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.audit_log_id DESC
       LIMIT ?`,
      [...params, limit + 1]
    )
    const entries = rows.slice(0, limit).map(toEntry)
    return {
      entries,
      nextBefore: rows.length > limit ? (entries.at(-1)?.id ?? null) : null
    }
  }

  filterOptions(): AuditFilterOptions {
    const actions = this.db
      .all<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action')
      .map((row) => row.action)
    const people = this.db
      .all<{ user_id: number; display_name: string; username: string }>(
        `SELECT u.user_id, u.display_name, u.username FROM users u
         WHERE EXISTS (SELECT 1 FROM audit_logs a WHERE a.user_id = u.user_id)
            OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.approved_by_user_id = u.user_id)
         ORDER BY u.display_name COLLATE NOCASE`
      )
      .map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        username: row.username
      }))
    return { actions, people }
  }
}
