import type { SQLInputValue } from 'node:sqlite'
import type { Clock } from '../lib/clock'
import type { Database } from './database'

/** A row to write: column name → value. Keys are checked against IDENTIFIER. */
export type Row = Record<string, SQLInputValue>

const IDENTIFIER = /^[a-z][a-z0-9_]*$/

export class NotFoundError extends Error {
  constructor(
    readonly table: string,
    readonly id: number
  ) {
    super(`${table} ${id} not found`)
    this.name = 'NotFoundError'
  }
}

/**
 * Base class for repositories. Conventions (see docs/data-model.md):
 *
 *  - One repository per aggregate (e.g. a sale with its items, taxes and
 *    payments). It is the only code that writes those tables.
 *  - Repositories map snake_case rows to camelCase domain types explicitly;
 *    rows never leak past the repository.
 *  - Integer surrogate keys: `<entity>_id INTEGER PRIMARY KEY`.
 *  - Timestamps come from the injected Clock (`created_at`, `updated_at`).
 *  - Reference data is archived (`archived_at`), never deleted. Transaction
 *    tables are append-only and enforce it with triggers.
 *  - Multi-row writes go through `db.transaction()`.
 */
export abstract class Repository {
  constructor(
    protected readonly db: Database,
    protected readonly clock: Clock
  ) {}

  protected now(): number {
    return this.clock.now()
  }

  /** INSERT a row and return its new id. */
  protected insert(table: string, row: Row): number {
    const columns = Object.keys(row)
    assertIdentifiers(table, ...columns)
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `$${c}`).join(', ')})`
    return this.db.run(sql, row).lastInsertRowid
  }

  /** INSERT a mutable reference row, stamping created_at/updated_at. */
  protected insertWithTimestamps(table: string, row: Row): number {
    const now = this.now()
    return this.insert(table, { ...row, created_at: now, updated_at: now })
  }

  /** UPDATE columns of one row, stamping updated_at. Throws if the row does not exist. */
  protected update(table: string, idColumn: string, id: number, changes: Row): void {
    const values: Row = { ...changes, updated_at: this.now() }
    const columns = Object.keys(values)
    assertIdentifiers(table, idColumn, ...columns)
    const sql = `UPDATE ${table} SET ${columns.map((c) => `${c} = $${c}`).join(', ')} WHERE ${idColumn} = $__id`
    if (this.db.run(sql, { ...values, __id: id }).changes === 0) throw new NotFoundError(table, id)
  }

  /** Archive (soft-delete) a reference row. Archiving twice keeps the first timestamp. */
  protected archive(table: string, idColumn: string, id: number): void {
    assertIdentifiers(table, idColumn)
    const now = this.now()
    const result = this.db.run(
      `UPDATE ${table} SET archived_at = coalesce(archived_at, $now), updated_at = $now WHERE ${idColumn} = $id`,
      { now, id }
    )
    if (result.changes === 0) throw new NotFoundError(table, id)
  }
}

function assertIdentifiers(...names: string[]): void {
  for (const name of names) {
    if (!IDENTIFIER.test(name) && name !== '__id')
      throw new Error(`Invalid SQL identifier: ${name}`)
  }
}
