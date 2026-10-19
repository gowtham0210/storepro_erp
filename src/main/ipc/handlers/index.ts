import type { Logger } from '../../logging/logger'
import type { HandlerMap } from '../serviceHost'
import { createAppHandlers, type AppHandlerDeps } from './app'
import { createLogHandlers } from './log'

export interface HandlerDeps extends AppHandlerDeps {
  logger: Logger
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createAppHandlers(deps),
    ...createLogHandlers(deps.logger.child('renderer'))
  }
}
