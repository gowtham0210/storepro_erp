import { describe, expect, it } from 'vitest'
import { Database } from '../database'
import { migrations } from '../migrations'
import { useMigratedDb, useMigratedFileDb } from './testDb'

describe('test database harness', () => {
  const memory = useMigratedDb()
  const file = useMigratedFileDb()

  it('gives a migrated in-memory database', () => {
    expect(memory().get('SELECT count(*) AS n FROM schema_migrations')).toEqual({
      n: migrations.length
    })
  })

  it('gives a migrated file database with production settings that can be reopened', () => {
    const db = file.db()
    expect(db.pragma('journal_mode')).toBe('wal')
    db.run("INSERT INTO categories (name, created_at, updated_at) VALUES ('Staples', 0, 0)")
    const second = Database.open(file.path())
    expect(second.get('SELECT name FROM categories')).toEqual({ name: 'Staples' })
    second.close()
  })
})
