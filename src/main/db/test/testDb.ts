import { join } from 'node:path'
import { afterEach } from 'vitest'
import { createTestLogger, useTempDir } from '../../test/helpers'
import { Database } from '../database'
import { migrate } from '../migrator'
import { migrations } from '../migrations'

/** A fixed time so tests never depend on the clock. 2026-10-19 10:00 IST. */
export const fixedClock = { now: () => Date.UTC(2026, 9, 19, 4, 30) }

function migrateForTest(db: Database): Database {
  migrate(db, migrations, {
    appVersion: 'test',
    backupDir: null,
    clock: fixedClock,
    logger: createTestLogger()
  })
  return db
}

/**
 * A fully migrated in-memory database, created on first use and closed after
 * the test. The default for integration tests: fast and isolated.
 */
export function useMigratedDb(): () => Database {
  let db: Database | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })
  return () => (db ??= migrateForTest(Database.open(':memory:')))
}

/**
 * A fully migrated database in a temporary file, with the production
 * connection settings (WAL, FULL sync). Use when a test needs real files:
 * backups, reopening, WAL behaviour or concurrent connections.
 */
export function useMigratedFileDb(): { db: () => Database; path: () => string } {
  const tempDir = useTempDir()
  let db: Database | undefined
  let path: string | undefined
  afterEach(() => {
    db?.close()
    db = undefined
    path = undefined
  })
  const getPath = (): string => (path ??= join(tempDir(), 'storepro.db'))
  return { db: () => (db ??= migrateForTest(Database.open(getPath()))), path: getPath }
}
