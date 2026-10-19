import type {
  AuthState,
  Credentials,
  NewAdministrator,
  OverrideApproval,
  OverrideRequest,
  PasswordChange,
  SessionUser
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { passwordProblem } from '@shared/passwordPolicy'
import type { PermissionCode } from '@shared/permissions'
import type { AuditEntry, AuditLog } from '../audit/auditLog'
import type { Database } from '../db/database'
import type { Logger } from '../logging/logger'
import { toSessionUser, type UserRecord, type UserRepository } from '../users/userRepository'
import { can, forbidden, type Actor, type HandlerAccess } from './access'
import type { LoginThrottle } from './loginThrottle'
import type { OverrideGrants } from './overrideGrants'
import type { PasswordHasher } from './passwords'
import type { RoleRepository } from './roleRepository'

export interface AuthServiceDeps {
  db: Database
  users: UserRepository
  roles: RoleRepository
  overrides: OverrideGrants
  hasher: PasswordHasher
  throttle: LoginThrottle
  audit: AuditLog
  logger: Logger
}

const WRONG_CREDENTIALS = 'The username or password is incorrect.'

/**
 * Sign-in, the session and authorization (M05-02, M05-03, M06-03, M06-05).
 * There is one session per app: the person at this computer. It lives only in
 * the main process and ends when the app closes. The renderer is told who is
 * signed in but never holds a token it could leak.
 */
export class AuthService {
  private session: { userId: number; locked: boolean } | null = null
  private dummyHash: Promise<string> | null = null

  constructor(private readonly deps: AuthServiceDeps) {}

  getState(): AuthState {
    const user = this.sessionUser()
    if (!user)
      return this.deps.users.count() === 0 ? { status: 'setup-required' } : { status: 'signed-out' }
    return {
      status: this.session?.locked ? 'locked' : 'signed-in',
      user: toSessionUser(user, this.deps.roles.permissionsOf(user.roleCode))
    }
  }

  /**
   * First run only (M05-04): creates the first administrator and signs them
   * in. `alsoSave` runs in the same transaction (the store profile, M03), so
   * setup is saved completely or not at all.
   */
  async createInitialAdmin(
    input: NewAdministrator,
    alsoSave?: (adminId: number) => void
  ): Promise<SessionUser> {
    const { db, users, hasher, audit } = this.deps
    if (users.count() > 0) throw new AppError('CONFLICT', 'StorePro already has an administrator.')
    const passwordHash = await hasher.hash(input.password)
    const userId = db.transaction(() => {
      // Checked again inside the transaction: two windows can't both win.
      if (users.count() > 0)
        throw new AppError('CONFLICT', 'StorePro already has an administrator.')
      const id = users.create({ ...input, roleCode: 'administrator', passwordHash })
      users.recordSignIn(id)
      audit.change({
        action: 'user.created',
        userId: id,
        entity: { type: 'user', id },
        details: { username: input.username, role: 'Administrator', initialSetup: true }
      })
      audit.change({ action: 'user.sign_in', userId: id, entity: { type: 'user', id } })
      alsoSave?.(id)
      return id
    })
    this.startSession(userId)
    return this.requireSessionUser()
  }

  async signIn({ username, password }: Credentials): Promise<SessionUser> {
    const user = await this.checkPassword(username, password, WRONG_CREDENTIALS)
    const { db, users, audit, hasher, logger } = this.deps
    if (hasher.needsRehash(user.passwordHash)) {
      // Upgrade old hashes while we know the password.
      users.setPassword(user.userId, await hasher.hash(password), user.mustChangePassword)
      logger.info('Upgraded password hash parameters', { userId: user.userId })
    }
    db.transaction(() => {
      users.recordSignIn(user.userId)
      audit.change({
        action: 'user.sign_in',
        userId: user.userId,
        entity: { type: 'user', id: user.userId }
      })
    })
    this.startSession(user.userId)
    return this.requireSessionUser()
  }

  signOut(): void {
    const userId = this.session?.userId
    this.session = null
    this.deps.overrides.clear()
    if (userId !== undefined) {
      this.deps.audit.event({
        action: 'user.sign_out',
        userId,
        entity: { type: 'user', id: userId }
      })
    }
  }

  /** Lock the screen without signing out (Ctrl+L, or after inactivity). */
  lock(): void {
    if (this.session && this.sessionUser()) this.session.locked = true
    this.deps.overrides.clear()
  }

  async unlock(password: string): Promise<SessionUser> {
    const user = this.sessionUser()
    if (!user || !this.session?.locked)
      throw new AppError('UNAUTHENTICATED', 'Nobody is signed in.')
    await this.checkPassword(user.username, password, 'The password is incorrect.')
    this.session = { userId: user.userId, locked: false }
    return this.requireSessionUser()
  }

  async changePassword({ currentPassword, newPassword }: PasswordChange): Promise<SessionUser> {
    const user = this.requireUser({ allowPasswordChangeRequired: true })
    await this.checkPassword(user.username, currentPassword, 'Your current password is incorrect.')
    const problem = passwordProblem(newPassword, user.username)
    if (problem) {
      throw new AppError('VALIDATION_FAILED', problem, [{ path: 'newPassword', message: problem }])
    }
    if (newPassword === currentPassword) {
      const message = 'Choose a password different from your current one'
      throw new AppError('VALIDATION_FAILED', message, [{ path: 'newPassword', message }])
    }
    const passwordHash = await this.deps.hasher.hash(newPassword)
    this.deps.db.transaction(() => {
      this.deps.users.setPassword(user.userId, passwordHash, false)
      this.deps.audit.change({
        action: 'user.password_changed',
        userId: user.userId,
        entity: { type: 'user', id: user.userId }
      })
    })
    return this.requireSessionUser()
  }

  /**
   * The signed-in, unlocked user, re-read from the database on every call so
   * deactivation and role changes take effect immediately. Every handler that
   * needs a user goes through this, usually via authorize().
   */
  requireUser(options: { allowPasswordChangeRequired?: boolean } = {}): UserRecord {
    const user = this.sessionUser()
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.')
    if (this.session?.locked)
      throw new AppError('UNAUTHENTICATED', 'StorePro is locked. Unlock it to continue.')
    if (user.mustChangePassword && !options.allowPasswordChangeRequired) {
      throw new AppError('UNAUTHENTICATED', 'Choose a new password to continue.', {
        reason: 'password-change-required'
      })
    }
    return user
  }

  /**
   * The permission guard (M06-03). The service host calls this for every
   * request before the handler runs, with the access the handler declared.
   * Returns who the request runs as (null for public channels), or throws
   * UNAUTHENTICATED or FORBIDDEN.
   *
   * A request the user's role doesn't allow can still go ahead if the handler
   * is `overridable` and the request carries a valid manager approval.
   */
  authorize(
    access: HandlerAccess,
    { overridable = false, overrideId }: { overridable?: boolean; overrideId?: string } = {}
  ): Actor | null {
    if (access === 'public') return null
    const user = this.requireUser({ allowPasswordChangeRequired: access === 'password-change' })
    const actor = this.actorFor(user)
    if (access === 'password-change' || access === 'signed-in') return actor
    if (can(actor, access)) {
      return overridable && overrideId !== undefined
        ? this.useAnyOverride(actor, overrideId)
        : actor
    }
    if (overridable && overrideId !== undefined) return this.useOverride(actor, access, overrideId)
    this.deps.audit.event({ action: 'access.denied', actor, details: { permission: access } })
    throw forbidden(access, overridable)
  }

  /**
   * Another user approves one restricted request for the signed-in user by
   * typing their own username and password (M06-05). Throttled and audited
   * like a sign-in. Returns a single-use approval id.
   */
  async approveOverride(
    actor: Actor,
    { permission, username, password }: OverrideRequest
  ): Promise<OverrideApproval> {
    const { roles, overrides, audit } = this.deps
    if (can(actor, permission)) {
      throw new AppError('CONFLICT', 'You can already do this without approval.')
    }
    const forRequester = { type: 'user', id: actor.userId }
    const approver = await this.checkPassword(username, password, WRONG_CREDENTIALS, {
      action: 'override.denied',
      entity: forRequester,
      details: { permission, reason: 'wrong_password' }
    })
    if (approver.mustChangePassword) {
      throw new AppError(
        'FORBIDDEN',
        `${approver.displayName} must choose a new password before approving anything.`
      )
    }
    if (!roles.permissionsOf(approver.roleCode).includes(permission)) {
      audit.event({
        action: 'override.denied',
        userId: approver.userId,
        entity: forRequester,
        details: { permission, reason: 'not_permitted' }
      })
      throw new AppError('FORBIDDEN', `${approver.displayName} isn't allowed to approve this.`)
    }
    const { overrideId, expiresAt } = overrides.issue({
      permission,
      requestedBy: actor.userId,
      approvedBy: approver.userId
    })
    audit.event({
      action: 'override.approved',
      userId: approver.userId,
      entity: forRequester,
      details: { permission }
    })
    return { overrideId, approvedBy: approver.displayName, expiresAt }
  }

  private useOverride(actor: Actor, permission: PermissionCode, overrideId: string): Actor {
    const grant = this.deps.overrides.take(overrideId, actor.userId, permission)
    // The approver must still be active and still allowed to do this.
    const approver = grant ? this.deps.users.findById(grant.approvedBy) : null
    if (
      !approver?.active ||
      !this.deps.roles.permissionsOf(approver.roleCode).includes(permission)
    ) {
      throw new AppError(
        'FORBIDDEN',
        'That approval has expired or was already used. Ask for approval again.',
        { permission, overridable: true }
      )
    }
    return {
      ...actor,
      permissions: new Set([...actor.permissions, permission]),
      override: {
        permission,
        approvedBy: { userId: approver.userId, displayName: approver.displayName }
      }
    }
  }

  /**
   * Consumes a manager approval on a channel whose base permission (`sale.create`)
   * the actor already holds, when a secondary permission (`discount.override` or
   * `price.override`) is checked inside the service.
   */
  private useAnyOverride(actor: Actor, overrideId: string): Actor {
    const grant = this.deps.overrides.take(overrideId, actor.userId)
    if (!grant) return actor
    const approver = this.deps.users.findById(grant.approvedBy)
    if (!approver?.active) return actor
    const approverPermissions = this.deps.roles.permissionsOf(approver.roleCode)
    if (!approverPermissions.includes(grant.permission)) return actor
    return {
      ...actor,
      permissions: new Set([...actor.permissions, grant.permission]),
      override: {
        permission: grant.permission,
        approvedBy: { userId: approver.userId, displayName: approver.displayName }
      }
    }
  }

  private actorFor(user: UserRecord): Actor {
    return {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      roleCode: user.roleCode,
      permissions: new Set(this.deps.roles.permissionsOf(user.roleCode)),
      override: null
    }
  }

  private startSession(userId: number): void {
    this.deps.overrides.clear()
    this.session = { userId, locked: false }
  }

  /**
   * Verify a password with throttling. The hash is computed even for unknown
   * usernames, so response time doesn't reveal which usernames exist.
   */
  private async checkPassword(
    username: string,
    password: string,
    wrongMessage: string,
    failure: Pick<AuditEntry, 'action' | 'entity' | 'details'> = { action: 'user.sign_in_failed' }
  ): Promise<UserRecord> {
    const { users, hasher, throttle, audit } = this.deps
    const retryAfterMs = throttle.retryAfterMs(username)
    if (retryAfterMs > 0) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a moment and try again.', {
        retryAfterMs
      })
    }
    const user = users.findByUsername(username)
    const valid = await hasher.verify(password, user?.passwordHash ?? (await this.getDummyHash()))
    if (!user || !valid || !user.active) {
      throttle.recordFailure(username)
      audit.event({
        ...failure,
        userId: user?.userId ?? null,
        details: { ...failure.details, username: username.trim().slice(0, 64) }
      })
      const lockedFor = throttle.retryAfterMs(username)
      throw new AppError(
        'UNAUTHENTICATED',
        wrongMessage,
        lockedFor > 0 ? { retryAfterMs: lockedFor } : undefined
      )
    }
    throttle.clear(username)
    return user
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash('storepro-timing-equaliser')
    return this.dummyHash
  }

  /** The session's user if they still exist and are active; ends the session otherwise. */
  private sessionUser(): UserRecord | null {
    if (!this.session) return null
    const user = this.deps.users.findById(this.session.userId)
    if (!user?.active) {
      this.session = null
      return null
    }
    return user
  }

  private requireSessionUser(): SessionUser {
    const user = this.sessionUser()
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.')
    return toSessionUser(user, this.deps.roles.permissionsOf(user.roleCode))
  }
}
