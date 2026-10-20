/**
 * Validation for customer returns and refunds (M16), shared by the return
 * screen and the main-process handlers. Rules that need the database (the
 * invoice isn't voided, how much can still be returned, the refund methods
 * are active, the refund adds up) are checked again by ReturnService inside
 * its transaction, using the same `quoteReturn` the screen shows.
 */
import { z } from 'zod'
import { QUANTITY_SCALE } from '../quantity'
import { RETURN_DISPOSITIONS } from '../returns'
import { optionalText } from '../validation'
import { overrideId } from './users'

const id = z.number().int().positive()
const MAX_QUANTITY_MILLI = 1_000_000 * QUANTITY_SCALE

export const returnLineSchema = z.object({
  saleItemId: id,
  quantityMilli: z
    .number()
    .int('Quantity must be in whole thousandths')
    .min(1, 'Enter a quantity above zero')
    .max(MAX_QUANTITY_MILLI, 'Quantity is too large'),
  disposition: z.enum(RETURN_DISPOSITIONS, { message: 'Choose what happens to the goods' })
})

export const returnRefundSchema = z.object({
  paymentMethodId: id,
  amountMinor: z
    .number()
    .int('Amount must be in whole minor units')
    .min(1, 'Enter an amount above zero')
    .max(100_000_000_000, 'Amount is too large'),
  reference: optionalText('the reference', 60).optional()
})

export const returnInputSchema = z.object({
  saleId: id,
  reason: optionalText('the reason', 200),
  lines: z
    .array(returnLineSchema)
    .min(1, 'Choose at least one item to return')
    .max(200, 'At most 200 lines fit on one return'),
  refunds: z.array(returnRefundSchema).max(6, 'At most 6 refund methods'),
  overrideId
})

export const findReturnSaleSchema = z.object({
  invoiceNumber: z.string().trim().min(1, 'Enter an invoice number').max(40)
})

export const returnListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const returnIdSchema = z.object({ saleReturnId: id })

export const returnReceiptSchema = z.object({
  saleReturnId: id,
  isReprint: z.boolean().optional()
})

export const returnReceiptPrintSchema = returnReceiptSchema.extend({ overrideId })
