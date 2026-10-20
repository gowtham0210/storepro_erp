import {
  findReturnSaleSchema,
  returnIdSchema,
  returnInputSchema,
  returnListFilterSchema,
  returnReceiptPrintSchema,
  returnReceiptSchema
} from '@shared/schemas/returns'
import type { ReturnService } from '../../returns/returnService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'returns:find-sale'
  | 'returns:create'
  | 'returns:list'
  | 'returns:get'
  | 'returns:preview-receipt'
  | 'returns:print-receipt'

export function createReturnHandlers(returns: ReturnService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'returns:find-sale': {
      access: 'sale.view',
      input: findReturnSaleSchema,
      handle: (input, { actor }) => returns.findSale(actor, input)
    },
    'returns:create': {
      access: 'return.create',
      overridable: true,
      input: returnInputSchema,
      handle: (input, { actor }) => returns.create(actor, input)
    },
    'returns:list': {
      access: 'sale.view',
      input: returnListFilterSchema,
      handle: (input, { actor }) => returns.list(actor, input)
    },
    'returns:get': {
      access: 'sale.view',
      input: returnIdSchema,
      handle: (input, { actor }) => returns.get(actor, input)
    },
    'returns:preview-receipt': {
      access: 'sale.view',
      input: returnReceiptSchema,
      handle: (input, { actor }) => returns.previewReceipt(actor, input)
    },
    'returns:print-receipt': {
      access: 'sale.view',
      overridable: true,
      input: returnReceiptPrintSchema,
      handle: (input, { actor }) => returns.printReceipt(actor, input)
    }
  }
}
