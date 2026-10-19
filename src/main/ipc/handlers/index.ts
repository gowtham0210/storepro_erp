import type { AuditLogService } from '../../audit/auditLogService'
import type { AuthService } from '../../auth/authService'
import type { Logger } from '../../logging/logger'
import type { UserService } from '../../users/userService'
import type { HandlerMap } from '../serviceHost'
import { createAppHandlers, type AppHandlerDeps } from './app'
import { createAuditHandlers } from './audit'
import { createAuthHandlers } from './auth'
import { createLogHandlers } from './log'
import { createUserHandlers } from './users'

export interface HandlerDeps extends AppHandlerDeps {
  logger: Logger
  auth: AuthService
  users: UserService
  auditLog: AuditLogService
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createAppHandlers(deps),
    ...createLogHandlers(deps.logger.child('renderer')),
    ...createAuthHandlers(deps.auth),
    ...createUserHandlers(deps.users),
    ...createAuditHandlers(deps.auditLog)
  }
}
