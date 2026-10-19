import { afterEach } from 'vitest'
import { createTestLogger } from '../../test/helpers'
import { Database } from '../database'
import { migrate } from '../migrator'
import { migrations } from '../migrations'

export const fixedClock = { now: () => Date.UTC(2026, 9, 19, 4, 30) }

/** A fully migrated in-memory database, closed after the current test. */
export function useMigratedDb(): () => Database {
  let db: Database | undefined
  afterEach(() => {
    db?.close()
    db = undefined
  })
  return () => {
    if (!db) {
      db = Database.open(':memory:')
      migrate(db, migrations, {
        appVersion: 'test',
        backupDir: null,
        clock: fixedClock,
        logger: createTestLogger()
      })
    }
    return db
  }
}
