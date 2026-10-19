import type { AuditLogService } from '../../audit/auditLogService'
import type { AuthService } from '../../auth/authService'
import type { ModuleService } from '../../modules/moduleService'
import type { StoreService } from '../../store/storeService'
import type { Logger } from '../../logging/logger'
import type { UserService } from '../../users/userService'
import type { HandlerMap } from '../serviceHost'
import { createAppHandlers, type AppHandlerDeps } from './app'
import { createAuditHandlers } from './audit'
import { createAuthHandlers } from './auth'
import { createLogHandlers } from './log'
import { createModuleHandlers } from './modules'
import { createStoreHandlers } from './store'
import { createUserHandlers } from './users'

export interface HandlerDeps extends AppHandlerDeps {
  logger: Logger
  auth: AuthService
  users: UserService
  auditLog: AuditLogService
  store: StoreService
  modules: ModuleService
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createAppHandlers(deps),
    ...createLogHandlers(deps.logger.child('renderer')),
    ...createAuthHandlers(deps.auth),
    ...createUserHandlers(deps.users),
    ...createAuditHandlers(deps.auditLog),
    ...createStoreHandlers(deps.store),
    ...createModuleHandlers(deps.modules)
  }
}
