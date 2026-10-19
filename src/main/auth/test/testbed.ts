import type { Database } from '../../db/database'
import { AuditLog } from '../../audit/auditLog'
import { createTestLogger } from '../../test/helpers'
import { UserRepository } from '../../users/userRepository'
import { UserService } from '../../users/userService'
import { AuthService } from '../authService'
import { LoginThrottle } from '../loginThrottle'
import { PasswordHasher } from '../passwords'

/** Cheap scrypt parameters for tests; production uses DEFAULT_PARAMS (ln=17). */
export const TEST_HASH_PARAMS = { ln: 10, r: 8, p: 1 }

export interface Testbed {
  auth: AuthService
  userService: UserService
  users: UserRepository
  throttle: LoginThrottle
  hasher: PasswordHasher
  clock: { time: number; now(): number }
  audit: () => {
    action: string
    user_id: number | null
    entity_id: number | null
    details: string | null
  }[]
}

export function createTestbed(db: Database, hashParams = TEST_HASH_PARAMS): Testbed {
  const clock = { time: Date.UTC(2026, 9, 19, 4, 30), now: () => clock.time }
  const audit = new AuditLog(db, clock)
  const users = new UserRepository(db, clock)
  const hasher = new PasswordHasher(hashParams)
  const throttle = new LoginThrottle(db, clock)
  const auth = new AuthService({ db, users, hasher, throttle, audit, logger: createTestLogger() })
  const userService = new UserService({ db, users, auth, hasher, throttle, audit })
  return {
    auth,
    userService,
    users,
    throttle,
    hasher,
    clock,
    audit: () =>
      db.all('SELECT action, user_id, entity_id, details FROM audit_logs ORDER BY audit_log_id')
  }
}

export const OWNER = { username: 'owner', displayName: 'Ravi Kumar', password: 'counter-top-42' }
