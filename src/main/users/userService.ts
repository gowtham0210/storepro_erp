import type { NewUser, RoleCode, RoleSummary, UserSummary, UserUpdate } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { passwordProblem } from '@shared/passwordPolicy'
import { canGrant } from '@shared/permissions'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import type { LoginThrottle } from '../auth/loginThrottle'
import type { PasswordHasher } from '../auth/passwords'
import type { RoleRepository } from '../auth/roleRepository'
import type { Database } from '../db/database'
import { toSummary, type UserRecord, type UserRepository } from './userRepository'

export interface UserServiceDeps {
  db: Database
  users: UserRepository
  roles: RoleRepository
  hasher: PasswordHasher
  throttle: LoginThrottle
  audit: AuditLog
}

const LAST_ADMIN =
  'StorePro needs at least one active administrator. Make someone else an administrator first.'

const MORE_ACCESS = "You can't give someone more access than you have."
const ACCOUNT_WITH_MORE_ACCESS =
  "This person's role has access you don't have, so only an administrator can change their account."

/**
 * User management (M05-05) for anyone with `user.manage`, under the
 * no-escalation rule (M06): you can give someone a role, or change the account
 * of someone who has it, only if the role grants nothing beyond your own
 * permissions.
 */
export class UserService {
  constructor(private readonly deps: UserServiceDeps) {}

  list(actor: Actor): UserSummary[] {
    assertCan(actor, 'user.manage')
    return this.deps.users.list().map(toSummary)
  }

  listRoles(actor: Actor): RoleSummary[] {
    assertCan(actor, 'user.manage')
    return this.deps.roles.list()
  }

  async create(actor: Actor, input: NewUser): Promise<UserSummary> {
    assertCan(actor, 'user.manage')
    const { db, users, hasher, audit } = this.deps
    this.assertCanGrant(actor, input.roleCode, MORE_ACCESS)
    this.assertUsernameFree(input.username)
    const passwordHash = await hasher.hash(input.password)
    const userId = db.transaction(() => {
      this.assertUsernameFree(input.username)
      const id = users.create({ ...input, passwordHash })
      audit.record({
        action: 'user.created',
        userId: actor.userId,
        entity: { type: 'user', id },
        details: { roleCode: input.roleCode }
      })
      return id
    })
    return this.summary(userId)
  }

  update(actor: Actor, { userId, displayName, roleCode }: UserUpdate): UserSummary {
    assertCan(actor, 'user.manage')
    const { db, users, audit } = this.deps
    db.transaction(() => {
      const target = this.requireManageableTarget(actor, userId)
      this.assertCanGrant(actor, roleCode, MORE_ACCESS)
      if (target.roleCode === 'administrator' && roleCode !== 'administrator' && target.active) {
        this.assertNotLastAdministrator()
      }
      users.updateProfile(userId, { displayName, roleCode })
      audit.record({
        action: 'user.updated',
        userId: actor.userId,
        entity: { type: 'user', id: userId },
        details: { displayName, roleCode, previousRoleCode: target.roleCode }
      })
    })
    return this.summary(userId)
  }

  setActive(actor: Actor, { userId, active }: { userId: number; active: boolean }): UserSummary {
    assertCan(actor, 'user.manage')
    const { db, users, audit } = this.deps
    db.transaction(() => {
      const target = this.requireManageableTarget(actor, userId)
      if (target.active === active) return
      if (!active) {
        if (userId === actor.userId)
          throw new AppError('CONFLICT', "You can't deactivate your own account.")
        if (target.roleCode === 'administrator') this.assertNotLastAdministrator()
      }
      users.setActive(userId, active)
      audit.record({
        action: active ? 'user.reactivated' : 'user.deactivated',
        userId: actor.userId,
        entity: { type: 'user', id: userId }
      })
    })
    return this.summary(userId)
  }

  /** Sets a temporary password the user must change at next sign-in, and lifts any sign-in block. */
  async resetPassword(
    actor: Actor,
    { userId, newPassword }: { userId: number; newPassword: string }
  ): Promise<UserSummary> {
    assertCan(actor, 'user.manage')
    const { db, users, hasher, throttle, audit } = this.deps
    const target = this.requireManageableTarget(actor, userId)
    const problem = passwordProblem(newPassword, target.username)
    if (problem)
      throw new AppError('VALIDATION_FAILED', problem, [{ path: 'newPassword', message: problem }])
    const passwordHash = await hasher.hash(newPassword)
    db.transaction(() => {
      // Checked again: the role may have changed while the password was hashed.
      this.requireManageableTarget(actor, userId)
      users.setPassword(userId, passwordHash, userId !== actor.userId)
      throttle.clear(target.username)
      audit.record({
        action: 'user.password_reset',
        userId: actor.userId,
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

  private assertCanGrant(actor: Actor, roleCode: RoleCode, message: string): void {
    if (!canGrant(actor.permissions, this.deps.roles.permissionsOf(roleCode))) {
      throw new AppError('FORBIDDEN', message)
    }
  }

  private requireManageableTarget(actor: Actor, userId: number): UserRecord {
    const target = this.requireTarget(userId)
    this.assertCanGrant(actor, target.roleCode, ACCOUNT_WITH_MORE_ACCESS)
    return target
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
