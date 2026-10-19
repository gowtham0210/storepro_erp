import { z } from 'zod'
import type { ConnectivityMonitor } from '../../connectivity/connectivityMonitor'
import type { HandlerDefinition } from '../serviceHost'

export function createConnectivityHandlers(monitor: ConnectivityMonitor): {
  'connectivity:get-status': HandlerDefinition<'connectivity:get-status'>
} {
  return {
    // The header shows it; later changes arrive as 'connectivity:changed' events.
    'connectivity:get-status': {
      access: 'signed-in',
      input: z.void(),
      handle: () => monitor.status()
    }
  }
}
