import {
  customerActiveSchema,
  customerInputSchema,
  customerListFilterSchema,
  customerPurchasesSchema,
  customerUpdateSchema
} from '@shared/schemas/customers'
import type { CustomerService } from '../../customers/customerService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'customers:list'
  | 'customers:create'
  | 'customers:update'
  | 'customers:set-active'
  | 'customers:purchases'

export function createCustomerHandlers(customers: CustomerService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'customers:list': {
      access: 'customer.view',
      input: customerListFilterSchema,
      handle: (input, { actor }) => customers.list(actor, input)
    },
    'customers:create': {
      access: 'customer.manage',
      input: customerInputSchema,
      handle: (input, { actor }) => customers.create(actor, input)
    },
    'customers:update': {
      access: 'customer.manage',
      input: customerUpdateSchema,
      handle: (input, { actor }) => customers.update(actor, input)
    },
    'customers:set-active': {
      access: 'customer.manage',
      input: customerActiveSchema,
      handle: (input, { actor }) => customers.setActive(actor, input)
    },
    'customers:purchases': {
      access: 'customer.view',
      input: customerPurchasesSchema,
      handle: (input, { actor }) => customers.purchases(actor, input)
    }
  }
}
