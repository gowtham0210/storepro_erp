import { z } from 'zod'
import { MODULES, type ModuleCode } from '@shared/modules'
import type { ModuleService } from '../../modules/moduleService'
import type { HandlerDefinition } from '../serviceHost'

type Channel = 'modules:list' | 'modules:set-enabled'

const moduleCode = z.enum(MODULES.map((m) => m.code) as [ModuleCode, ...ModuleCode[]])

export function createModuleHandlers(modules: ModuleService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'modules:list': { access: 'signed-in', input: z.void(), handle: () => modules.list() },
    'modules:set-enabled': {
      access: 'settings.edit',
      input: z.object({ code: moduleCode, enabled: z.boolean() }),
      handle: (input, { actor }) => modules.setEnabled(actor, input)
    }
  }
}
