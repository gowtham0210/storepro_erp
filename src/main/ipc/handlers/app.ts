import { z } from 'zod'
import type { AppInfo, StartupStatus } from '@shared/ipc/contract'
import type { HandlerDefinition } from '../serviceHost'

export interface AppHandlerDeps {
  getAppInfo(): AppInfo
  getStartupStatus(): StartupStatus
}

export function createAppHandlers(deps: AppHandlerDeps): {
  'app:get-info': HandlerDefinition<'app:get-info'>
  'app:get-startup-status': HandlerDefinition<'app:get-startup-status'>
} {
  return {
    'app:get-info': {
      input: z.void(),
      handle: () => deps.getAppInfo()
    },
    'app:get-startup-status': {
      input: z.void(),
      handle: () => deps.getStartupStatus()
    }
  }
}
