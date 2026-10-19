import { z } from 'zod'
import {
  credentialsSchema,
  enteredPassword,
  overrideRequestSchema,
  passwordChangeSchema
} from '@shared/schemas/users'
import type { AuthService } from '../../auth/authService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'auth:get-state'
  | 'auth:sign-in'
  | 'auth:sign-out'
  | 'auth:lock'
  | 'auth:unlock'
  | 'auth:change-password'
  | 'auth:approve-override'

/**
 * The session channels are public: they are how a session starts. Each one
 * checks the state it needs itself (no users yet, a locked session, ...).
 */
export function createAuthHandlers(auth: AuthService): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'auth:get-state': { access: 'public', input: z.void(), handle: () => auth.getState() },
    'auth:sign-in': {
      access: 'public',
      input: credentialsSchema,
      handle: (input) => auth.signIn(input)
    },
    'auth:sign-out': { access: 'public', input: z.void(), handle: () => auth.signOut() },
    'auth:lock': { access: 'public', input: z.void(), handle: () => auth.lock() },
    'auth:unlock': {
      access: 'public',
      input: z.object({ password: enteredPassword }),
      handle: ({ password }) => auth.unlock(password)
    },
    'auth:change-password': {
      access: 'password-change',
      beforeSetup: true,
      input: passwordChangeSchema,
      handle: (input) => auth.changePassword(input)
    },
    'auth:approve-override': {
      access: 'signed-in',
      input: overrideRequestSchema,
      handle: (input, { actor }) => auth.approveOverride(actor, input)
    }
  }
}
