import { basename } from 'node:path'
import type { StartupStatus } from '@shared/ipc/contract'
import type { IntegrityReport } from '../db/integrity'
import type { MigrationResult } from '../db/migrator'
import type { AuditLog } from './auditLog'

/**
 * What happened to the store's data while StorePro started, recorded as
 * StorePro's own entries (no user). A brand-new store's first migration is
 * not an upgrade and is not recorded.
 */
export function recordStartupEvents(
  audit: AuditLog,
  {
    migration,
    integrity,
    startup
  }: { migration: MigrationResult; integrity: IntegrityReport | null; startup: StartupStatus }
): void {
  if (startup.recoveredFromUncleanShutdown) {
    audit.event({
      action: 'system.unclean_shutdown',
      userId: null,
      details: { previousSessionStartedAt: startup.previousSessionStartedAt }
    })
  }
  if (integrity && !integrity.ok) {
    audit.event({
      action: 'system.integrity_problems',
      userId: null,
      details: { problems: integrity.consistencyViolations }
    })
  }
  if (migration.fromVersion > 0 && migration.applied.length > 0) {
    audit.event({
      action: 'system.database_upgraded',
      userId: null,
      details: {
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        backupFile: migration.backupPath === null ? null : basename(migration.backupPath)
      }
    })
  }
}
