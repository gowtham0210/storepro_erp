import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Clock } from '../lib/clock'
import type { Logger } from '../logging/logger'
import { Database } from './database'
import { checkIntegrity, type IntegrityReport } from './integrity'
import { migrate, type MigrationResult } from './migrator'
import { migrations } from './migrations'

export { Database } from './database'
export { DatabaseTooNewError, MigrationError } from './migrator'

export class DatabaseIntegrityError extends Error {
  constructor(readonly report: IntegrityReport) {
    super('The database failed its integrity check')
    this.name = 'DatabaseIntegrityError'
  }
}

export interface OpenStoreDatabaseOptions {
  path: string
  backupDir: string
  appVersion: string
  /** Run a quick integrity check before anything else, e.g. after an unclean shutdown. */
  verifyIntegrity: boolean
  clock: Clock
  logger: Logger
}

export interface OpenedStoreDatabase {
  db: Database
  migration: MigrationResult
  integrity: IntegrityReport | null
}

/** Open the store database, verify it if asked, and bring its schema up to date. */
export function openStoreDatabase(options: OpenStoreDatabaseOptions): OpenedStoreDatabase {
  const { path, backupDir, appVersion, verifyIntegrity, clock, logger } = options
  mkdirSync(dirname(path), { recursive: true })
  const db = Database.open(path)
  try {
    let integrity: IntegrityReport | null = null
    if (verifyIntegrity) {
      integrity = checkIntegrity(db, 'quick')
      logger.info('Database integrity check finished', {
        ok: integrity.ok,
        durationMs: integrity.durationMs
      })
      // Migrating a damaged database could make things worse.
      if (integrity.storageProblems.length > 0 || integrity.foreignKeyViolations.length > 0) {
        throw new DatabaseIntegrityError(integrity)
      }
      if (!integrity.ok) {
        logger.warn('Database consistency problems found', {
          violations: integrity.consistencyViolations
        })
      }
    }
    const migration = migrate(db, migrations, { appVersion, backupDir, clock, logger })
    return { db, migration, integrity }
  } catch (error) {
    db.close()
    throw error
  }
}
