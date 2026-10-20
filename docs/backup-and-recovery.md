# Backup and recovery

How StorePro backs up store data, verifies backup files, upgrades older backups during restore,
and recovers from hardware or software failures (PRD FR-092..FR-095; modules M20-01..M20-07, DOC-02).

## 1. Backup format and metadata (`M20-01`, `M20-02`)

Every StorePro backup produces two files in the target folder:

1. **`<prefix>-v<schema>-<UTC-timestamp>.db`** — a complete, self-contained SQLite database created
   online using SQLite's `VACUUM INTO` (`Database.backupTo`). Because `VACUUM INTO` uses SQLite's
   snapshot isolation, a manual or scheduled backup can run while the store is open without locking
   or corrupting active transactions.
2. **`<prefix>-v<schema>-<UTC-timestamp>.db.meta.json`** — a JSON sidecar (`storepro-backup-v1`)
   containing:
   - `format`: `'storepro-backup-v1'`
   - `createdAt`: UTC epoch milliseconds
   - `appVersion`: the StorePro version that wrote the backup
   - `schemaVersion`: the highest migration version applied in the backup (`schema_migrations`)
   - `sha256Checksum`: hex-encoded SHA-256 digest of the `.db` file
   - `fileSizeBytes`: byte length of the `.db` file
   - `storeName`: the store name from `businesses`
   - `encryption`: `'none'` (MVP policy: unencrypted SQLite file + SHA-256 integrity checksum)
   - `triggerKind`: `'manual'`, `'scheduled'`, or `'pre_restore'`

File prefixes distinguish how a backup was created:
- `storepro-backup-v7-...db` — manual backup (`M20-01`)
- `auto-backup-v7-...db` — scheduled automatic backup (`M20-03`)
- `pre-restore-v7-...db` — safety copy taken automatically right before a restore (`M20-04`)
- `pre-migration-v6-to-v7-...db` — safety copy taken automatically before a schema upgrade (`M02-09`)

## 2. Scheduled backups and retention (`M20-03`)

- **Configuration** (`app_settings` key `backupsettings`, managed under **Manage → Settings → Data backup and restore**):
  - `autoBackupEnabled`: `true` by default
  - `scheduleIntervalHours`: `1`, `6`, `12`, `24` (default), or `168` (weekly)
  - `retentionCount`: `5` to `100` (default `30`)
  - `destinationDir`: custom folder path (e.g. an external USB drive `E:\StoreProBackups`), or `null` for `%APPDATA%\StorePro\backups`
- **Scheduler**: `BackupService.startScheduler()` checks every 60 seconds whether automatic backups
  are enabled and the configured interval has elapsed since the last recorded run in `backup_runs`.
- **Retention**: after each scheduled backup succeeds, `BackupService` prunes `auto-backup-*.db`
  (and their `.meta.json` sidecars) in the destination folder beyond `retentionCount`, keeping the
  newest `N` automatic backups. Manual backups (`storepro-backup-*`) and pre-restore/pre-migration
  safety copies are never auto-pruned.

## 3. Backup status and failure alerts (`M20-06`)

Every backup attempt is recorded in `backup_runs` (migration `0007_backup.sql`).
`BackupService.getStatus()` returns:
- `lastSuccessfulBackup`: the most recent run with `status = 'succeeded'`
- `lastFailedBackup`: the most recent run with `status = 'failed'`
- `hasUnresolvedFailureAlert`: `true` whenever `lastFailedBackup` is newer than `lastSuccessfulBackup`
- `recentRuns`: the latest 10 runs

When `hasUnresolvedFailureAlert` is `true`, **Manage → Settings → Data backup and restore** displays
a prominent danger alert with the timestamp and error message (for example, an unplugged USB drive
or full disk) and prompts the operator to resolve the folder issue and click **Back up now**.

## 4. Restore and older-schema migration (`M20-04`, `M20-05`)

Only administrators (`backup.restore`) can restore a backup. The restore workflow has two stages:

### Stage 1: Validation (`backup:validate`)
Before enabling the **Restore backup** button, StorePro inspects the candidate file:
1. Confirms the file exists and is non-empty.
2. Computes its SHA-256 hash. If a `.meta.json` sidecar is present alongside the `.db` file,
   verifies that the computed SHA-256 matches `sha256Checksum` in the sidecar. Any mismatch
   rejects the file immediately.
3. Opens the file read-only and verifies `PRAGMA application_id == 0x5350524F` (`"SPRO"`).
4. Reads `schema_migrations`:
   - Rejects files with no schema version or with a schema version newer than the running app
     (`DatabaseTooNewError`).
   - Marks `needsMigration = true` if `schemaVersion < currentSchemaVersion`.
5. Runs `checkIntegrity(db, 'full')` (SQLite B-tree/page check, FTS5 check, foreign key check,
   and business invariant checks).
6. Returns the store name, product count, sale count, schema version, and checksum status for
   confirmation in the UI.

### Stage 2: Restore (`backup:restore`)
Once the administrator confirms:
1. **Safety copy**: StorePro writes a full backup of the currently active database to
   `%APPDATA%\StorePro\backups\pre-restore-v<schema>-<timestamp>.db` (plus `.meta.json`).
2. **Staging & migration (`M20-05`)**: copies the selected backup to a temporary staging file in
   the `data/` folder, opens it, runs `migrate()` to bring older-schema backups up to the current
   schema version, and runs `checkIntegrity(stagedDb, 'full')` on the upgraded database.
3. **Atomic swap**: closes the active database, removes stale `-wal`/`-shm` files, copies the
   validated & migrated staging file into `storepro.db`, reopens the database, records the safety
   copy in `backup_runs` and `backup.restored` in `audit_logs`, and relaunches the application.

---

## 5. Recovery procedures (`DOC-02`)

### 5.1 Scenario A: Restoring from a backup (routine recovery or new PC)

1. Install StorePro on the target Windows 10 (22H2+) or Windows 11 64-bit computer.
2. If this is a brand-new installation, complete the initial 1-minute setup wizard with any
   placeholder store name and administrator account so you can reach **Manage → Settings**.
3. Connect the USB drive or folder containing your `.db` (and `.db.meta.json`) backup file.
4. Go to **Manage → Settings → Data backup and restore** and click **Restore from backup…**.
5. Click **Browse…**, select the `storepro-backup-*.db` or `auto-backup-*.db` file, and click
   **Verify file**.
6. Confirm that the store name, product count, sale count, and **Integrity verified** badge match
   what you expect.
7. Click **Restore backup**, then confirm **Restore and restart**.
8. StorePro saves a `pre-restore-*.db` safety copy of the previous database, restores your store
   data (upgrading the schema automatically if the backup came from an older release), and restarts.
   Sign in with the username and password from the restored store.

### 5.2 Scenario B: Recovering from a failed application update or schema migration

Before StorePro applies any database migration during an application update, `openStoreDatabase()`
automatically creates a backup in `%APPDATA%\StorePro\backups`:

```
%APPDATA%\StorePro\backups\pre-migration-v<old>-to-v<new>-<timestamp>.db
```

- **If a migration fails mid-way**: all pending migrations run inside a single SQLite transaction,
  so SQLite rolls back the transaction automatically and leaves `storepro.db` untouched at `<old>`.
- **If a newly installed version fails to start with "This store data was saved by a newer version"**:
  install the latest StorePro release (`StorePro-Setup-<version>-x64.exe`). The installer upgrades
  the application binary in place without touching `%APPDATA%\StorePro`.
- **If you must roll back to the previous StorePro version after an upgrade**:
  1. Close StorePro.
  2. Open `%APPDATA%\StorePro\backups` and locate the newest `pre-migration-v<old>-to-v<new>-*.db`.
  3. Copy `%APPDATA%\StorePro\data\storepro.db` to a safe place first.
  4. Delete `storepro.db`, `storepro.db-wal`, and `storepro.db-shm` in `%APPDATA%\StorePro\data\`,
     and copy `pre-migration-v<old>-to-v<new>-*.db` to `%APPDATA%\StorePro\data\storepro.db`.
  5. Reinstall the previous StorePro version and start the application.

### 5.3 Scenario C: Recovering from a corrupted database after power loss or hardware fault

StorePro opens SQLite with `journal_mode = WAL` and `synchronous = FULL`, so power loss alone will
not corrupt committed transactions. If a failing disk or external tool damages `storepro.db`:

1. On the next launch after an unclean shutdown, StorePro detects `session.lock` and automatically
   runs `checkIntegrity('quick')` before opening the UI.
2. If storage or foreign-key corruption is detected, StorePro stops immediately with the message:
   *"StorePro found a problem with its data file and stopped to protect it."*
   **Do not delete any files** in `%APPDATA%\StorePro`.
3. Copy the entire `%APPDATA%\StorePro` folder (`data/`, `backups/`, `logs/`) to an external drive
   for safekeeping.
4. Locate your latest good backup in your external backup folder or in `%APPDATA%\StorePro\backups`
   (`auto-backup-*.db` or `storepro-backup-*.db`).
5. Move the damaged `storepro.db`, `storepro.db-wal`, and `storepro.db-shm` out of
   `%APPDATA%\StorePro\data\`, copy the latest good `.db` backup file to
   `%APPDATA%\StorePro\data\storepro.db`, and launch StorePro.
6. Check **Manage → Audit log** and **Sell → Sales** to verify the last recorded invoice number,
   and re-enter any bills printed on paper after that backup's timestamp.
