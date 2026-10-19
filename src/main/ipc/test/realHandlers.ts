import type { Testbed } from '../../auth/test/testbed'
import { createTestLogger } from '../../test/helpers'
import { createHandlers } from '../handlers'
import type { HandlerMap } from '../serviceHost'
import { createIpcHarness, type IpcHarness } from './harness'

/** Every real handler, wired to a testbed's services, behind the real service host. */
export function createRealIpc(bed: Testbed): IpcHarness & { handlers: HandlerMap } {
  const handlers = createHandlers({
    logger: createTestLogger(),
    getAppInfo: () => ({
      name: 'StorePro',
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      isPackaged: false,
      versions: { electron: '44', chrome: '152', node: '24' }
    }),
    getStartupStatus: () => ({
      recoveredFromUncleanShutdown: false,
      previousSessionStartedAt: null
    }),
    auth: bed.auth,
    users: bed.userService,
    auditLog: bed.auditLogService
  })
  return { handlers, ...createIpcHarness(handlers, { authorizer: bed.auth }) }
}
