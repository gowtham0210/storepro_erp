import type { NewUser, RoleSummary, UserSummary, UserUpdate } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { passwordProblem } from '@shared/passwordPolicy'
import type { AuditLog } from '../audit/auditLog'
import type { AuthService } from '../auth/authService'
import type { LoginThrottle } from '../auth/loginThrottle'
import type { PasswordHasher } from '../auth/passwords'
import type { Database } from '../db/database'
import { toSummary, type UserRecord, type UserRepository } from './userRepository'

export interface UserServiceDeps {
  db: Database
  users: UserRepository
  auth: AuthService
  hasher: PasswordHasher
  throttle: LoginThrottle
  audit: AuditLog
}

const LAST_ADMIN =
  'StorePro needs at least one active administrator. Make someone else an administrator first.'

/** User management for administrators (M05-05). */
export class UserService {
  constructor(private readonly deps: UserServiceDeps) {}

  list(): UserSummary[] {
    this.deps.auth.requireAdministrator()
    return this.deps.users.list().map(toSummary)
  }

  listRoles(): RoleSummary[] {
    this.deps.auth.requireAdministrator()
    return this.deps.users.listRoles()
  }

  async create(input: NewUser): Promise<UserSummary> {
    const admin = this.deps.auth.requireAdministrator()
    const { db, users, hasher, audit } = this.deps
    this.assertUsernameFree(input.username)
    const passwordHash = await hasher.hash(input.password)
    const userId = db.transaction(() => {
      this.assertUsernameFree(input.username)
      const id = users.create({ ...input, passwordHash })
      audit.record({
        action: 'user.created',
        userId: admin.userId,
        entity: { type: 'user', id },
        details: { roleCode: input.roleCode }
      })
      return id
    })
    return this.summary(userId)
  }

  update({ userId, displayName, roleCode }: UserUpdate): UserSummary {
    const admin = this.deps.auth.requireAdministrator()
    const { db, users, audit } = this.deps
    db.transaction(() => {
      const target = this.requireTarget(userId)
      if (target.roleCode === 'administrator' && roleCode !== 'administrator' && target.active) {
        this.assertNotLastAdministrator()
      }
      users.updateProfile(userId, { displayName, roleCode })
      audit.record({
        action: 'user.updated',
        userId: admin.userId,
        entity: { type: 'user', id: userId },
        details: { displayName, roleCode, previousRoleCode: target.roleCode }
      })
    })
    return this.summary(userId)
  }

  setActive({ userId, active }: { userId: number; active: boolean }): UserSummary {
    const admin = this.deps.auth.requireAdministrator()
    const { db, users, audit } = this.deps
    db.transaction(() => {
      const target = this.requireTarget(userId)
      if (target.active === active) return
      if (!active) {
        if (userId === admin.userId)
          throw new AppError('CONFLICT', "You can't deactivate your own account.")
        if (target.roleCode === 'administrator') this.assertNotLastAdministrator()
      }
      users.setActive(userId, active)
      audit.record({
        action: active ? 'user.reactivated' : 'user.deactivated',
        userId: admin.userId,
        entity: { type: 'user', id: userId }
      })
    })
    return this.summary(userId)
  }

  /** Sets a temporary password the user must change at next sign-in, and lifts any sign-in block. */
  async resetPassword({
    userId,
    newPassword
  }: {
    userId: number
    newPassword: string
  }): Promise<UserSummary> {
    const admin = this.deps.auth.requireAdministrator()
    const { db, users, hasher, throttle, audit } = this.deps
    const target = this.requireTarget(userId)
    const problem = passwordProblem(newPassword, target.username)
    if (problem)
      throw new AppError('VALIDATION_FAILED', problem, [{ path: 'newPassword', message: problem }])
    const passwordHash = await hasher.hash(newPassword)
    db.transaction(() => {
      users.setPassword(userId, passwordHash, userId !== admin.userId)
      throttle.clear(target.username)
      audit.record({
        action: 'user.password_reset',
        userId: admin.userId,
        entity: { type: 'user', id: userId }
      })
    })
    return this.summary(userId)
  }

  private assertUsernameFree(username: string): void {
    if (this.deps.users.findByUsername(username)) {
      const message = 'That username is already taken'
      throw new AppError('CONFLICT', message, [{ path: 'username', message }])
    }
  }

  private assertNotLastAdministrator(): void {
    if (this.deps.users.countActiveAdministrators() <= 1) throw new AppError('CONFLICT', LAST_ADMIN)
  }

  private requireTarget(userId: number): UserRecord {
    const user = this.deps.users.findById(userId)
    if (!user) throw new AppError('NOT_FOUND', 'That user no longer exists.')
    return user
  }

  private summary(userId: number): UserSummary {
    return toSummary(this.requireTarget(userId))
  }
}
