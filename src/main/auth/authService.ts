import type {
  AuthState,
  Credentials,
  NewAdministrator,
  PasswordChange,
  SessionUser
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { passwordProblem } from '@shared/passwordPolicy'
import type { AuditLog } from '../audit/auditLog'
import type { Database } from '../db/database'
import type { Logger } from '../logging/logger'
import { toSessionUser, type UserRecord, type UserRepository } from '../users/userRepository'
import type { LoginThrottle } from './loginThrottle'
import type { PasswordHasher } from './passwords'

export interface AuthServiceDeps {
  db: Database
  users: UserRepository
  hasher: PasswordHasher
  throttle: LoginThrottle
  audit: AuditLog
  logger: Logger
}

const WRONG_CREDENTIALS = 'The username or password is incorrect.'

/**
 * Sign-in and the session (M05-02, M05-03). There is one session per app: the
 * person at this computer. It lives only in the main process and ends when the
 * app closes. The renderer is told who is signed in but never holds a token
 * it could leak.
 */
export class AuthService {
  private session: { userId: number; locked: boolean } | null = null
  private dummyHash: Promise<string> | null = null

  constructor(private readonly deps: AuthServiceDeps) {}

  getState(): AuthState {
    const user = this.sessionUser()
    if (!user)
      return this.deps.users.count() === 0 ? { status: 'setup-required' } : { status: 'signed-out' }
    return { status: this.session?.locked ? 'locked' : 'signed-in', user: toSessionUser(user) }
  }

  /** First run only (M05-04): creates the first administrator and signs them in. */
  async createInitialAdmin(input: NewAdministrator): Promise<SessionUser> {
    const { db, users, hasher, audit } = this.deps
    if (users.count() > 0) throw new AppError('CONFLICT', 'StorePro already has an administrator.')
    const passwordHash = await hasher.hash(input.password)
    const userId = db.transaction(() => {
      // Checked again inside the transaction: two windows can't both win.
      if (users.count() > 0)
        throw new AppError('CONFLICT', 'StorePro already has an administrator.')
      const id = users.create({ ...input, roleCode: 'administrator', passwordHash })
      users.recordSignIn(id)
      audit.record({
        action: 'user.created',
        userId: id,
        entity: { type: 'user', id },
        details: { roleCode: 'administrator', initialSetup: true }
      })
      audit.record({ action: 'user.sign_in', userId: id, entity: { type: 'user', id } })
      return id
    })
    this.session = { userId, locked: false }
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
      audit.record({
        action: 'user.sign_in',
        userId: user.userId,
        entity: { type: 'user', id: user.userId }
      })
    })
    this.session = { userId: user.userId, locked: false }
    return this.requireSessionUser()
  }

  signOut(): void {
    const userId = this.session?.userId
    this.session = null
    if (userId !== undefined) {
      this.deps.audit.record({
        action: 'user.sign_out',
        userId,
        entity: { type: 'user', id: userId }
      })
    }
  }

  /** Lock the screen without signing out (Ctrl+L, or after inactivity). */
  lock(): void {
    if (this.session && this.sessionUser()) this.session.locked = true
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
      this.deps.audit.record({
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
   * needs a user goes through this (or requireAdministrator).
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

  /** Until M06 introduces permissions, managing users is for administrators. */
  requireAdministrator(): UserRecord {
    const user = this.requireUser()
    if (user.roleCode !== 'administrator') {
      throw new AppError('FORBIDDEN', 'Only an administrator can do this.')
    }
    return user
  }

  /**
   * Verify a password with throttling. The hash is computed even for unknown
   * usernames, so response time doesn't reveal which usernames exist.
   */
  private async checkPassword(
    username: string,
    password: string,
    wrongMessage: string
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
      audit.record({
        action: 'user.sign_in_failed',
        userId: user?.userId ?? null,
        details: { username: username.trim().slice(0, 64) }
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
    return toSessionUser(user)
  }
}
