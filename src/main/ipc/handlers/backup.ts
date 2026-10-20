import { z } from 'zod'
import {
  backupConfigSchema,
  createBackupSchema,
  restoreBackupSchema,
  validateBackupSchema
} from '@shared/schemas/backup'
import type { BackupService } from '../../backup/backupService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'backup:get-status'
  | 'backup:set-config'
  | 'backup:pick-folder'
  | 'backup:pick-file'
  | 'backup:create'
  | 'backup:validate'
  | 'backup:restore'

export function createBackupHandlers(
  backups: BackupService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'backup:get-status': {
      access: 'settings.view',
      input: z.void(),
      handle: (_, { actor }) => backups.getStatus(actor)
    },
    'backup:set-config': {
      access: 'settings.edit',
      input: backupConfigSchema,
      handle: (input, { actor }) => backups.setConfig(actor, input)
    },
    'backup:pick-folder': {
      access: 'backup.create',
      input: z.void(),
      handle: (_, { actor }) => backups.pickFolder(actor)
    },
    'backup:pick-file': {
      access: 'backup.restore',
      input: z.void(),
      handle: (_, { actor }) => backups.pickBackupFile(actor)
    },
    'backup:create': {
      access: 'backup.create',
      input: createBackupSchema,
      handle: (input, { actor }) => backups.createBackup(actor, input)
    },
    'backup:validate': {
      access: 'backup.restore',
      input: validateBackupSchema,
      handle: (input, { actor }) => backups.validateBackup(actor, input)
    },
    'backup:restore': {
      access: 'backup.restore',
      input: restoreBackupSchema,
      handle: (input, { actor }) => backups.restoreBackup(actor, input)
    }
  }
}
