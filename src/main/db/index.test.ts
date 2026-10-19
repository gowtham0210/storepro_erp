import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestLogger, useTempDir } from '../test/helpers'
import { Database } from './database'
import { openStoreDatabase } from '.'
import { migrations } from './migrations'
import { fixedClock } from './test/testDb'

describe('openStoreDatabase', () => {
  const tempDir = useTempDir()

  function open(dir: string, verifyIntegrity = false) {
    return openStoreDatabase({
      path: join(dir, 'data', 'storepro.db'),
      backupDir: join(dir, 'backups'),
      appVersion: 'test',
      verifyIntegrity,
      clock: fixedClock,
      logger: createTestLogger()
    })
  }

  it('creates and migrates a new database, then reopens it without changes', () => {
    const dir = tempDir()
    const first = open(dir)
    expect(first.migration.applied).toEqual(migrations.map((m) => m.version))
    first.db.close()

    const second = open(dir, true)
    expect(second.migration.applied).toEqual([])
    expect(second.integrity?.ok).toBe(true)
    second.db.close()
  })

  it('refuses to open a file that belongs to something else', () => {
    const dir = tempDir()
    const path = join(dir, 'data', 'storepro.db')
    open(dir).db.close()
    const raw = Database.open(path)
    raw.exec('PRAGMA application_id = 42')
    raw.close()
    expect(() => open(dir)).toThrow('not a StorePro database')
  })
})
