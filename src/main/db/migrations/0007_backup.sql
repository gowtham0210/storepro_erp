-- M20: backup and restore (FR-100 to FR-104).
--
--  * backup_runs: records every manual and scheduled backup attempt (status,
--    file path, SHA-256 checksum, schema version, size and failure message)
--    for status display and failure alerts (M20-06, FR-104).
--  * Schedule and retention preferences are device-local and stored in
--    `app_settings` (key `backupsettings`), matching `printerconfig`.

CREATE TABLE backup_runs (
  backup_run_id   INTEGER PRIMARY KEY,
  trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled', 'pre_restore')),
  status          TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER NOT NULL CHECK (finished_at >= started_at),
  created_by_user_id INTEGER REFERENCES users (user_id),
  file_path       TEXT,
  file_size_bytes INTEGER CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  sha256_checksum TEXT CHECK (sha256_checksum IS NULL OR length(sha256_checksum) = 64),
  app_version     TEXT NOT NULL,
  schema_version  INTEGER NOT NULL CHECK (schema_version >= 1),
  error_message   TEXT,
  CHECK (
    (status = 'succeeded' AND file_path IS NOT NULL AND sha256_checksum IS NOT NULL AND error_message IS NULL) OR
    (status = 'failed' AND error_message IS NOT NULL)
  )
) STRICT;

CREATE INDEX backup_runs_started_at ON backup_runs (started_at);
CREATE INDEX backup_runs_created_by_user_id ON backup_runs (created_by_user_id);
