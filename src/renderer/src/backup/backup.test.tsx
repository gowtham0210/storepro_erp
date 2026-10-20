import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { BackupConfig, BackupStatus, BackupValidationResult } from '@shared/ipc/contract'
import { fakeBackend, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const BASE_STATUS: BackupStatus = {
  config: {
    autoBackupEnabled: true,
    scheduleIntervalHours: 24,
    retentionCount: 30,
    destinationDir: null
  },
  resolvedDestinationDir: 'D:\\StorePro\\backups',
  lastSuccessfulBackup: {
    backupRunId: 1,
    triggerKind: 'scheduled',
    status: 'succeeded',
    startedAt: Date.UTC(2026, 9, 20, 4, 0),
    finishedAt: Date.UTC(2026, 9, 20, 4, 1),
    createdByName: null,
    filePath: 'D:\\StorePro\\backups\\auto-backup-v7-20261020T040000.db',
    fileSizeBytes: 150_000,
    sha256Checksum: 'a'.repeat(64),
    appVersion: '1.0.0',
    schemaVersion: 7,
    errorMessage: null
  },
  lastFailedBackup: null,
  hasUnresolvedFailureAlert: false,
  recentRuns: []
}

describe('BackupSection in Settings (M20-01 .. M20-06)', () => {
  it('shows last successful backup, triggers manual backup, and saves schedule settings', async () => {
    const user = userEvent.setup()
    let savedConfig: BackupConfig | undefined
    fakeBackend.on('backup:get-status', () => BASE_STATUS)
    fakeBackend.on('backup:create', () => ({
      ...BASE_STATUS.lastSuccessfulBackup!,
      backupRunId: 2,
      triggerKind: 'manual'
    }))
    fakeBackend.on('backup:set-config', (input) => {
      savedConfig = input
      return { ...BASE_STATUS, config: input }
    })

    renderApp('/settings')
    expect(await screen.findByText(/Data backup and restore/)).toBeTruthy()
    expect(await screen.findByText(/auto-backup-v7-20261020T040000\.db/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    await waitFor(() => expect(fakeBackend.callsTo('backup:create')).toHaveLength(1))

    const retentionInput = screen.getByLabelText(/^Backups to keep/)
    await user.clear(retentionInput)
    await user.type(retentionInput, '45')
    await user.click(screen.getByRole('button', { name: 'Save backup settings' }))

    await waitFor(() => expect(savedConfig).toBeDefined())
    expect(savedConfig?.retentionCount).toBe(45)
  })

  it('surfaces a failure alert when the last backup failed (M20-06)', async () => {
    fakeBackend.on('backup:get-status', () => ({
      ...BASE_STATUS,
      hasUnresolvedFailureAlert: true,
      lastFailedBackup: {
        backupRunId: 3,
        triggerKind: 'scheduled',
        status: 'failed',
        startedAt: Date.UTC(2026, 9, 20, 8, 0),
        finishedAt: Date.UTC(2026, 9, 20, 8, 0),
        createdByName: null,
        filePath: null,
        fileSizeBytes: null,
        sha256Checksum: null,
        appVersion: '1.0.0',
        schemaVersion: 7,
        errorMessage: 'ENOSPC: no space left on device'
      }
    }))

    renderApp('/settings')
    expect(await screen.findByText('Last backup failed')).toBeTruthy()
    expect(await screen.findByText(/ENOSPC: no space left on device/)).toBeTruthy()
  })

  it('validates a selected backup file, shows older-schema migration notice, confirms, and restores (M20-04, M20-05)', async () => {
    const user = userEvent.setup()
    const validationResult: BackupValidationResult = {
      valid: true,
      filePath: 'E:\\USB\\storepro-backup-v5.db',
      fileSizeBytes: 245_760,
      sha256Checksum: 'b'.repeat(64),
      checksumVerified: true,
      hasMetadataSidecar: true,
      appVersion: '0.8.0',
      schemaVersion: 5,
      currentSchemaVersion: 7,
      needsMigration: true,
      storeName: 'Lakshmi Stores Backup',
      productCount: 42,
      saleCount: 128,
      errorMessage: null
    }
    fakeBackend.on('backup:get-status', () => BASE_STATUS)
    fakeBackend.on('backup:validate', () => validationResult)
    fakeBackend.on('backup:restore', (input) => ({
      restoredFromPath: input.filePath,
      safetyCopyPath: 'D:\\StorePro\\backups\\pre-restore-v7.db',
      fromSchemaVersion: 5,
      toSchemaVersion: 7,
      migrationsApplied: [6, 7],
      relaunchScheduled: true
    }))

    renderApp('/settings')
    await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore from backup' })

    await user.type(
      within(dialog).getByLabelText(/^Backup file/),
      'E:\\USB\\storepro-backup-v5.db'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Verify file' }))

    expect(await within(dialog).findByText('Lakshmi Stores Backup')).toBeTruthy()
    expect(within(dialog).getByText('Integrity verified')).toBeTruthy()
    expect(within(dialog).getByText(/This backup is from schema v5/)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Restore backup' }))
    const confirmDialog = await screen.findByRole('dialog', {
      name: 'Restore store data from this backup?'
    })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Restore and restart' }))

    await waitFor(() =>
      expect(fakeBackend.callsTo('backup:restore')).toContainEqual({
        filePath: 'E:\\USB\\storepro-backup-v5.db'
      })
    )
  })

  it('allows a manager to create a backup but hides Restore from backup', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('manager') }
    fakeBackend.on('backup:get-status', () => BASE_STATUS)

    renderApp('/settings')
    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore from backup…' })).toBeNull()
  })
})
