import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  BackupConfig,
  BackupMetadata,
  BackupRestoreInput,
  BackupRestoreResult,
  BackupRunSummary,
  BackupStatus,
  BackupTriggerKind,
  BackupValidationResult
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { backupConfigSchema } from '@shared/schemas/backup'
import { AuditLog, changesBetween } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { Database, STOREPRO_APPLICATION_ID } from '../db/database'
import { checkIntegrity } from '../db/integrity'
import { DatabaseTooNewError, migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import type { Clock } from '../lib/clock'
import type { Logger } from '../logging/logger'
import type { StoreRepository } from '../store/storeRepository'
import type { BackupRepository } from './backupRepository'

export interface BackupDialogAdapter {
  pickFolder(defaultPath: string): Promise<string | null>
  pickBackupFile(defaultPath: string): Promise<string | null>
  relaunchApp(): void
}

export interface BackupServiceDeps {
  /** Active database connection, or a getter so restore can swap it in tests. */
  db: Database | (() => Database)
  /** Replaces the active database connection when restoring in-process. */
  onDatabaseReplaced?: ((newDb: Database) => void) | undefined
  backups: BackupRepository
  store: StoreRepository
  audit: AuditLog
  clock: Clock
  logger: Logger
  defaultBackupDir: string
  appVersion: string
  adapter?: BackupDialogAdapter | undefined
}

const METADATA_SUFFIX = '.meta.json'
const AUTO_BACKUP_CHECK_MS = 60_000

export function computeFileSha256(filePath: string): string {
  const bytes = readFileSync(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

export function metadataPathFor(backupFilePath: string): string {
  return `${backupFilePath}${METADATA_SUFFIX}`
}

function formatStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
}

/**
 * M20-01 to M20-07: Backup and restore service.
 *
 *  - Manual backup (`VACUUM INTO`) to a chosen folder or the default backups folder (M20-01).
 *  - Backup file format with `.meta.json` sidecar holding app version, schema version,
 *    store name, size, and SHA-256 checksum (M20-02).
 *  - Scheduled automatic backups with retention of the last N backups (default 30, M20-03).
 *  - Restore: validates checksum, application_id, schema version, and `checkIntegrity('full')`,
 *    keeps a pre-restore safety copy of the active database, migrates older-schema backups
 *    forward to the current schema (M20-04, M20-05), records audit entry, and schedules relaunch.
 *  - Status & failure alerts: tracks last successful backup and surfaces any newer failure (M20-06).
 */
export class BackupService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: BackupServiceDeps) {}

  private activeDb(): Database {
    return typeof this.deps.db === 'function' ? this.deps.db() : this.deps.db
  }

  getStatus(actor: Actor): BackupStatus {
    assertCan(actor, 'settings.view')
    return this.buildStatus()
  }

  setConfig(actor: Actor, input: BackupConfig): BackupStatus {
    assertCan(actor, 'settings.edit')
    const clean = backupConfigSchema.parse(input)
    if (clean.destinationDir !== null) {
      try {
        mkdirSync(clean.destinationDir, { recursive: true })
      } catch (error) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Cannot use backup folder "${clean.destinationDir}": ${error instanceof Error ? error.message : String(error)}`,
          { fieldErrors: { destinationDir: 'Choose a writable folder' } }
        )
      }
    }

    const db = this.activeDb()
    db.transaction(() => {
      const before = this.deps.backups.getConfig()
      const changes = changesBetween(this.readableConfig(before), this.readableConfig(clean))
      this.deps.backups.setConfig(clean)
      if (changes) {
        this.deps.audit.change({
          action: 'backup.settings_updated',
          actor,
          details: { changes }
        })
      }
    })
    return this.buildStatus()
  }

  async pickFolder(actor: Actor): Promise<string | null> {
    assertCan(actor, 'backup.create')
    if (!this.deps.adapter) return null
    const config = this.deps.backups.getConfig()
    return this.deps.adapter.pickFolder(config.destinationDir ?? this.deps.defaultBackupDir)
  }

  async pickBackupFile(actor: Actor): Promise<string | null> {
    assertCan(actor, 'backup.restore')
    if (!this.deps.adapter) return null
    const config = this.deps.backups.getConfig()
    return this.deps.adapter.pickBackupFile(config.destinationDir ?? this.deps.defaultBackupDir)
  }

  /**
   * M20-01 & M20-02: Create a consistent online SQLite backup (`VACUUM INTO`)
   * with a `.meta.json` sidecar containing app version, schema version, and
   * SHA-256 checksum. If the backup fails, records the failed attempt in
   * `backup_runs` so `getStatus` surfaces a failure alert (M20-06).
   */
  createBackup(
    actor: Actor,
    input: { destinationDir?: string | null | undefined } = {}
  ): BackupRunSummary {
    assertCan(actor, 'backup.create')
    return this.runBackup({
      triggerKind: 'manual',
      actor,
      destinationDir: input.destinationDir ?? null,
      enforceRetention: false
    })
  }

  /**
   * M20-03: Runs a scheduled backup if automatic backups are enabled and the
   * configured interval has elapsed since the last backup attempt.
   */
  runScheduledBackupIfDue(): BackupRunSummary | null {
    const config = this.deps.backups.getConfig()
    if (!config.autoBackupEnabled) return null

    const now = this.deps.clock.now()
    const intervalMs = config.scheduleIntervalHours * 3_600_000
    const recent = this.deps.backups.listRecentRuns(1)[0] ?? null
    if (recent && now - recent.finishedAt < intervalMs) {
      return null
    }

    try {
      return this.runBackup({
        triggerKind: 'scheduled',
        actor: null,
        destinationDir: config.destinationDir,
        enforceRetention: true
      })
    } catch (error) {
      this.deps.logger.error('Scheduled backup failed', { error })
      return null
    }
  }

  startScheduler(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      try {
        this.runScheduledBackupIfDue()
      } catch (error) {
        this.deps.logger.error('Backup scheduler tick error', { error })
      }
    }, AUTO_BACKUP_CHECK_MS)
  }

  stopScheduler(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * M20-04: Inspects and validates a candidate backup file before restoring.
   * Checks file existence, `.meta.json` SHA-256 checksum (if present), SQLite
   * `application_id`, `schema_migrations`, and full database integrity.
   */
  validateBackup(actor: Actor, { filePath }: { filePath: string }): BackupValidationResult {
    assertCan(actor, 'backup.restore')
    return this.inspectBackupFile(filePath)
  }

  /**
   * M20-04 & M20-05: Restores the store database from a validated backup file.
   *
   *  1. Validates the backup file (checksum, StorePro header, schema version,
   *     and full integrity check).
   *  2. Saves a safety copy of the active database (`pre-restore-...db` + `.meta.json`)
   *     into `defaultBackupDir` so the current store is never lost.
   *  3. Stages a copy of the backup, runs pending migrations if the backup is
   *     from an older schema version (M20-05), and runs a post-migration integrity check.
   *  4. Closes the active database, atomically replaces the store database file
   *     with the validated & migrated backup, re-opens the database, records
   *     `backup.restored` in the audit log, and triggers app relaunch if requested.
   */
  restoreBackup(actor: Actor, input: BackupRestoreInput): BackupRestoreResult {
    assertCan(actor, 'backup.restore')
    const resolvedSource = resolve(input.filePath.trim())
    const activeDb = this.activeDb()
    const activeDbPath = activeDb.path
    if (activeDbPath === ':memory:') {
      throw new AppError('CONFLICT', 'Cannot restore into an in-memory database.')
    }
    if (resolve(activeDbPath) === resolvedSource) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Choose a backup file, not the active store database file.'
      )
    }

    const validation = this.inspectBackupFile(resolvedSource)
    if (!validation.valid) {
      throw new AppError(
        'VALIDATION_FAILED',
        validation.errorMessage ?? 'The selected file is not a valid StorePro backup.'
      )
    }

    // 1. Create a safety backup of the current database before touching anything.
    const safetyRun = this.runBackup({
      triggerKind: 'pre_restore',
      actor,
      destinationDir: this.deps.defaultBackupDir,
      enforceRetention: false
    })
    const safetyCopyPath = safetyRun.filePath ?? ''

    // 2. Stage the candidate backup next to the active database and migrate if needed (M20-05).
    const dataDir = dirname(activeDbPath)
    mkdirSync(dataDir, { recursive: true })
    const stagedPath = join(dataDir, `restore-staging-${this.deps.clock.now()}.db`)
    let appliedMigrations: number[] = []
    let finalSchemaVersion = validation.schemaVersion

    try {
      copyFileSync(resolvedSource, stagedPath)
      const stagedDb = Database.open(stagedPath)
      try {
        const migResult = migrate(stagedDb, migrations, {
          appVersion: this.deps.appVersion,
          backupDir: null,
          clock: this.deps.clock,
          logger: this.deps.logger.child('restore-migrate')
        })
        appliedMigrations = migResult.applied
        finalSchemaVersion = migResult.toVersion

        const postIntegrity = checkIntegrity(stagedDb, 'full')
        if (!postIntegrity.ok) {
          throw new AppError(
            'VALIDATION_FAILED',
            'The backup failed its integrity check after upgrading to the current version.'
          )
        }
        stagedDb.optimize()
      } finally {
        stagedDb.close()
      }

      // 3. Close the active database, swap the staged file into place, and reopen.
      activeDb.close()
      for (const suffix of ['', '-wal', '-shm']) {
        const target = `${activeDbPath}${suffix}`
        if (existsSync(target)) rmSync(target, { force: true })
      }
      copyFileSync(stagedPath, activeDbPath)
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        const temp = `${stagedPath}${suffix}`
        if (existsSync(temp)) rmSync(temp, { force: true })
      }
    }

    const reopenedDb = Database.open(activeDbPath)
    this.deps.onDatabaseReplaced?.(reopenedDb)

    // Record the safety backup run and the restore audit entry in the newly restored database
    // so the restored store has an immediate record of the restoration and where the safety copy is.
    reopenedDb.transaction(() => {
      // Ensure actor user_id exists in the restored database; otherwise record with userId: null
      // and include the actor's username/displayName in details.
      const actorExists =
        reopenedDb.get<{ user_id: number }>('SELECT user_id FROM users WHERE user_id = ?', [
          actor.userId
        ]) !== undefined

      reopenedDb.run(
        `INSERT INTO backup_runs (
           trigger_kind, status, started_at, finished_at, created_by_user_id,
           file_path, file_size_bytes, sha256_checksum, app_version, schema_version, error_message
         ) VALUES (?, 'succeeded', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          'pre_restore',
          safetyRun.startedAt,
          safetyRun.finishedAt,
          actorExists ? actor.userId : null,
          safetyCopyPath,
          safetyRun.fileSizeBytes,
          safetyRun.sha256Checksum,
          safetyRun.appVersion,
          safetyRun.schemaVersion
        ]
      )

      const details: Record<string, unknown> = {
        restoredFrom: basename(resolvedSource),
        safetyCopy: basename(safetyCopyPath),
        fromSchemaVersion: validation.schemaVersion,
        toSchemaVersion: finalSchemaVersion,
        ...(appliedMigrations.length > 0 ? { migrationsApplied: appliedMigrations } : {}),
        ...(actorExists ? {} : { restoredBy: `${actor.displayName} (${actor.username})` })
      }

      const restoredAudit = new AuditLog(reopenedDb, this.deps.clock)
      if (actorExists) {
        restoredAudit.change({
          action: 'backup.restored',
          actor,
          details
        })
      } else {
        restoredAudit.change({
          action: 'backup.restored',
          userId: null,
          details
        })
      }
    })

    const shouldRelaunch = input.relaunchAfterRestore ?? Boolean(this.deps.adapter)
    if (shouldRelaunch && this.deps.adapter) {
      this.deps.adapter.relaunchApp()
    }

    return {
      restoredFromPath: resolvedSource,
      safetyCopyPath,
      fromSchemaVersion: validation.schemaVersion,
      toSchemaVersion: finalSchemaVersion,
      migrationsApplied: appliedMigrations,
      relaunchScheduled: shouldRelaunch
    }
  }

  // --- internals ------------------------------------------------------------

  private runBackup(options: {
    triggerKind: BackupTriggerKind
    actor: Actor | null
    destinationDir: string | null
    enforceRetention: boolean
  }): BackupRunSummary {
    const db = this.activeDb()
    const config = this.deps.backups.getConfig()
    const targetDir = resolve(
      options.destinationDir ?? config.destinationDir ?? this.deps.defaultBackupDir
    )
    const startedAt = this.deps.clock.now()
    const schemaVersion = this.deps.backups.currentSchemaVersion()
    const stamp = formatStamp(startedAt)
    const prefix =
      options.triggerKind === 'pre_restore'
        ? 'pre-restore'
        : options.triggerKind === 'scheduled'
          ? 'auto-backup'
          : 'storepro-backup'
    let filePath = join(targetDir, `${prefix}-v${schemaVersion}-${stamp}.db`)
    let counter = 1
    while (existsSync(filePath)) {
      counter++
      filePath = join(targetDir, `${prefix}-v${schemaVersion}-${stamp}-${counter}.db`)
    }

    try {
      mkdirSync(targetDir, { recursive: true })
      db.backupTo(filePath)
      const stats = statSync(filePath)
      const sha256Checksum = computeFileSha256(filePath)
      const storeName = this.deps.store.get()?.name ?? null

      const metadata: BackupMetadata = {
        format: 'storepro-backup-v1',
        createdAt: startedAt,
        appVersion: this.deps.appVersion,
        schemaVersion,
        sha256Checksum,
        fileSizeBytes: stats.size,
        storeName,
        encryption: 'none',
        triggerKind: options.triggerKind
      }
      writeFileSync(metadataPathFor(filePath), JSON.stringify(metadata, null, 2), 'utf8')

      const finishedAt = this.deps.clock.now()
      const summary = db.transaction(() => {
        const recorded = this.deps.backups.recordRun({
          triggerKind: options.triggerKind,
          status: 'succeeded',
          startedAt,
          finishedAt,
          createdByUserId: options.actor?.userId ?? null,
          filePath,
          fileSizeBytes: stats.size,
          sha256Checksum,
          appVersion: this.deps.appVersion,
          schemaVersion,
          errorMessage: null
        })
        if (options.actor && options.triggerKind !== 'pre_restore') {
          this.deps.audit.change({
            action: 'backup.created',
            actor: options.actor,
            entity: { type: 'backup_run', id: recorded.backupRunId },
            details: {
              fileName: basename(filePath),
              trigger: options.triggerKind,
              schemaVersion,
              sha256: sha256Checksum.slice(0, 12)
            }
          })
        }
        return recorded
      })

      if (options.enforceRetention) {
        this.pruneOldAutoBackups(targetDir, config.retentionCount)
      }

      return summary
    } catch (error) {
      // Clean up partial backup files if any were created.
      if (existsSync(filePath)) {
        try {
          rmSync(filePath, { force: true })
        } catch {
          // ignore cleanup failure
        }
      }
      const metaPath = metadataPathFor(filePath)
      if (existsSync(metaPath)) {
        try {
          rmSync(metaPath, { force: true })
        } catch {
          // ignore cleanup failure
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const finishedAt = this.deps.clock.now()
      this.deps.backups.recordRun({
        triggerKind: options.triggerKind,
        status: 'failed',
        startedAt,
        finishedAt,
        createdByUserId: options.actor?.userId ?? null,
        filePath: null,
        fileSizeBytes: null,
        sha256Checksum: null,
        appVersion: this.deps.appVersion,
        schemaVersion: Math.max(1, schemaVersion),
        errorMessage
      })

      throw new AppError('CONFLICT', `Backup failed: ${errorMessage}`)
    }
  }

  private pruneOldAutoBackups(targetDir: string, retentionCount: number): void {
    try {
      const files = readdirSync(targetDir)
        .filter((name) => /^auto-backup-v\d+-\d{8}T\d{6}(?:-\d+)?\.db$/.test(name))
        .sort()
        .reverse()

      const toDelete = files.slice(retentionCount)
      for (const name of toDelete) {
        const fullPath = join(targetDir, name)
        rmSync(fullPath, { force: true })
        const meta = metadataPathFor(fullPath)
        if (existsSync(meta)) rmSync(meta, { force: true })
      }
    } catch (error) {
      this.deps.logger.warn('Failed to prune old scheduled backups', { error })
    }
  }

  private inspectBackupFile(rawPath: string): BackupValidationResult {
    const filePath = resolve(rawPath.trim())
    const currentSchemaVersion = migrations.at(-1)?.version ?? 1
    const invalidResult = (
      errorMessage: string,
      partial: Partial<BackupValidationResult> = {}
    ): BackupValidationResult => ({
      valid: false,
      filePath,
      fileSizeBytes: 0,
      sha256Checksum: '',
      checksumVerified: false,
      hasMetadataSidecar: false,
      appVersion: null,
      schemaVersion: 0,
      currentSchemaVersion,
      needsMigration: false,
      storeName: null,
      productCount: 0,
      saleCount: 0,
      errorMessage,
      ...partial
    })

    if (!existsSync(filePath)) {
      return invalidResult('The backup file does not exist.')
    }
    let stats
    try {
      stats = statSync(filePath)
    } catch {
      return invalidResult('Cannot read the backup file.')
    }
    if (!stats.isFile() || stats.size < 100) {
      return invalidResult('The selected path is not a valid SQLite database file.')
    }

    const sha256Checksum = computeFileSha256(filePath)
    const metaPath = metadataPathFor(filePath)
    let hasMetadataSidecar = false
    let checksumVerified = false
    let sidecarAppVersion: string | null = null

    if (existsSync(metaPath)) {
      hasMetadataSidecar = true
      try {
        const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<BackupMetadata>
        if (parsed.format !== 'storepro-backup-v1' || typeof parsed.sha256Checksum !== 'string') {
          return invalidResult('The backup metadata file (.meta.json) is malformed.', {
            fileSizeBytes: stats.size,
            sha256Checksum,
            hasMetadataSidecar: true
          })
        }
        if (parsed.sha256Checksum.toLowerCase() !== sha256Checksum.toLowerCase()) {
          return invalidResult(
            'Backup checksum mismatch: the backup file has been modified or corrupted since it was created.',
            {
              fileSizeBytes: stats.size,
              sha256Checksum,
              hasMetadataSidecar: true
            }
          )
        }
        checksumVerified = true
        sidecarAppVersion = typeof parsed.appVersion === 'string' ? parsed.appVersion : null
      } catch {
        return invalidResult('The backup metadata file (.meta.json) could not be read.', {
          fileSizeBytes: stats.size,
          sha256Checksum,
          hasMetadataSidecar: true
        })
      }
    }

    let candidate: Database | null = null
    try {
      candidate = Database.open(filePath, { readOnly: true })
      const appId = candidate.pragma<number>('application_id')
      if (appId !== STOREPRO_APPLICATION_ID) {
        return invalidResult('This file is not a StorePro database backup.', {
          fileSizeBytes: stats.size,
          sha256Checksum,
          hasMetadataSidecar,
          checksumVerified
        })
      }

      const applied = candidate.all<{ version: number; app_version: string }>(
        'SELECT version, app_version FROM schema_migrations ORDER BY version'
      )
      const schemaVersion = applied.at(-1)?.version ?? 0
      const dbAppVersion = applied.at(-1)?.app_version ?? null
      const appVersion = sidecarAppVersion ?? dbAppVersion

      if (schemaVersion <= 0) {
        return invalidResult('This database has no recorded StorePro schema version.', {
          fileSizeBytes: stats.size,
          sha256Checksum,
          hasMetadataSidecar,
          checksumVerified
        })
      }
      if (schemaVersion > currentSchemaVersion) {
        const tooNew = new DatabaseTooNewError(schemaVersion, currentSchemaVersion)
        return invalidResult(tooNew.message, {
          fileSizeBytes: stats.size,
          sha256Checksum,
          hasMetadataSidecar,
          checksumVerified,
          appVersion,
          schemaVersion
        })
      }

      // Inschema v1..v3 `sales` does not exist yet; run 'quick' on latest schema
      // and PRAGMA quick_check / foreign_key_check directly on older schemas before staging migrates them.
      if (schemaVersion === currentSchemaVersion) {
        const integrity = checkIntegrity(candidate, 'quick')
        if (!integrity.ok) {
          const detail =
            integrity.storageProblems[0] ??
            (integrity.foreignKeyViolations.length > 0
              ? `${integrity.foreignKeyViolations.length} foreign key violation(s)`
              : integrity.consistencyViolations.map((v) => `${v.check} (${v.count})`).join(', '))
          return invalidResult(`Backup file failed integrity verification: ${detail}`, {
            fileSizeBytes: stats.size,
            sha256Checksum,
            hasMetadataSidecar,
            checksumVerified,
            appVersion,
            schemaVersion
          })
        }
      } else {
        const quickProblems = candidate
          .all<Record<string, string>>('PRAGMA quick_check(100)')
          .map((row) => Object.values(row)[0] ?? '')
          .filter((msg) => msg !== 'ok')
        const fkViolations = candidate.all('PRAGMA foreign_key_check')
        if (quickProblems.length > 0 || fkViolations.length > 0) {
          const detail = quickProblems[0] ?? `${fkViolations.length} foreign key violation(s)`
          return invalidResult(`Backup file failed integrity verification: ${detail}`, {
            fileSizeBytes: stats.size,
            sha256Checksum,
            hasMetadataSidecar,
            checksumVerified,
            appVersion,
            schemaVersion
          })
        }
      }

      const hasBusinesses =
        candidate.get<{ n: number }>(
          "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'businesses'"
        )?.n ?? 0
      const hasProducts =
        candidate.get<{ n: number }>(
          "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'products'"
        )?.n ?? 0
      const hasSales =
        candidate.get<{ n: number }>(
          "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'sales'"
        )?.n ?? 0

      const storeName =
        hasBusinesses > 0
          ? (candidate.get<{ name: string }>('SELECT name FROM businesses WHERE business_id = 1')
              ?.name ?? null)
          : null
      const productCount =
        hasProducts > 0
          ? (candidate.get<{ n: number }>(
              'SELECT count(*) AS n FROM products WHERE archived_at IS NULL'
            )?.n ?? 0)
          : 0
      const saleCount =
        hasSales > 0
          ? (candidate.get<{ n: number }>('SELECT count(*) AS n FROM sales')?.n ?? 0)
          : 0

      return {
        valid: true,
        filePath,
        fileSizeBytes: stats.size,
        sha256Checksum,
        checksumVerified,
        hasMetadataSidecar,
        appVersion,
        schemaVersion,
        currentSchemaVersion,
        needsMigration: schemaVersion < currentSchemaVersion,
        storeName,
        productCount,
        saleCount,
        errorMessage: null
      }
    } catch (error) {
      return invalidResult(
        `Could not open backup database: ${error instanceof Error ? error.message : String(error)}`,
        {
          fileSizeBytes: stats.size,
          sha256Checksum,
          hasMetadataSidecar,
          checksumVerified
        }
      )
    } finally {
      candidate?.close()
    }
  }

  private buildStatus(): BackupStatus {
    const config = this.deps.backups.getConfig()
    const resolvedDestinationDir = resolve(config.destinationDir ?? this.deps.defaultBackupDir)
    const lastSuccessfulBackup = this.deps.backups.lastSucceededRun()
    const lastFailedBackup = this.deps.backups.lastFailedRun()
    const hasUnresolvedFailureAlert =
      lastFailedBackup !== null &&
      (lastSuccessfulBackup === null ||
        lastFailedBackup.finishedAt >= lastSuccessfulBackup.finishedAt)

    return {
      config,
      resolvedDestinationDir,
      lastSuccessfulBackup,
      lastFailedBackup,
      hasUnresolvedFailureAlert,
      recentRuns: this.deps.backups.listRecentRuns(10)
    }
  }

  private readableConfig(config: BackupConfig): Record<string, unknown> {
    return {
      autoBackup: config.autoBackupEnabled ? 'enabled' : 'disabled',
      interval: `${config.scheduleIntervalHours}h`,
      retention: `${config.retentionCount} backups`,
      destination: config.destinationDir ?? 'default folder'
    }
  }
}
