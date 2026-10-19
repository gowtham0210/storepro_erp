import {
  DatabaseSync,
  type SQLInputValue,
  type StatementResultingChanges,
  type StatementSync
} from 'node:sqlite'

/** Named (`$name` / `:name` / `@name`) or positional (`?`) statement parameters. */
export type SqlParams = Record<string, SQLInputValue> | readonly SQLInputValue[]

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/** Marks StorePro databases in the SQLite file header ('SPRO'). */
export const STOREPRO_APPLICATION_ID = 0x5350524f

export interface OpenOptions {
  readOnly?: boolean
}

/**
 * Thin synchronous wrapper around the SQLite driver.
 *
 * It owns the connection settings every StorePro connection must have, caches
 * prepared statements, and provides nestable transactions. Code outside
 * src/main/db talks to SQLite only through this class, so the driver can be
 * replaced (e.g. by better-sqlite3) without touching repositories.
 */
export class Database {
  private readonly statements = new Map<string, StatementSync>()
  private transactionDepth = 0
  private closed = false

  private constructor(
    private readonly connection: DatabaseSync,
    readonly path: string
  ) {}

  static open(path: string, options: OpenOptions = {}): Database {
    const connection = new DatabaseSync(path, { readOnly: options.readOnly ?? false })
    const db = new Database(connection, path)
    try {
      db.configure(options.readOnly ?? false)
    } catch (error) {
      connection.close()
      throw error
    }
    return db
  }

  private configure(readOnly: boolean): void {
    // Wait instead of failing immediately if another connection (e.g. a backup) holds a lock.
    this.connection.exec('PRAGMA busy_timeout = 5000')
    // Not enabled by default in SQLite, and per connection.
    this.connection.exec('PRAGMA foreign_keys = ON')
    // Schema objects (views, triggers, CHECKs) may only use side-effect-free functions.
    this.connection.exec('PRAGMA trusted_schema = OFF')
    if (!readOnly && this.path !== ':memory:') {
      this.connection.exec('PRAGMA journal_mode = WAL')
    }
    // FULL: a completed sale survives power loss once checkout returns (FR-037).
    this.connection.exec('PRAGMA synchronous = FULL')
    // Blocks writes to sqlite_schema and other ways of corrupting the file via SQL.
    const defensive = (this.connection as { enableDefensive?: (on: boolean) => void })
      .enableDefensive
    defensive?.call(this.connection, true)
  }

  get inTransaction(): boolean {
    return this.transactionDepth > 0
  }

  exec(sql: string): void {
    this.assertOpen()
    this.connection.exec(sql)
  }

  run(sql: string, params?: SqlParams): RunResult {
    const result = bind(this.statement(sql), params, 'run') as StatementResultingChanges
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get<T>(sql: string, params?: SqlParams): T | undefined {
    return bind(this.statement(sql), params, 'get') as T | undefined
  }

  all<T>(sql: string, params?: SqlParams): T[] {
    return bind(this.statement(sql), params, 'all') as T[]
  }

  /** Value of a single-value PRAGMA, e.g. `pragma('journal_mode')`. */
  pragma<T = unknown>(name: string): T {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`Invalid pragma name: ${name}`)
    const row = this.get<Record<string, T>>(`PRAGMA ${name}`)
    return (row === undefined ? undefined : Object.values(row)[0]) as T
  }

  /**
   * Run `fn` atomically. The outermost call opens a `BEGIN IMMEDIATE`
   * transaction (taking the write lock up front, so it cannot fail half-way
   * with SQLITE_BUSY); nested calls use savepoints, so an inner failure can be
   * caught and handled without losing the outer work.
   *
   * `fn` must be synchronous: an `await` inside would let other work run while
   * the transaction is open.
   */
  transaction<T>(fn: () => T): T {
    this.assertOpen()
    const depth = this.transactionDepth
    const savepoint = `sp_${depth}`
    this.connection.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    this.transactionDepth++
    try {
      const result = fn()
      if (isPromiseLike(result)) {
        throw new Error('Database.transaction() callbacks must be synchronous')
      }
      this.connection.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
      return result
    } catch (error) {
      try {
        if (depth === 0) {
          this.connection.exec('ROLLBACK')
        } else {
          this.connection.exec(`ROLLBACK TO ${savepoint}`)
          this.connection.exec(`RELEASE ${savepoint}`)
        }
      } catch {
        // Some errors (e.g. disk full) make SQLite roll back on its own; the
        // original error is the one worth reporting.
      }
      throw error
    } finally {
      this.transactionDepth--
    }
  }

  /**
   * Write a consistent, compacted copy of the database to `targetPath`
   * (which must not exist). Safe while the app is running.
   */
  backupTo(targetPath: string): void {
    if (this.inTransaction) throw new Error('Cannot back up inside a transaction')
    this.run('VACUUM INTO ?', [targetPath])
  }

  /** Housekeeping before close: refresh query planner statistics and fold the WAL back. */
  optimize(): void {
    this.exec('PRAGMA optimize')
    if (this.path !== ':memory:') this.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    if (this.closed) return
    this.statements.clear()
    this.connection.close()
    this.closed = true
  }

  private statement(sql: string): StatementSync {
    this.assertOpen()
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.connection.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Database is closed')
  }
}

function bind(
  statement: StatementSync,
  params: SqlParams | undefined,
  method: 'run' | 'get' | 'all'
): unknown {
  if (params === undefined) return statement[method]()
  if (Array.isArray(params)) return statement[method](...params.map(toSqlValue))
  const named: Record<string, SQLInputValue> = {}
  for (const [key, value] of Object.entries(params as Record<string, SQLInputValue>)) {
    named[key] = toSqlValue(value)
  }
  return statement[method](named)
}

/**
 * The driver binds every JS number as REAL, so `? * ?` in SQL would be
 * floating-point arithmetic. Whole numbers are bound as INTEGER instead;
 * fractional numbers stay REAL and are rejected by the STRICT integer columns.
 */
function toSqlValue(value: SQLInputValue): SQLInputValue {
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}
