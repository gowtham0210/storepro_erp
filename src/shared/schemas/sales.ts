/**
 * Validation for payment methods (M12), POS checkout, held bills, voids and
 * sales history (M11), shared by the renderer and main-process handlers.
 */
import { z } from 'zod'
import { PAYMENT_KINDS } from '../payments'
import { QUANTITY_SCALE } from '../quantity'
import { optionalText, requiredText } from '../validation'
import { overrideId } from './users'

const id = z.number().int().positive()
const MAX_QUANTITY_MILLI = 1_000_000 * QUANTITY_SCALE
const MAX_PRICE_MINOR = 1_000_000_000
const MAX_PAYABLE_MINOR = 100_000_000_000

export const SALE_STATUS_FILTERS = ['all', 'completed', 'voided'] as const

export const paymentKindSchema = z.enum(PAYMENT_KINDS, {
  message: 'Choose a payment type'
})

export const paymentMethodCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a short code, e.g. "card"')
  .max(24, 'Payment method codes have at most 24 characters')
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores, starting with a letter')

export const paymentMethodCreateSchema = z.object({
  methodCode: paymentMethodCodeSchema,
  name: requiredText('a payment method name', 40),
  kind: paymentKindSchema,
  sortOrder: z.number().int().min(0).max(1000).optional()
})

export const paymentMethodUpdateSchema = z.object({
  paymentMethodId: id,
  name: requiredText('a payment method name', 40),
  kind: paymentKindSchema,
  sortOrder: z.number().int().min(0).max(1000).optional()
})

export const paymentMethodActiveSchema = z.object({
  paymentMethodId: id,
  active: z.boolean()
})

export const discountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('amount'),
    minor: z.number().int().min(0, "A discount can't be negative").max(MAX_PAYABLE_MINOR)
  }),
  z.object({
    kind: z.literal('percent'),
    bp: z.number().int().min(0, 'A discount must be between 0% and 100%').max(10_000)
  })
])

export const checkoutLineSchema = z.object({
  variantId: id,
  quantityMilli: z
    .number()
    .int('Quantity must be in whole thousandths')
    .min(1, 'Enter a quantity greater than zero')
    .max(MAX_QUANTITY_MILLI, 'Quantity is too large'),
  unitPriceMinor: z
    .number()
    .int('Price must be a whole number of minor units')
    .min(0, "Price can't be negative")
    .max(MAX_PRICE_MINOR, 'Price is too large'),
  discount: discountSchema.nullable().optional()
})

export const checkoutPaymentSchema = z.object({
  paymentMethodId: id,
  amountMinor: z
    .number()
    .int('Payment amount must be a whole number of minor units')
    .min(1, 'Enter a payment amount greater than zero')
    .max(MAX_PAYABLE_MINOR, 'Payment amount is too large'),
  tenderedMinor: z
    .number()
    .int('Cash tendered must be a whole number of minor units')
    .min(1, 'Enter cash tendered greater than zero')
    .max(MAX_PAYABLE_MINOR, 'Cash tendered is too large')
    .nullable()
    .optional(),
  reference: optionalText('a reference', 100).optional()
})

export const checkoutSchema = z.object({
  checkoutKey: z
    .string()
    .trim()
    .min(1, 'A checkout idempotency key is required')
    .max(120, 'Checkout key is too long'),
  customerId: id.nullable().optional(),
  lines: z
    .array(checkoutLineSchema)
    .min(1, 'Add at least one item to the bill')
    .max(200, 'At most 200 lines per bill'),
  billDiscount: discountSchema.nullable().optional(),
  payments: z
    .array(checkoutPaymentSchema)
    .max(10, 'At most 10 split payments per bill'),
  heldBillId: id.nullable().optional(),
  overrideId
})

export const heldBillLineSchema = z.object({
  variantId: id,
  quantityMilli: z
    .number()
    .int('Quantity must be in whole thousandths')
    .min(1, 'Enter a quantity greater than zero')
    .max(MAX_QUANTITY_MILLI, 'Quantity is too large'),
  unitPriceOverrideMinor: z
    .number()
    .int()
    .min(0)
    .max(MAX_PRICE_MINOR)
    .nullable()
    .optional(),
  discountMinor: z.number().int().min(0).max(MAX_PAYABLE_MINOR).optional()
})

export const holdBillSchema = z.object({
  label: optionalText('a label', 80),
  customerId: id.nullable().optional(),
  items: z
    .array(heldBillLineSchema)
    .min(1, 'Add at least one item before holding the bill')
    .max(200, 'At most 200 items can be held on one bill')
})

export const heldBillIdSchema = z.object({
  heldBillId: id
})

export const voidSaleSchema = z.object({
  saleId: id,
  reason: requiredText('a reason for voiding the bill', 200),
  overrideId
})

export const saleListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(SALE_STATUS_FILTERS).optional(),
  from: z.number().int().min(0).optional(),
  to: z.number().int().min(0).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const saleIdSchema = z.object({
  saleId: id
})

export const findByInvoiceSchema = z.object({
  invoiceNumber: requiredText('an invoice number', 40)
})
