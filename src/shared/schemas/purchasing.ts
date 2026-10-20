/**
 * Validation for suppliers, purchase orders, goods receipts and cost history
 * (M15), shared by the purchasing screens and the main-process handlers.
 * Rules that need the database (the supplier is active, the item is tracked,
 * a unit's fraction rule, the order is still open) are checked again by
 * PurchaseService inside its transaction.
 */
import { z } from 'zod'
import { QUANTITY_SCALE } from '../quantity'
import { optionalEmail, optionalText, requiredText } from '../validation'

const id = z.number().int().positive()
const MAX_QUANTITY_MILLI = 1_000_000 * QUANTITY_SCALE
const MAX_UNIT_COST_MINOR = 1_000_000_000

export const SUPPLIER_STATUS_FILTERS = ['active', 'archived', 'all'] as const
export const PURCHASE_ORDER_STATUSES = ['draft', 'confirmed', 'closed', 'cancelled'] as const
export const PURCHASE_ORDER_STATUS_FILTERS = ['all', ...PURCHASE_ORDER_STATUSES] as const
export const GOODS_RECEIPT_STATUS_FILTERS = ['all', 'draft', 'posted'] as const

const optionalPhone = z.union([
  z.null(),
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(
      z
        .string()
        .refine((value) => /^[+()\d\s-]+$/.test(value), 'Use digits, spaces, + and - only')
        .refine((value) => {
          const digits = value.replace(/\D/g, '').length
          return digits >= 7 && digits <= 15
        }, 'Phone numbers have 7 to 15 digits')
        .nullable()
    )
])

export const supplierInputSchema = z.object({
  name: requiredText('the supplier name', 120),
  contactPerson: optionalText('the contact person', 80),
  phone: optionalPhone,
  email: z.union([z.null(), optionalEmail()]),
  address: optionalText('the address', 300),
  taxRegistrationNumber: optionalText('the tax number', 30)
})

export const supplierUpdateSchema = supplierInputSchema.extend({ supplierId: id })

export const supplierActiveSchema = z.object({ supplierId: id, active: z.boolean() })

export const supplierListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(SUPPLIER_STATUS_FILTERS).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const purchaseLineSchema = z.object({
  variantId: id,
  quantityMilli: z
    .number()
    .int('Quantity must be in whole thousandths')
    .min(1, 'Enter a quantity above zero')
    .max(MAX_QUANTITY_MILLI, 'Quantity is too large'),
  unitCostMinor: z
    .number()
    .int('Cost must be in whole minor units')
    .min(0, "Cost can't be negative")
    .max(MAX_UNIT_COST_MINOR, 'Cost is too large')
})

const purchaseLines = z
  .array(purchaseLineSchema)
  .min(1, 'Add at least one item')
  .max(300, 'At most 300 items fit on one document')
  .superRefine((lines, ctx) => {
    const seen = new Set<number>()
    lines.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'variantId'],
          message: 'This item is listed twice'
        })
      }
      seen.add(line.variantId)
    })
  })

export const purchaseOrderInputSchema = z.object({
  purchaseOrderId: id.optional(),
  supplierId: id,
  notes: optionalText('a note', 300),
  lines: purchaseLines,
  confirm: z.boolean().optional()
})

export const purchaseOrderIdSchema = z.object({ purchaseOrderId: id })

export const purchaseOrderCancelSchema = z.object({
  purchaseOrderId: id,
  reason: optionalText('the reason', 200).optional()
})

/** A calendar date as people enter it: YYYY-MM-DD, and a real day. */
const calendarDate = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as day, month and year')
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`)
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
      }, 'Enter a real date')
      .nullable()
  )

export const goodsReceiptInputSchema = z.object({
  goodsReceiptId: id.optional(),
  supplierId: id,
  purchaseOrderId: id.nullable(),
  supplierInvoiceNumber: optionalText('the supplier bill number', 40),
  supplierInvoiceDate: calendarDate.nullable(),
  lines: purchaseLines,
  /** Post now: adds the goods to stock. Otherwise the receipt is saved as a draft. */
  post: z.boolean(),
  /** On posting, set each item's cost price to what was paid. */
  updateCosts: z.boolean().optional()
})

export const goodsReceiptPostSchema = z.object({
  goodsReceiptId: id,
  updateCosts: z.boolean().optional()
})

export const goodsReceiptIdSchema = z.object({ goodsReceiptId: id })

export const purchaseOrderListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(PURCHASE_ORDER_STATUS_FILTERS).optional(),
  supplierId: id.optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const goodsReceiptListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(GOODS_RECEIPT_STATUS_FILTERS).optional(),
  supplierId: id.optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const costHistorySchema = z.object({
  variantId: id,
  limit: z.number().int().min(1).max(200).optional()
})
