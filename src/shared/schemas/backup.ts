import { z } from 'zod'

export const DEFAULT_RETENTION_COUNT = 30
export const DEFAULT_SCHEDULE_INTERVAL_HOURS = 24
export const SCHEDULE_INTERVAL_HOURS = [1, 6, 12, 24, 168] as const

export const backupConfigSchema = z.object({
  autoBackupEnabled: z.boolean(),
  scheduleIntervalHours: z
    .number()
    .int('Backup interval must be a whole number of hours')
    .min(1, 'Backup interval must be at least 1 hour')
    .max(168, 'Backup interval can be at most 168 hours (7 days)'),
  retentionCount: z.coerce
    .number()
    .int('Retention count must be a whole number')
    .min(5, 'Keep at least 5 backups')
    .max(100, 'Keep at most 100 backups'),
  destinationDir: z
    .string()
    .trim()
    .max(500, 'Folder path must be 500 characters or fewer')
    .nullable()
    .transform((v) => (v === '' ? null : v))
})

export const createBackupSchema = z.object({
  destinationDir: z
    .string()
    .trim()
    .max(500, 'Folder path must be 500 characters or fewer')
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v))
})

export const validateBackupSchema = z.object({
  filePath: z
    .string()
    .trim()
    .min(1, 'Select a backup file')
    .max(1000, 'File path is too long')
})

export const restoreBackupSchema = z.object({
  filePath: z
    .string()
    .trim()
    .min(1, 'Select a backup file to restore')
    .max(1000, 'File path is too long'),
  relaunchAfterRestore: z.boolean().optional()
})

export const BACKUP_FIELD_LABELS: Record<string, string> = {
  autoBackup: 'automatic backups',
  interval: 'backup interval',
  retention: 'retention count',
  destination: 'backup folder'
}
