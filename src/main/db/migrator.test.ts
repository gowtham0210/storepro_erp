import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestLogger, useTempDir } from '../test/helpers'
import { Database, STOREPRO_APPLICATION_ID } from './database'
import {
  DatabaseTooNewError,
  migrate,
  MigrationError,
  migrationChecksum,
  type Migration
} from './migrator'
import { migrations as realMigrations } from './migrations'
import { fixedClock } from './test/testDb'

const v1: Migration = {
  version: 1,
  name: 'create_a',
  sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;'
}
const v2: Migration = {
  version: 2,
  name: 'create_b',
  sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY) STRICT;'
}
const broken: Migration = {
  version: 3,
  name: 'broken',
  sql: 'CREATE TABLE c (id INTEGER PRIMARY KEY); SELEC oops;'
}

function options(backupDir: string | null = null) {
  return { appVersion: '1.2.3', backupDir, clock: fixedClock, logger: createTestLogger() }
}

function tables(db: Database): string[] {
  return db
    .all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .map((row) => row.name)
}

describe('migrate', () => {
  const tempDir = useTempDir()

  it('applies all migrations to a new database and records them', () => {
    const db = Database.open(':memory:')
    const result = migrate(db, [v1, v2], options())
    expect(result).toEqual({ fromVersion: 0, toVersion: 2, applied: [1, 2], backupPath: null })
    expect(db.all('SELECT version, name, app_version FROM schema_migrations')).toEqual([
      { version: 1, name: 'create_a', app_version: '1.2.3' },
      { version: 2, name: 'create_b', app_version: '1.2.3' }
    ])
    expect(db.pragma('application_id')).toBe(STOREPRO_APPLICATION_ID)
    db.close()
  })

  it('is a no-op when the schema is current', () => {
    const db = Database.open(':memory:')
    migrate(db, [v1], options())
    expect(migrate(db, [v1], options()).applied).toEqual([])
    db.close()
  })

  it('applies only the pending migrations, after backing up the existing database', () => {
    const dir = tempDir()
    const db = Database.open(join(dir, 'store.db'))
    migrate(db, [v1], options(join(dir, 'backups')))
    expect(readdirSync(dir)).not.toContain('backups') // nothing to back up on a new database

    const result = migrate(db, [v1, v2], options(join(dir, 'backups')))
    expect(result.applied).toEqual([2])
    expect(result.backupPath).toMatch(/pre-migration-v1-to-v2-\d{8}T\d{6}\.db$/)

    const backup = Database.open(result.backupPath ?? '', { readOnly: true })
    expect(tables(backup)).toEqual(['a', 'schema_migrations'])
    backup.close()
    db.close()
  })

  it('leaves the database untouched when any pending migration fails', () => {
    const db = Database.open(':memory:')
    migrate(db, [v1], options())
    expect(() => migrate(db, [v1, v2, broken], options())).toThrow(MigrationError)
    expect(tables(db)).toEqual(['a', 'schema_migrations'])
    expect(db.all('SELECT version FROM schema_migrations')).toEqual([{ version: 1 }])
    db.close()
  })

  it('reports which migration failed', () => {
    const db = Database.open(':memory:')
    try {
      migrate(db, [v1, v2, broken], options())
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError)
      expect((error as MigrationError).version).toBe(3)
    }
    db.close()
  })

  it('detects a migration edited after it was applied', () => {
    const db = Database.open(':memory:')
    migrate(db, [v1], options())
    const edited = { ...v1, sql: `${v1.sql} -- changed` }
    expect(() => migrate(db, [edited], options())).toThrow('was changed after it was applied')
    db.close()
  })

  it('treats CRLF and LF line endings as the same migration', () => {
    expect(migrationChecksum('a;\r\nb;\r\n')).toBe(migrationChecksum('a;\nb;\n'))
  })

  it('refuses a database written by a newer app version', () => {
    const db = Database.open(':memory:')
    migrate(db, [v1, v2], options())
    expect(() => migrate(db, [v1], options())).toThrow(DatabaseTooNewError)
    db.close()
  })

  it('refuses files that are not StorePro databases', () => {
    const dir = tempDir()
    const other = Database.open(join(dir, 'other.db'))
    other.exec('CREATE TABLE unrelated (x INTEGER)')
    expect(() => migrate(other, [v1], options())).toThrow('not a StorePro database')
    other.close()

    writeFileSync(
      join(dir, 'garbage.db'),
      'this is not sqlite at all, just text padding'.repeat(20)
    )
    let garbage: Database | undefined
    try {
      expect(() => {
        garbage = Database.open(join(dir, 'garbage.db'))
        migrate(garbage, [v1], options())
      }).toThrow()
    } finally {
      // An open handle would stop the temp folder being deleted on Windows.
      garbage?.close()
    }
  })

  it('rejects migration lists with gaps', () => {
    const db = Database.open(':memory:')
    expect(() => migrate(db, [v1, { ...v2, version: 3 }], options())).toThrow('without gaps')
    db.close()
  })

  it('rolls back a foreign-keys-off migration that leaves dangling references', () => {
    const db = Database.open(':memory:')
    const parent: Migration = {
      version: 1,
      name: 'parent_child',
      sql: `CREATE TABLE p (id INTEGER PRIMARY KEY) STRICT;
            CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER NOT NULL REFERENCES p (id)) STRICT;`
    }
    migrate(db, [parent], options())
    const dangling: Migration = {
      version: 2,
      name: 'dangling',
      foreignKeysOff: true,
      sql: 'INSERT INTO c (id, p_id) VALUES (1, 999);'
    }
    expect(() => migrate(db, [parent, dangling], options())).toThrow('foreign key violation')
    expect(db.get('SELECT count(*) AS n FROM c')).toEqual({ n: 0 })
    expect(db.pragma('foreign_keys')).toBe(1)
    db.close()
  })

  it('applies the real StorePro migrations cleanly, twice', () => {
    const dir = tempDir()
    const db = Database.open(join(dir, 'store.db'))
    expect(migrate(db, realMigrations, options(join(dir, 'backups'))).applied.length).toBe(
      realMigrations.length
    )
    expect(migrate(db, realMigrations, options(join(dir, 'backups'))).applied).toEqual([])
    db.close()
  })
})
