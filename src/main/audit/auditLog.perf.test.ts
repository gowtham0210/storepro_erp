import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database } from '../db/database'
import { migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import { fixedClock } from '../db/test/testDb'
import { createTestLogger, useTempDir } from '../test/helpers'
import { AuditLogReader } from './auditLogReader'

/**
 * The audit log viewer on a log the size of several years at a busy store:
 * 300,000 entries from 20 people. Every page must load in well under the
 * 300 ms the PRD allows for a screen to respond (§11).
 */
const ENTRIES = 300_000
const DAY_MS = 24 * 60 * 60 * 1000
const TARGET_MS = 50

describe('audit log viewer performance', () => {
  const tempDir = useTempDir()
  let db: Database
  let reader: AuditLogReader
  const results: { measurement: string; ms: string }[] = []

  beforeAll(() => {
    db = Database.open(join(tempDir(), 'audit-perf.db'))
    migrate(db, migrations, {
      appVersion: 'perf',
      backupDir: null,
      clock: fixedClock,
      logger: createTestLogger()
    })
    db.transaction(() => {
      db.exec(`
        INSERT INTO users (user_id, username, display_name, password_hash, role_id, created_at, updated_at)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20)
        SELECT i, 'user' || i, 'User ' || i, 'x', (SELECT role_id FROM roles WHERE role_code = 'cashier'), 0, 0 FROM n;

        INSERT INTO audit_logs (occurred_at, user_id, approved_by_user_id, action, entity_type, entity_id, details)
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${ENTRIES})
        SELECT ${fixedClock.now()} - (${ENTRIES} - i) * ${Math.floor((3 * 365 * DAY_MS) / ENTRIES)},
               1 + i % 20,
               CASE WHEN i % 97 = 0 THEN 1 + (i + 1) % 20 END,
               CASE i % 10 WHEN 0 THEN 'user.sign_out' WHEN 1 THEN 'access.denied'
                           WHEN 2 THEN 'user.updated' ELSE 'user.sign_in' END,
               'user', 1 + i % 20,
               '{"permission":"sale.void"}'
        FROM n;
      `)
    })
    reader = new AuditLogReader(db, fixedClock)
  }, 600_000)

  afterAll(() => {
    db?.close()
    console.table(results)
  })

  function measure(measurement: string, run: () => unknown): void {
    run() // warm the cache
    let worst = 0
    for (let i = 0; i < 20; i++) {
      const started = performance.now()
      run()
      worst = Math.max(worst, performance.now() - started)
    }
    results.push({ measurement, ms: worst.toFixed(2) })
    expect(worst).toBeLessThan(TARGET_MS)
  }

  it('loads the newest page, and a page far back', () => {
    measure('newest 50', () => reader.list({}))
    measure('50 entries, 250,000 back', () => reader.list({ before: 50_000 }))
  })

  it('filters by person, action, date and record', () => {
    measure('one person', () => reader.list({ person: 7 }))
    measure('one action (1 in 10)', () => reader.list({ action: 'access.denied' }))
    measure('one week, a year ago', () =>
      reader.list({ from: fixedClock.now() - 372 * DAY_MS, to: fixedClock.now() - 365 * DAY_MS })
    )
    measure('one user record', () => reader.list({ entity: { type: 'user', id: 3 } }))
    measure('a rare action', () => reader.list({ action: 'user.created' }))
  })

  it('lists the filter options', () => {
    measure('people and actions in the log', () => reader.filterOptions())
  })
})
