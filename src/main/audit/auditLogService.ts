import type { AuditFilterOptions, AuditLogFilter, AuditLogPage } from '@shared/ipc/contract'
import { assertCan, type Actor } from '../auth/access'
import type { AuditLogReader } from './auditLogReader'

/** The audit log viewer's data (M07-04): read-only, for `audit.view`. */
export class AuditLogService {
  constructor(private readonly reader: AuditLogReader) {}

  list(actor: Actor, filter: AuditLogFilter): AuditLogPage {
    assertCan(actor, 'audit.view')
    return this.reader.list(filter)
  }

  filterOptions(actor: Actor): AuditFilterOptions {
    assertCan(actor, 'audit.view')
    return this.reader.filterOptions()
  }
}
