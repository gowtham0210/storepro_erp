import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  DatabaseBackup,
  FolderOpen,
  History,
  RotateCcw,
  Save,
  ShieldAlert
} from 'lucide-react'
import { useState } from 'react'
import type {
  BackupConfig,
  BackupStatus,
  BackupValidationResult
} from '@shared/ipc/contract'
import { backupConfigSchema, SCHEDULE_INTERVAL_HOURS } from '@shared/schemas/backup'
import { useCan } from '../auth/permissions'
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Select,
  Spinner,
  TextInput,
  useConfirm,
  useToast
} from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

const INTERVAL_LABELS: Record<(typeof SCHEDULE_INTERVAL_HOURS)[number], string> = {
  1: 'Every hour',
  6: 'Every 6 hours',
  12: 'Every 12 hours',
  24: 'Once a day (every 24 hours)',
  168: 'Once a week (every 7 days)'
}

/**
 * M20-01 to M20-06: Backup status, failure alerts, manual backup, automatic
 * backup schedule & retention settings, and validated restore workflow.
 */
export function BackupSection({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const canCreateBackup = useCan()('backup.create')
  const canRestoreBackup = useCan()('backup.restore')
  const status = useIpcQuery('backup:get-status')
  const [restoreOpen, setRestoreOpen] = useState(false)

  return (
    <Card title="Data backup and restore">
      <p className="mb-4 text-fg-muted">
        Keep copies of your store data on an external drive or backup folder so you can recover
        if this computer is lost or damaged.
      </p>
      {status.error ? (
        <Alert tone="danger">{describeError(status.error).message}</Alert>
      ) : !status.data ? (
        <Spinner label="Loading backup status" />
      ) : (
        <BackupContent
          key={JSON.stringify(status.data.config)}
          status={status.data}
          canEdit={canEdit}
          canCreateBackup={canCreateBackup}
          canRestoreBackup={canRestoreBackup}
          onOpenRestore={() => setRestoreOpen(true)}
        />
      )}
      {restoreOpen && <RestoreBackupDialog onClose={() => setRestoreOpen(false)} />}
    </Card>
  )
}

function BackupContent({
  status,
  canEdit,
  canCreateBackup,
  canRestoreBackup,
  onOpenRestore
}: {
  status: BackupStatus
  canEdit: boolean
  canCreateBackup: boolean
  canRestoreBackup: boolean
  onOpenRestore: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<BackupConfig>(status.config)
  const [retentionText, setRetentionText] = useState(String(status.config.retentionCount))
  const [saving, setSaving] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedRetention = Number(retentionText)
  const effectiveDraft: BackupConfig = {
    ...draft,
    retentionCount: Number.isFinite(parsedRetention) ? parsedRetention : draft.retentionCount
  }
  const changed = JSON.stringify(effectiveDraft) !== JSON.stringify(status.config)

  const refreshStatus = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['backup:get-status'] })
  }

  const handleBackupNow = async (): Promise<void> => {
    setError(null)
    setCreatingBackup(true)
    try {
      const run = await invoke('backup:create', {
        destinationDir: draft.destinationDir
      })
      await refreshStatus()
      toast.success(`Backup saved to ${run.filePath ?? status.resolvedDestinationDir}.`)
    } catch (failure) {
      setError(describeError(failure).message)
      await refreshStatus()
    } finally {
      setCreatingBackup(false)
    }
  }

  const handlePickFolder = async (): Promise<void> => {
    try {
      const picked = await invoke('backup:pick-folder')
      if (picked) {
        setDraft((prev) => ({ ...prev, destinationDir: picked }))
      }
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const handleSaveSettings = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    const parsed = backupConfigSchema.safeParse({
      ...draft,
      retentionCount: retentionText
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check backup settings')
      return
    }
    setSaving(true)
    try {
      const updated = await invoke('backup:set-config', parsed.data)
      queryClient.setQueryData(['backup:get-status'], updated)
      toast.success('Backup settings saved.')
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSaving(false)
    }
  }

  const lastOk = status.lastSuccessfulBackup
  const lastFail = status.lastFailedBackup

  return (
    <div className="space-y-5">
      {/* M20-06: Failure alert when the latest backup attempt failed */}
      {status.hasUnresolvedFailureAlert && lastFail && (
        <Alert tone="danger" title="Last backup failed">
          The backup at {dateTimeFormat.format(lastFail.finishedAt)} did not complete
          {lastFail.errorMessage ? `: ${lastFail.errorMessage}` : '.'} Check that the backup folder
          is connected and has free disk space, then click <strong>Back up now</strong>.
        </Alert>
      )}

      {/* Status summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-bg-subtle p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {lastOk ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="font-medium">
                  Last backup: {dateTimeFormat.format(lastOk.finishedAt)}
                </span>
                <Badge tone="success">
                  {lastOk.triggerKind === 'scheduled' ? 'Automatic' : 'Manual'}
                </Badge>
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-warning" />
                <span className="font-medium">No backup has been created yet</span>
              </>
            )}
          </div>
          <p className="text-sm text-fg-muted">
            {lastOk?.filePath
              ? `Saved as ${lastOk.filePath} (${formatBytes(lastOk.fileSizeBytes)})`
              : `Default backup folder: ${status.resolvedDestinationDir}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateBackup && (
            <Button
              variant="primary"
              icon={<DatabaseBackup />}
              loading={creatingBackup}
              onClick={() => void handleBackupNow()}
            >
              Back up now
            </Button>
          )}
          {canRestoreBackup && (
            <Button icon={<RotateCcw />} onClick={onOpenRestore}>
              Restore from backup…
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* M20-03: Automatic backup schedule and retention settings */}
      <form noValidate onSubmit={(event) => void handleSaveSettings(event)} className="space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <label className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border"
              checked={draft.autoBackupEnabled}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, autoBackupEnabled: event.target.checked }))
              }
            />
            <span>
              <span className="font-medium text-fg block">
                Automatic scheduled backups
              </span>
              <span className="text-fg-muted">
                Automatically saves a verified backup in the background while StorePro is open and
                removes older automatic backups beyond your retention limit.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Backup frequency">
              <Select
                value={String(draft.scheduleIntervalHours)}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    scheduleIntervalHours: Number(
                      event.target.value
                    ) as BackupConfig['scheduleIntervalHours']
                  }))
                }
                options={SCHEDULE_INTERVAL_HOURS.map((hours) => ({
                  value: String(hours),
                  label: INTERVAL_LABELS[hours]
                }))}
              />
            </Field>

            <Field label="Backups to keep" hint="Between 5 and 100 automatic backups">
              <TextInput
                value={retentionText}
                onChange={(event) => setRetentionText(event.target.value)}
                inputMode="numeric"
              />
            </Field>

            <Field
              label="Backup folder"
              hint={`Leave blank for default (${status.resolvedDestinationDir})`}
            >
              <div className="flex gap-2">
                <TextInput
                  aria-label="Backup folder"
                  value={draft.destinationDir ?? ''}
                  placeholder="Default backups folder"
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      destinationDir: event.target.value.trim() ? event.target.value : null
                    }))
                  }
                />
                {canCreateBackup && (
                  <Button
                    type="button"
                    icon={<FolderOpen />}
                    aria-label="Browse backup folder"
                    onClick={() => void handlePickFolder()}
                  >
                    Browse
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </fieldset>

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {changed && <span className="text-sm text-fg-muted">Unsaved changes</span>}
            <Button
              type="submit"
              variant="primary"
              icon={<Save />}
              loading={saving}
              disabled={!changed}
            >
              Save backup settings
            </Button>
          </div>
        )}
      </form>

      {/* Recent backup history */}
      {status.recentRuns.length > 0 && (
        <details className="rounded-md border border-divider p-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-fg">
            <History className="h-4 w-4 text-fg-muted" />
            Recent backup history ({status.recentRuns.length})
          </summary>
          <ul className="mt-3 divide-y divide-divider">
            {status.recentRuns.map((run) => (
              <li
                key={run.backupRunId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <span className="font-medium">{dateTimeFormat.format(run.finishedAt)}</span>
                  <span className="text-fg-muted">
                    {' · '}
                    {run.triggerKind === 'scheduled'
                      ? 'Automatic'
                      : run.triggerKind === 'pre_restore'
                        ? 'Pre-restore safety copy'
                        : 'Manual'}
                  </span>
                  {run.filePath && (
                    <div className="text-xs text-fg-muted">
                      {run.filePath} ({formatBytes(run.fileSizeBytes)})
                    </div>
                  )}
                  {run.errorMessage && (
                    <div className="text-xs text-danger">{run.errorMessage}</div>
                  )}
                </div>
                <Badge tone={run.status === 'succeeded' ? 'success' : 'danger'}>
                  {run.status === 'succeeded' ? 'Succeeded' : 'Failed'}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/**
 * M20-04 & M20-05: Restore dialog that validates the selected backup file,
 * shows store name, schema version, migration notice, and checksum status,
 * confirms with the user, keeps a safety copy, and restores.
 */
function RestoreBackupDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()

  const [filePath, setFilePath] = useState('')
  const [validating, setValidating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [validation, setValidation] = useState<BackupValidationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async (): Promise<void> => {
    try {
      const picked = await invoke('backup:pick-file')
      if (picked) {
        setFilePath(picked)
        await runValidation(picked)
      }
    } catch (failure) {
      setError(describeError(failure).message)
    }
  }

  const runValidation = async (targetPath: string): Promise<void> => {
    const clean = targetPath.trim()
    if (!clean) {
      setError('Select a backup file (.db) to inspect.')
      return
    }
    setError(null)
    setValidating(true)
    try {
      const result = await invoke('backup:validate', { filePath: clean })
      setValidation(result)
    } catch (failure) {
      setError(describeError(failure).message)
      setValidation(null)
    } finally {
      setValidating(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    if (!validation || !validation.valid) return
    const confirmed = await confirm({
      title: 'Restore store data from this backup?',
      description:
        'StorePro will first save a safety copy of your current database in the backups folder, then replace your store data with this backup and restart.',
      confirmLabel: 'Restore and restart',
      tone: 'danger'
    })
    if (!confirmed) return

    setError(null)
    setRestoring(true)
    try {
      const result = await invoke('backup:restore', {
        filePath: validation.filePath
      })
      await queryClient.invalidateQueries()
      toast.success(
        `Store data restored. A safety copy was saved to ${result.safetyCopyPath}.`
      )
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog
      open
      title="Restore from backup"
      description="Select a StorePro backup file (.db) to verify its integrity before restoring."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={restoring}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<RotateCcw />}
            loading={restoring}
            disabled={!validation?.valid}
            onClick={() => void handleRestore()}
          >
            Restore backup
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Backup file (.db)">
          <div className="flex gap-2">
            <TextInput
              aria-label="Backup file (.db)"
              value={filePath}
              placeholder="D:\Backups\storepro-backup-v7-....db"
              onChange={(event) => {
                setFilePath(event.target.value)
                setValidation(null)
              }}
            />
            <Button
              type="button"
              icon={<FolderOpen />}
              onClick={() => void handleBrowse()}
            >
              Browse…
            </Button>
            <Button
              type="button"
              loading={validating}
              disabled={!filePath.trim()}
              onClick={() => void runValidation(filePath)}
            >
              Verify file
            </Button>
          </div>
        </Field>

        {validation && !validation.valid && (
          <Alert tone="danger" title="Backup cannot be restored">
            {validation.errorMessage ?? 'The selected file is not a valid StorePro backup.'}
          </Alert>
        )}

        {validation && validation.valid && (
          <div className="space-y-3 rounded-md border border-border bg-bg-subtle p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-fg">
                {validation.storeName ?? 'Unconfigured StorePro database'}
              </span>
              <Badge tone="success">Integrity verified</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-fg-muted sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase">Products</dt>
                <dd className="font-medium text-fg">{validation.productCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase">Sales</dt>
                <dd className="font-medium text-fg">{validation.saleCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase">File size</dt>
                <dd className="font-medium text-fg">{formatBytes(validation.fileSizeBytes)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase">Schema version</dt>
                <dd className="font-medium text-fg">
                  v{validation.schemaVersion}
                  {validation.appVersion ? ` (App ${validation.appVersion})` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase">Checksum</dt>
                <dd className="font-medium text-fg">
                  {validation.checksumVerified
                    ? 'SHA-256 verified (.meta.json)'
                    : `${validation.sha256Checksum.slice(0, 12)}…`}
                </dd>
              </div>
            </dl>

            {validation.needsMigration && (
              <Alert tone="info" title="Older backup version">
                This backup is from schema v{validation.schemaVersion}. StorePro will automatically
                upgrade it to v{validation.currentSchemaVersion} during restore.
              </Alert>
            )}

            <Alert tone="warning" title="Safety copy">
              Before restoring, StorePro will save a full copy of your current store database in
              the backups folder so nothing is lost.
            </Alert>
          </div>
        )}
      </div>
    </Dialog>
  )
}
