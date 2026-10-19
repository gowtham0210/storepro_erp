import { z } from 'zod'
import {
  checkoutSchema,
  findByInvoiceSchema,
  heldBillIdSchema,
  holdBillSchema,
  paymentMethodActiveSchema,
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  saleIdSchema,
  saleListFilterSchema,
  voidSaleSchema
} from '@shared/schemas/sales'
import type { PaymentService } from '../../payments/paymentService'
import type { SalesService } from '../../sales/salesService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'payments:list-methods'
  | 'payments:create-method'
  | 'payments:update-method'
  | 'payments:set-method-active'
  | 'sales:checkout'
  | 'sales:list'
  | 'sales:get'
  | 'sales:find-by-invoice'
  | 'sales:void'
  | 'sales:hold'
  | 'sales:list-held'
  | 'sales:resume-held'
  | 'sales:discard-held'

export function createSalesHandlers(
  payments: PaymentService,
  sales: SalesService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    // Everyone signed in can read active/configured payment methods for billing.
    'payments:list-methods': {
      access: 'signed-in',
      input: z.void(),
      handle: () => payments.listMethods()
    },
    'payments:create-method': {
      access: 'settings.edit',
      input: paymentMethodCreateSchema,
      handle: (input, { actor }) => payments.createMethod(actor, input)
    },
    'payments:update-method': {
      access: 'settings.edit',
      input: paymentMethodUpdateSchema,
      handle: (input, { actor }) => payments.updateMethod(actor, input)
    },
    'payments:set-method-active': {
      access: 'settings.edit',
      input: paymentMethodActiveSchema,
      handle: (input, { actor }) => payments.setMethodActive(actor, input)
    },
    'sales:checkout': {
      access: 'sale.create',
      overridable: true,
      input: checkoutSchema,
      handle: (input, { actor }) => sales.checkout(actor, input)
    },
    'sales:list': {
      access: 'sale.view',
      input: saleListFilterSchema,
      handle: (input, { actor }) => sales.list(actor, input)
    },
    'sales:get': {
      access: 'sale.view',
      input: saleIdSchema,
      handle: (input, { actor }) => sales.get(actor, input.saleId)
    },
    'sales:find-by-invoice': {
      access: 'sale.view',
      input: findByInvoiceSchema,
      handle: (input, { actor }) => sales.findByInvoice(actor, input.invoiceNumber)
    },
    'sales:void': {
      access: 'sale.void',
      overridable: true,
      input: voidSaleSchema,
      handle: (input, { actor }) => sales.voidSale(actor, input)
    },
    'sales:hold': {
      access: 'sale.create',
      input: holdBillSchema,
      handle: (input, { actor }) => sales.holdBill(actor, input)
    },
    'sales:list-held': {
      access: 'sale.create',
      input: z.void(),
      handle: (_, { actor }) => sales.listHeldBills(actor)
    },
    'sales:resume-held': {
      access: 'sale.create',
      input: heldBillIdSchema,
      handle: (input, { actor }) => sales.resumeHeldBill(actor, input.heldBillId)
    },
    'sales:discard-held': {
      access: 'sale.create',
      input: heldBillIdSchema,
      handle: (input, { actor }) => sales.discardHeldBill(actor, input.heldBillId)
    }
  }
}
