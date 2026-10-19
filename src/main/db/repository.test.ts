import { describe, expect, it } from 'vitest'
import type { Clock } from '../lib/clock'
import type { Database } from './database'
import { NotFoundError, Repository } from './repository'
import { useMigratedDb } from './test/testDb'

class CategoryRepository extends Repository {
  create(name: string): number {
    return this.insertWithTimestamps('categories', { name })
  }
  rename(id: number, name: string): void {
    this.update('categories', 'category_id', id, { name })
  }
  remove(id: number): void {
    this.archive('categories', 'category_id', id)
  }
  find(id: number) {
    return this.db.get<{
      name: string
      created_at: number
      updated_at: number
      archived_at: number | null
    }>('SELECT name, created_at, updated_at, archived_at FROM categories WHERE category_id = ?', [
      id
    ])
  }
  unsafe(table: string): void {
    this.insert(table, { name: 'x' })
  }
}

describe('Repository', () => {
  const getDb = useMigratedDb()

  function setup(): { repo: CategoryRepository; clock: { time: number } & Clock; db: Database } {
    const clock = { time: 1000, now: () => clock.time }
    const db = getDb()
    return { repo: new CategoryRepository(db, clock), clock, db }
  }

  it('stamps created_at and updated_at from the clock', () => {
    const { repo, clock } = setup()
    const id = repo.create('Staples')
    clock.time = 2000
    repo.rename(id, 'Groceries')
    expect(repo.find(id)).toEqual({
      name: 'Groceries',
      created_at: 1000,
      updated_at: 2000,
      archived_at: null
    })
  })

  it('archives instead of deleting, keeping the first archive time', () => {
    const { repo, clock } = setup()
    const id = repo.create('Staples')
    clock.time = 3000
    repo.remove(id)
    clock.time = 4000
    repo.remove(id)
    expect(repo.find(id)).toMatchObject({ archived_at: 3000, updated_at: 4000 })
  })

  it('throws NotFoundError for missing rows', () => {
    const { repo } = setup()
    expect(() => repo.rename(404, 'x')).toThrow(NotFoundError)
    expect(() => repo.remove(404)).toThrow(NotFoundError)
  })

  it('refuses identifiers that could inject SQL', () => {
    const { repo } = setup()
    expect(() => repo.unsafe('categories; DROP TABLE users')).toThrow('Invalid SQL identifier')
  })
})
