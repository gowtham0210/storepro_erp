import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Clock } from '../lib/clock'
import type { Logger } from '../logging/logger'
import { STOREPRO_APPLICATION_ID, type Database } from './database'

export interface Migration {
  version: number
  name: string
  sql: string
  /** Run with foreign key enforcement off (needed to rebuild tables). */
  foreignKeysOff?: boolean
}

export interface MigrateOptions {
  appVersion: string
  /** Where to write the pre-migration backup of an existing database; null disables it. */
  backupDir: string | null
  clock: Clock
  logger: Logger
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  applied: number[]
  backupPath: string | null
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly version: number | null = null,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'MigrationError'
  }
}

/** The database was written by a newer StorePro; this version must not touch it. */
export class DatabaseTooNewError extends MigrationError {
  constructor(
    readonly databaseVersion: number,
    readonly supportedVersion: number
  ) {
    super(
      `Database schema version ${databaseVersion} is newer than this app supports (${supportedVersion})`
    )
    this.name = 'DatabaseTooNewError'
  }
}

interface AppliedMigration {
  version: number
  name: string
  checksum: string
}

/** Line endings are normalised so a Windows (CRLF) checkout yields the same checksum. */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

/**
 * Bring the schema up to date. All pending migrations run in one transaction,
 * so a failure leaves the database exactly as it was. An existing database is
 * also copied to `backupDir` first.
 */
export function migrate(
  db: Database,
  migrations: readonly Migration[],
  options: MigrateOptions
): MigrationResult {
  validateMigrationList(migrations)
  const latest = migrations.at(-1)?.version ?? 0

  assertStoreProDatabase(db)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  INTEGER NOT NULL,
    app_version TEXT NOT NULL
  ) STRICT`)

  const applied = db.all<AppliedMigration>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
  )
  const current = applied.at(-1)?.version ?? 0
  if (current > latest) throw new DatabaseTooNewError(current, latest)
  verifyAppliedMigrations(applied, migrations)

  const pending = migrations.filter((migration) => migration.version > current)
  if (pending.length === 0) {
    return { fromVersion: current, toVersion: current, applied: [], backupPath: null }
  }

  const backupPath =
    current > 0 && options.backupDir !== null
      ? backupBeforeMigration(db, options.backupDir, current, latest, options.clock)
      : null
  if (backupPath) options.logger.info('Backed up database before migrating', { backupPath })

  const foreignKeysOff = pending.some((migration) => migration.foreignKeysOff)
  if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const migration of pending) {
        try {
          db.exec(migration.sql)
        } catch (error) {
          throw new MigrationError(
            `Migration ${migration.version} (${migration.name}) failed: ${String(error)}`,
            migration.version,
            { cause: error }
          )
        }
        db.run(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at, app_version)
           VALUES (?, ?, ?, ?, ?)`,
          [
            migration.version,
            migration.name,
            migrationChecksum(migration.sql),
            options.clock.now(),
            options.appVersion
          ]
        )
      }
      const violations = db.all('PRAGMA foreign_key_check')
      if (violations.length > 0) {
        throw new MigrationError(`Migrations left ${violations.length} foreign key violation(s)`)
      }
    })
  } finally {
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON')
  }
  const appliedVersions = pending.map((migration) => migration.version)
  options.logger.info('Database migrated', {
    fromVersion: current,
    toVersion: latest,
    applied: appliedVersions
  })
  return { fromVersion: current, toVersion: latest, applied: appliedVersions, backupPath }
}

function validateMigrationList(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `Migrations must be numbered 1, 2, 3, ... without gaps; found ${migration.version} at position ${index + 1}`
      )
    }
  })
}

/**
 * Refuse files that belong to something else. A brand-new, empty file is
 * claimed by writing the application id before anything else, so a crash at
 * any later point still leaves a file recognisable as StorePro's.
 */
function assertStoreProDatabase(db: Database): void {
  const applicationId = db.pragma<number>('application_id')
  if (applicationId === STOREPRO_APPLICATION_ID) return
  const objectCount = db.get<{ n: number }>('SELECT count(*) AS n FROM sqlite_schema')?.n ?? 0
  if (applicationId !== 0 || objectCount > 0) {
    throw new MigrationError('This file is not a StorePro database')
  }
  db.exec(`PRAGMA application_id = ${STOREPRO_APPLICATION_ID}`)
}

function verifyAppliedMigrations(
  applied: readonly AppliedMigration[],
  migrations: readonly Migration[]
): void {
  applied.forEach((row, index) => {
    const known = migrations[index]
    if (row.version !== index + 1 || !known) {
      throw new MigrationError(`Recorded migrations are not contiguous at version ${row.version}`)
    }
    if (row.name !== known.name || row.checksum !== migrationChecksum(known.sql)) {
      throw new MigrationError(
        `Migration ${row.version} (${row.name}) was changed after it was applied`,
        row.version
      )
    }
  })
}

function backupBeforeMigration(
  db: Database,
  backupDir: string,
  fromVersion: number,
  toVersion: number,
  clock: Clock
): string {
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date(clock.now()).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
  const path = join(backupDir, `pre-migration-v${fromVersion}-to-v${toVersion}-${stamp}.db`)
  db.backupTo(path)
  return path
}
