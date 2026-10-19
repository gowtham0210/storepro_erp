import { z } from 'zod'
import {
  adjustmentListFilterSchema,
  movementListFilterSchema,
  stockAdjustmentSchema,
  stockCountSchema,
  stockListFilterSchema
} from '@shared/schemas/inventory'
import type { InventoryService } from '../../inventory/inventoryService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'inventory:list-reasons'
  | 'inventory:list'
  | 'inventory:movements'
  | 'inventory:adjust'
  | 'inventory:reconcile'
  | 'inventory:list-adjustments'

export function createInventoryHandlers(inventory: InventoryService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'inventory:list-reasons': {
      access: 'inventory.view',
      input: z.void(),
      handle: (_, { actor }) => inventory.listReasons(actor)
    },
    'inventory:list': {
      access: 'inventory.view',
      input: stockListFilterSchema,
      handle: (input, { actor }) => inventory.list(actor, input)
    },
    'inventory:movements': {
      access: 'inventory.view',
      input: movementListFilterSchema,
      handle: (input, { actor }) => inventory.movements(actor, input)
    },
    'inventory:adjust': {
      access: 'stock.adjust',
      input: stockAdjustmentSchema,
      handle: (input, { actor }) => inventory.adjust(actor, input)
    },
    'inventory:reconcile': {
      access: 'stock.adjust',
      input: stockCountSchema,
      handle: (input, { actor }) => inventory.reconcile(actor, input)
    },
    'inventory:list-adjustments': {
      access: 'inventory.view',
      input: adjustmentListFilterSchema,
      handle: (input, { actor }) => inventory.listAdjustments(actor, input)
    }
  }
}
