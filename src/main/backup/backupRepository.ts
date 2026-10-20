import type {
  BackupConfig,
  BackupRunStatus,
  BackupRunSummary,
  BackupTriggerKind
} from '@shared/ipc/contract'
import {
  backupConfigSchema,
  DEFAULT_RETENTION_COUNT,
  DEFAULT_SCHEDULE_INTERVAL_HOURS
} from '@shared/schemas/backup'
import { Repository } from '../db/repository'

const BACKUP_CONFIG_KEY = 'backupsettings'

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  autoBackupEnabled: true,
  scheduleIntervalHours: DEFAULT_SCHEDULE_INTERVAL_HOURS,
  retentionCount: DEFAULT_RETENTION_COUNT,
  destinationDir: null
}

interface BackupRunRow {
  backup_run_id: number
  trigger_kind: BackupTriggerKind
  status: BackupRunStatus
  started_at: number
  finished_at: number
  created_by_name: string | null
  file_path: string | null
  file_size_bytes: number | null
  sha256_checksum: string | null
  app_version: string
  schema_version: number
  error_message: string | null
}

function toSummary(row: BackupRunRow): BackupRunSummary {
  return {
    backupRunId: row.backup_run_id,
    triggerKind: row.trigger_kind,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdByName: row.created_by_name,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    sha256Checksum: row.sha256_checksum,
    appVersion: row.app_version,
    schemaVersion: row.schema_version,
    errorMessage: row.error_message
  }
}

const SELECT_RUN = `
  SELECT r.backup_run_id, r.trigger_kind, r.status, r.started_at, r.finished_at,
         u.display_name AS created_by_name, r.file_path, r.file_size_bytes,
         r.sha256_checksum, r.app_version, r.schema_version, r.error_message
  FROM backup_runs r
  LEFT JOIN users u ON u.user_id = r.created_by_user_id`

export interface RecordBackupRunInput {
  triggerKind: BackupTriggerKind
  status: BackupRunStatus
  startedAt: number
  finishedAt: number
  createdByUserId: number | null
  filePath: string | null
  fileSizeBytes: number | null
  sha256Checksum: string | null
  appVersion: string
  schemaVersion: number
  errorMessage: string | null
}

/**
 * Backup configuration (in `app_settings`) and backup run history (`backup_runs`)
 * for M20-01 to M20-06.
 */
export class BackupRepository extends Repository {
  getConfig(): BackupConfig {
    const row = this.db.get<{ setting_value: string }>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [BACKUP_CONFIG_KEY]
    )
    if (!row) return { ...DEFAULT_BACKUP_CONFIG }
    try {
      const parsed = backupConfigSchema.safeParse(JSON.parse(row.setting_value))
      return parsed.success ? parsed.data : { ...DEFAULT_BACKUP_CONFIG }
    } catch {
      return { ...DEFAULT_BACKUP_CONFIG }
    }
  }

  setConfig(config: BackupConfig): BackupConfig {
    const clean = backupConfigSchema.parse(config)
    const now = this.now()
    this.db.run(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`,
      [BACKUP_CONFIG_KEY, JSON.stringify(clean), now]
    )
    return clean
  }

  recordRun(input: RecordBackupRunInput): BackupRunSummary {
    const id = this.insert('backup_runs', {
      trigger_kind: input.triggerKind,
      status: input.status,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_by_user_id: input.createdByUserId,
      file_path: input.filePath,
      file_size_bytes: input.fileSizeBytes,
      sha256_checksum: input.sha256Checksum,
      app_version: input.appVersion,
      schema_version: input.schemaVersion,
      error_message: input.errorMessage
    })
    const row = this.db.get<BackupRunRow>(`${SELECT_RUN} WHERE r.backup_run_id = ?`, [id])
    if (!row) throw new Error('Backup run record not found after insert')
    return toSummary(row)
  }

  listRecentRuns(limit = 20): BackupRunSummary[] {
    return this.db
      .all<BackupRunRow>(`${SELECT_RUN} ORDER BY r.started_at DESC, r.backup_run_id DESC LIMIT ?`, [
        limit
      ])
      .map(toSummary)
  }

  lastSucceededRun(): BackupRunSummary | null {
    const row = this.db.get<BackupRunRow>(
      `${SELECT_RUN} WHERE r.status = 'succeeded' ORDER BY r.finished_at DESC, r.backup_run_id DESC LIMIT 1`
    )
    return row ? toSummary(row) : null
  }

  lastFailedRun(): BackupRunSummary | null {
    const row = this.db.get<BackupRunRow>(
      `${SELECT_RUN} WHERE r.status = 'failed' ORDER BY r.finished_at DESC, r.backup_run_id DESC LIMIT 1`
    )
    return row ? toSummary(row) : null
  }

  currentSchemaVersion(): number {
    return (
      this.db.get<{ v: number }>('SELECT coalesce(max(version), 0) AS v FROM schema_migrations')
        ?.v ?? 0
    )
  }
}
