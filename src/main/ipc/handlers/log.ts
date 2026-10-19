import { z } from 'zod'
import type { Logger } from '../../logging/logger'
import type { HandlerDefinition } from '../serviceHost'

const rendererLogEntry = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).optional()
})

export function createLogHandlers(rendererLogger: Logger): {
  'log:write': HandlerDefinition<'log:write'>
} {
  return {
    'log:write': {
      input: rendererLogEntry,
      handle: ({ level, message, context }) => {
        rendererLogger[level](message, context)
      }
    }
  }
}
