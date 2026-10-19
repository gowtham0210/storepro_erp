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
    'users:list': {
      access: 'user.manage',
      input: z.void(),
      handle: (_, { actor }) => users.list(actor)
    },
    'users:list-roles': {
      access: 'user.manage',
      input: z.void(),
      handle: (_, { actor }) => users.listRoles(actor)
    },
    'users:create': {
      access: 'user.manage',
      input: newUserSchema,
      handle: (input, { actor }) => users.create(actor, input)
    },
    'users:update': {
      access: 'user.manage',
      input: userUpdateSchema,
      handle: (input, { actor }) => users.update(actor, input)
    },
    'users:set-active': {
      access: 'user.manage',
      input: setActiveSchema,
      handle: (input, { actor }) => users.setActive(actor, input)
    },
    'users:reset-password': {
      access: 'user.manage',
      input: passwordResetSchema,
      handle: (input, { actor }) => users.resetPassword(actor, input)
    }
  }
}
