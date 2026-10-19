/**
 * Validation for stock levels, adjustments, physical stock counts and movement
 * history (M14), shared by the inventory screens and main-process handlers.
 * Database-dependent rules (tracksInventory, unit fraction rules, negative
 * stock policy) are enforced by InventoryService inside its transaction.
 */
import { z } from 'zod'
import { QUANTITY_SCALE } from '../quantity'
import { optionalText } from '../validation'

const id = z.number().int().positive()
const MAX_QUANTITY_MILLI = 1_000_000 * QUANTITY_SCALE

export const ADJUSTMENT_REASON_CODES = [
  'opening_stock',
  'count_correction',
  'damage',
  'expiry',
  'theft_loss',
  'other'
] as const

export const STOCK_LEVEL_FILTERS = ['all', 'low', 'out'] as const

export const MOVEMENT_TYPES = [
  'sale',
  'sale_void',
  'sale_return',
  'goods_receipt',
  'adjustment'
] as const

export const adjustmentReasonCodeSchema = z.enum(ADJUSTMENT_REASON_CODES, {
  message: 'Choose a reason for the adjustment'
})

export const stockAdjustmentLineSchema = z.object({
  variantId: id,
  quantityDeltaMilli: z
    .number()
    .int('Quantity change must be in whole thousandths')
    .min(-MAX_QUANTITY_MILLI, 'Quantity change is too large')
    .max(MAX_QUANTITY_MILLI, 'Quantity change is too large')
    .refine((value) => value !== 0, 'Enter a quantity change other than zero')
})

export const stockAdjustmentSchema = z
  .object({
    reasonCode: adjustmentReasonCodeSchema,
    notes: optionalText('a note', 300),
    items: z
      .array(stockAdjustmentLineSchema)
      .min(1, 'Choose at least one item to adjust')
      .max(200, 'At most 200 items can be adjusted at once')
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>()
    value.items.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'variantId'],
          message: 'This item is listed twice'
        })
      }
      seen.add(line.variantId)
    })
  })

export const stockCountLineSchema = z.object({
  variantId: id,
  countedMilli: z
    .number()
    .int('Counted quantity must be in whole thousandths')
    .min(0, "Counted quantity can't be negative")
    .max(MAX_QUANTITY_MILLI, 'Counted quantity is too large')
})

export const stockCountSchema = z
  .object({
    notes: optionalText('a note', 300),
    items: z
      .array(stockCountLineSchema)
      .min(1, 'Enter the counted quantity for at least one item')
      .max(500, 'At most 500 items can be counted at once')
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>()
    value.items.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'variantId'],
          message: 'This item is listed twice'
        })
      }
      seen.add(line.variantId)
    })
  })

export const stockListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: id.optional(),
  level: z.enum(STOCK_LEVEL_FILTERS).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const movementListFilterSchema = z.object({
  variantId: id,
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const adjustmentListFilterSchema = z.object({
  reasonCode: adjustmentReasonCodeSchema.optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})
