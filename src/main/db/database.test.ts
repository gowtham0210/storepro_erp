import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDir } from '../test/helpers'
import { Database } from './database'

describe('Database', () => {
  const tempDir = useTempDir()

  function openFileDb(): Database {
    const db = Database.open(join(tempDir(), 'test.db'))
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
    return db
  }

  it('applies the required connection settings', () => {
    const db = openFileDb()
    expect(db.pragma('foreign_keys')).toBe(1)
    expect(db.pragma('journal_mode')).toBe('wal')
    expect(db.pragma('synchronous')).toBe(2) // FULL
    expect(db.pragma('trusted_schema')).toBe(0)
    expect(db.pragma('busy_timeout')).toBe(5000)
    db.close()
  })

  it('commits a transaction and returns its result', () => {
    const db = openFileDb()
    const id = db.transaction(() => db.run("INSERT INTO t (v) VALUES ('a')").lastInsertRowid)
    expect(db.get('SELECT v FROM t WHERE id = ?', [id])).toEqual({ v: 'a' })
    expect(db.inTransaction).toBe(false)
    db.close()
  })

  it('rolls back everything when the transaction throws', () => {
    const db = openFileDb()
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t (v) VALUES ('a')")
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.get('SELECT count(*) AS n FROM t')).toEqual({ n: 0 })
    db.close()
  })

  it('rolls back only the inner savepoint when a nested transaction fails', () => {
    const db = openFileDb()
    db.transaction(() => {
      db.run("INSERT INTO t (v) VALUES ('outer')")
      expect(() =>
        db.transaction(() => {
          db.run("INSERT INTO t (v) VALUES ('inner')")
          throw new Error('inner failed')
        })
      ).toThrow('inner failed')
    })
    expect(db.all('SELECT v FROM t')).toEqual([{ v: 'outer' }])
    db.close()
  })

  it('rejects asynchronous transaction callbacks and rolls them back', () => {
    const db = openFileDb()
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t (v) VALUES ('a')")
        return Promise.resolve()
      })
    ).toThrow('must be synchronous')
    expect(db.get('SELECT count(*) AS n FROM t')).toEqual({ n: 0 })
    db.close()
  })

  it('supports named and positional parameters', () => {
    const db = openFileDb()
    db.run('INSERT INTO t (v) VALUES ($v)', { v: 'named' })
    db.run('INSERT INTO t (v) VALUES (?)', ['positional'])
    expect(db.all<{ v: string }>('SELECT v FROM t ORDER BY id').map((r) => r.v)).toEqual([
      'named',
      'positional'
    ])
    db.close()
  })

  it('binds whole numbers as SQL integers, so SQL arithmetic stays exact', () => {
    const db = openFileDb()
    expect(
      db.get('SELECT typeof(?) AS t, (? * ? + 500) / 1000 AS v', [5, 1_034_836, 1_000])
    ).toEqual({
      t: 'integer',
      v: 1_034_836
    })
    expect(db.get('SELECT typeof($n) AS t', { n: 7 })).toEqual({ t: 'integer' })
    expect(db.get('SELECT typeof(?) AS t', [2.5])).toEqual({ t: 'real' })
    db.close()
  })

  it('writes a consistent backup copy', () => {
    const db = openFileDb()
    db.run("INSERT INTO t (v) VALUES ('kept')")
    const target = join(tempDir(), 'backup.db')
    db.backupTo(target)
    db.close()
    expect(existsSync(target)).toBe(true)
    const copy = Database.open(target, { readOnly: true })
    expect(copy.all('SELECT v FROM t')).toEqual([{ v: 'kept' }])
    copy.close()
  })

  it('refuses to back up inside a transaction and to run after close', () => {
    const db = openFileDb()
    db.transaction(() => {
      expect(() => db.backupTo(join(tempDir(), 'x.db'))).toThrow('inside a transaction')
    })
    db.close()
    expect(() => db.get('SELECT 1')).toThrow('closed')
  })
})
