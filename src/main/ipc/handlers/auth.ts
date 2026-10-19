import { z } from 'zod'
import {
  credentialsSchema,
  enteredPassword,
  newAdministratorSchema,
  passwordChangeSchema
} from '@shared/schemas/users'
import type { AuthService } from '../../auth/authService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'auth:get-state'
  | 'auth:create-initial-admin'
  | 'auth:sign-in'
  | 'auth:sign-out'
  | 'auth:lock'
  | 'auth:unlock'
  | 'auth:change-password'

export function createAuthHandlers(auth: AuthService): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'auth:get-state': { input: z.void(), handle: () => auth.getState() },
    'auth:create-initial-admin': {
      input: newAdministratorSchema,
      handle: (input) => auth.createInitialAdmin(input)
    },
    'auth:sign-in': { input: credentialsSchema, handle: (input) => auth.signIn(input) },
    'auth:sign-out': { input: z.void(), handle: () => auth.signOut() },
    'auth:lock': { input: z.void(), handle: () => auth.lock() },
    'auth:unlock': {
      input: z.object({ password: enteredPassword }),
      handle: ({ password }) => auth.unlock(password)
    },
    'auth:change-password': {
      input: passwordChangeSchema,
      handle: (input) => auth.changePassword(input)
    }
  }
}
