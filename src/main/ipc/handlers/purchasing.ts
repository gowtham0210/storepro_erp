import {
  costHistorySchema,
  goodsReceiptIdSchema,
  goodsReceiptInputSchema,
  goodsReceiptListFilterSchema,
  goodsReceiptPostSchema,
  purchaseOrderCancelSchema,
  purchaseOrderIdSchema,
  purchaseOrderInputSchema,
  purchaseOrderListFilterSchema,
  supplierActiveSchema,
  supplierInputSchema,
  supplierListFilterSchema,
  supplierUpdateSchema
} from '@shared/schemas/purchasing'
import type { PurchaseService } from '../../purchasing/purchaseService'
import type { SupplierService } from '../../purchasing/supplierService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'suppliers:list'
  | 'suppliers:create'
  | 'suppliers:update'
  | 'suppliers:set-active'
  | 'purchases:list-orders'
  | 'purchases:get-order'
  | 'purchases:save-order'
  | 'purchases:confirm-order'
  | 'purchases:cancel-order'
  | 'purchases:close-order'
  | 'purchases:delete-order'
  | 'purchases:list-receipts'
  | 'purchases:get-receipt'
  | 'purchases:save-receipt'
  | 'purchases:post-receipt'
  | 'purchases:delete-receipt'
  | 'purchases:cost-history'

export function createPurchasingHandlers(
  suppliers: SupplierService,
  purchases: PurchaseService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'suppliers:list': {
      access: 'supplier.view',
      input: supplierListFilterSchema,
      handle: (input, { actor }) => suppliers.list(actor, input)
    },
    'suppliers:create': {
      access: 'supplier.manage',
      input: supplierInputSchema,
      handle: (input, { actor }) => suppliers.create(actor, input)
    },
    'suppliers:update': {
      access: 'supplier.manage',
      input: supplierUpdateSchema,
      handle: (input, { actor }) => suppliers.update(actor, input)
    },
    'suppliers:set-active': {
      access: 'supplier.manage',
      input: supplierActiveSchema,
      handle: (input, { actor }) => suppliers.setActive(actor, input)
    },
    'purchases:list-orders': {
      access: 'purchase.view',
      input: purchaseOrderListFilterSchema,
      handle: (input, { actor }) => purchases.listOrders(actor, input)
    },
    'purchases:get-order': {
      access: 'purchase.view',
      input: purchaseOrderIdSchema,
      handle: (input, { actor }) => purchases.getOrder(actor, input)
    },
    'purchases:save-order': {
      access: 'purchase.manage',
      input: purchaseOrderInputSchema,
      handle: (input, { actor }) => purchases.saveOrder(actor, input)
    },
    'purchases:confirm-order': {
      access: 'purchase.manage',
      input: purchaseOrderIdSchema,
      handle: (input, { actor }) => purchases.confirmOrder(actor, input)
    },
    'purchases:cancel-order': {
      access: 'purchase.manage',
      input: purchaseOrderCancelSchema,
      handle: (input, { actor }) => purchases.cancelOrder(actor, input)
    },
    'purchases:close-order': {
      access: 'purchase.manage',
      input: purchaseOrderIdSchema,
      handle: (input, { actor }) => purchases.closeOrder(actor, input)
    },
    'purchases:delete-order': {
      access: 'purchase.manage',
      input: purchaseOrderIdSchema,
      handle: (input, { actor }) => purchases.deleteOrder(actor, input)
    },
    'purchases:list-receipts': {
      access: 'purchase.view',
      input: goodsReceiptListFilterSchema,
      handle: (input, { actor }) => purchases.listReceipts(actor, input)
    },
    'purchases:get-receipt': {
      access: 'purchase.view',
      input: goodsReceiptIdSchema,
      handle: (input, { actor }) => purchases.getReceipt(actor, input)
    },
    'purchases:save-receipt': {
      access: 'purchase.manage',
      input: goodsReceiptInputSchema,
      handle: (input, { actor }) => purchases.saveReceipt(actor, input)
    },
    'purchases:post-receipt': {
      access: 'purchase.manage',
      input: goodsReceiptPostSchema,
      handle: (input, { actor }) => purchases.postReceipt(actor, input)
    },
    'purchases:delete-receipt': {
      access: 'purchase.manage',
      input: goodsReceiptIdSchema,
      handle: (input, { actor }) => purchases.deleteReceipt(actor, input)
    },
    'purchases:cost-history': {
      access: 'purchase.view',
      input: costHistorySchema,
      handle: (input, { actor }) => purchases.costHistory(actor, input)
    }
  }
}
