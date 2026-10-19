import { z } from 'zod'
import {
  newUserSchema,
  passwordResetSchema,
  setActiveSchema,
  userUpdateSchema
} from '@shared/schemas/users'
import type { UserService } from '../../users/userService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'users:list'
  | 'users:list-roles'
  | 'users:create'
  | 'users:update'
  | 'users:set-active'
  | 'users:reset-password'

export function createUserHandlers(users: UserService): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'users:list': { input: z.void(), handle: () => users.list() },
    'users:list-roles': { input: z.void(), handle: () => users.listRoles() },
    'users:create': { input: newUserSchema, handle: (input) => users.create(input) },
    'users:update': { input: userUpdateSchema, handle: (input) => users.update(input) },
    'users:set-active': { input: setActiveSchema, handle: (input) => users.setActive(input) },
    'users:reset-password': {
      input: passwordResetSchema,
      handle: (input) => users.resetPassword(input)
    }
  }
}
