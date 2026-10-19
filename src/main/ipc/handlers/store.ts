import { z } from 'zod'
import { newAdministratorSchema } from '@shared/schemas/users'
import { storeProfileSchema } from '@shared/schemas/store'
import type { StoreService } from '../../store/storeService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'setup:get-options'
  | 'setup:complete'
  | 'setup:complete-store'
  | 'store:get-profile'
  | 'store:update'

export function createStoreHandlers(store: StoreService): { [C in Channel]: HandlerDefinition<C> } {
  return {
    // Reference data for the setup wizard, needed before anyone can sign in.
    'setup:get-options': { access: 'public', input: z.void(), handle: () => store.options() },
    // First run only: the service refuses once a store or a user exists.
    'setup:complete': {
      access: 'public',
      input: z.object({ store: storeProfileSchema, administrator: newAdministratorSchema }),
      handle: (input) => store.completeSetup(input)
    },
    'setup:complete-store': {
      access: 'settings.edit',
      beforeSetup: true,
      input: storeProfileSchema,
      handle: (input, { actor }) => store.completeStore(actor, input)
    },
    // Everyone needs the store's currency and time zone to read the screens.
    'store:get-profile': {
      access: 'signed-in',
      beforeSetup: true,
      input: z.void(),
      handle: () => store.getProfile()
    },
    'store:update': {
      access: 'settings.edit',
      input: storeProfileSchema,
      handle: (input, { actor }) => store.update(actor, input)
    }
  }
}
