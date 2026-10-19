import type { RoleCode, SessionUser, UserSummary } from '@shared/ipc/contract'
import type { PermissionCode } from '@shared/permissions'
import { Repository } from '../db/repository'

interface UserRow {
  user_id: number
  username: string
  display_name: string
  password_hash: string
  role_code: RoleCode
  role_name: string
  must_change_password: number
  last_sign_in_at: number | null
  created_at: number
  archived_at: number | null
}

export interface UserRecord extends UserSummary {
  passwordHash: string
}

const SELECT_USER = `
  SELECT u.user_id, u.username, u.display_name, u.password_hash, r.role_code, r.name AS role_name,
         u.must_change_password, u.last_sign_in_at, u.created_at, u.archived_at
  FROM users u JOIN roles r ON r.role_id = u.role_id`

function toRecord(row: UserRow): UserRecord {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    roleCode: row.role_code,
    roleName: row.role_name,
    active: row.archived_at === null,
    mustChangePassword: row.must_change_password === 1,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at
  }
}

export function toSummary({ passwordHash: _hash, ...summary }: UserRecord): UserSummary {
  return summary
}

export function toSessionUser(user: UserRecord, permissions: PermissionCode[]): SessionUser {
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    roleCode: user.roleCode,
    roleName: user.roleName,
    mustChangePassword: user.mustChangePassword,
    permissions
  }
}

/** The users aggregate. Password hashes never leave this repository except for verification. */
export class UserRepository extends Repository {
  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM users')?.n ?? 0
  }

  findById(userId: number): UserRecord | null {
    const row = this.db.get<UserRow>(`${SELECT_USER} WHERE u.user_id = ?`, [userId])
    return row ? toRecord(row) : null
  }

  /** Case-insensitive, like the UNIQUE constraint. */
  findByUsername(username: string): UserRecord | null {
    const row = this.db.get<UserRow>(`${SELECT_USER} WHERE u.username = ? COLLATE NOCASE`, [
      username
    ])
    return row ? toRecord(row) : null
  }

  list(): UserRecord[] {
    return this.db
      .all<UserRow>(
        `${SELECT_USER} ORDER BY u.archived_at IS NOT NULL, u.display_name COLLATE NOCASE`
      )
      .map(toRecord)
  }

  countActiveAdministrators(): number {
    return (
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE r.role_code = 'administrator' AND u.archived_at IS NULL`
      )?.n ?? 0
    )
  }

  create(user: {
    username: string
    displayName: string
    roleCode: RoleCode
    passwordHash: string
  }): number {
    return this.insertWithTimestamps('users', {
      username: user.username,
      display_name: user.displayName,
      password_hash: user.passwordHash,
      role_id: this.roleId(user.roleCode)
    })
  }

  updateProfile(userId: number, changes: { displayName: string; roleCode: RoleCode }): void {
    this.update('users', 'user_id', userId, {
      display_name: changes.displayName,
      role_id: this.roleId(changes.roleCode)
    })
  }

  setPassword(userId: number, passwordHash: string, mustChange: boolean): void {
    this.update('users', 'user_id', userId, {
      password_hash: passwordHash,
      must_change_password: mustChange ? 1 : 0
    })
  }

  recordSignIn(userId: number): void {
    this.db.run('UPDATE users SET last_sign_in_at = ? WHERE user_id = ?', [this.now(), userId])
  }

  setActive(userId: number, active: boolean): void {
    if (active) this.update('users', 'user_id', userId, { archived_at: null })
    else this.archive('users', 'user_id', userId)
  }

  private roleId(roleCode: RoleCode): number {
    const row = this.db.get<{ role_id: number }>('SELECT role_id FROM roles WHERE role_code = ?', [
      roleCode
    ])
    if (!row) throw new Error(`Unknown role ${roleCode}`)
    return row.role_id
  }
}
