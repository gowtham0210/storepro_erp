import type { Migration } from '../migrator'
import initialSchema from './0001_initial_schema.sql?raw'
import authentication from './0002_authentication.sql?raw'
import permissions from './0003_permissions.sql?raw'

/**
 * Every schema change, in order. Rules:
 *  - Never edit or remove a migration that has shipped: its checksum is
 *    recorded in each database, and a mismatch stops the app from starting.
 *  - Add a new file with the next version number instead.
 *  - Set `foreignKeysOff` for migrations that rebuild tables (SQLite's
 *    12-step ALTER procedure); foreign keys are re-checked before commit.
 */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'initial_schema', sql: initialSchema },
  { version: 2, name: 'authentication', sql: authentication },
  { version: 3, name: 'permissions', sql: permissions }
]
