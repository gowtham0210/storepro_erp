import type { Database } from '../../db/database'
import { AuditLog } from '../../audit/auditLog'
import { AuditLogReader } from '../../audit/auditLogReader'
import { AuditLogService } from '../../audit/auditLogService'
import { createTestLogger } from '../../test/helpers'
import { ModuleRepository } from '../../modules/moduleRepository'
import { ModuleService } from '../../modules/moduleService'
import { StoreRepository } from '../../store/storeRepository'
import { StoreService } from '../../store/storeService'
import { UserRepository } from '../../users/userRepository'
import { UserService } from '../../users/userService'
import type { Actor } from '../access'
import { AuthService } from '../authService'
import { LoginThrottle } from '../loginThrottle'
import { OverrideGrants } from '../overrideGrants'
import { PasswordHasher } from '../passwords'
import { RoleRepository } from '../roleRepository'

/** Cheap scrypt parameters for tests; production uses DEFAULT_PARAMS (ln=17). */
export const TEST_HASH_PARAMS = { ln: 10, r: 8, p: 1 }

export interface Testbed {
  auth: AuthService
  userService: UserService
  users: UserRepository
  roles: RoleRepository
  overrides: OverrideGrants
  throttle: LoginThrottle
  hasher: PasswordHasher
  clock: { time: number; now(): number }
  auditLog: AuditLog
  auditLogService: AuditLogService
  storeService: StoreService
  stores: StoreRepository
  moduleService: ModuleService
  /** The signed-in user as the service host resolves them for a request. */
  actor(): Actor
  audit: () => {
    action: string
    user_id: number | null
    approved_by_user_id: number | null
    entity_id: number | null
    details: string | null
  }[]
}

export function createTestbed(db: Database, hashParams = TEST_HASH_PARAMS): Testbed {
  const clock = { time: Date.UTC(2026, 9, 19, 4, 30), now: () => clock.time }
  const audit = new AuditLog(db, clock)
  const users = new UserRepository(db, clock)
  const roles = new RoleRepository(db, clock)
  const overrides = new OverrideGrants(clock)
  const hasher = new PasswordHasher(hashParams)
  const throttle = new LoginThrottle(db, clock)
  const auth = new AuthService({
    db,
    users,
    roles,
    overrides,
    hasher,
    throttle,
    audit,
    logger: createTestLogger()
  })
  const userService = new UserService({ db, users, roles, hasher, throttle, audit })
  const stores = new StoreRepository(db, clock)
  const storeService = new StoreService({ db, store: stores, auth, audit })
  return {
    auth,
    userService,
    users,
    roles,
    overrides,
    throttle,
    hasher,
    clock,
    auditLog: audit,
    auditLogService: new AuditLogService(new AuditLogReader(db, clock)),
    storeService,
    stores,
    moduleService: new ModuleService({ db, modules: new ModuleRepository(db, clock), audit }),
    actor: () => {
      const actor = auth.authorize('signed-in')
      if (!actor) throw new Error('authorize returned no actor')
      return actor
    },
    audit: () =>
      db.all(
        `SELECT action, user_id, approved_by_user_id, entity_id, details
         FROM audit_logs ORDER BY audit_log_id`
      )
  }
}

export const OWNER = { username: 'owner', displayName: 'Ravi Kumar', password: 'counter-top-42' }
