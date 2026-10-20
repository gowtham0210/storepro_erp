/**
 * Validation for report requests (M19), shared by the reports screen and the
 * main-process handlers. A report covers whole business dates at the store,
 * both ends included.
 */
import { z } from 'zod'
import { MAX_REPORT_DAYS } from '../reports'
import { MOVEMENT_TYPES, STOCK_LEVEL_FILTERS } from './inventory'
import { isBusinessDate } from '../storeTime'

export const TOP_PRODUCT_RANKS = ['quantity', 'value'] as const

const businessDate = z
  .string()
  .trim()
  .refine((value) => isBusinessDate(value), 'Enter a real date')

/** Whole days between two business dates (calendar arithmetic, so no time zone is involved). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** A period: `from` on or before `to`, and no longer than a report can show. */
function checkRange(value: { from: string; to: string }, ctx: z.RefinementCtx): void {
  if (!isBusinessDate(value.from) || !isBusinessDate(value.to)) return
  const days = daysBetween(value.from, value.to)
  if (days < 0) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start date' })
  } else if (days + 1 > MAX_REPORT_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose at most ${MAX_REPORT_DAYS} days at a time`
    })
  }
}

export const reportRangeSchema = z
  .object({ from: businessDate, to: businessDate })
  .superRefine(checkRange)

export const topProductsSchema = z
  .object({
    from: businessDate,
    to: businessDate,
    rankBy: z.enum(TOP_PRODUCT_RANKS, { message: 'Choose how to rank products' }),
    limit: z.number().int().min(1).max(200).optional()
  })
  .superRefine(checkRange)

const id = z.number().int().positive()
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional()
}

export const stockReportSchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: id.optional(),
  level: z.enum(STOCK_LEVEL_FILTERS).optional(),
  ...page
})

export const stockMovementsReportSchema = z
  .object({
    from: businessDate,
    to: businessDate,
    movementType: z.enum(MOVEMENT_TYPES).optional(),
    ...page
  })
  .superRefine(checkRange)

const exportFilters = {
  search: z.string().max(200).optional(),
  categoryId: id.optional(),
  level: z.enum(STOCK_LEVEL_FILTERS).optional()
}

/** What to export: a report and the choices on its screen, without paging. */
export const reportExportSchema = z.discriminatedUnion('report', [
  z
    .object({ report: z.literal('sales'), from: businessDate, to: businessDate })
    .superRefine(checkRange),
  z
    .object({
      report: z.literal('top-products'),
      from: businessDate,
      to: businessDate,
      rankBy: z.enum(TOP_PRODUCT_RANKS, { message: 'Choose how to rank products' })
    })
    .superRefine(checkRange),
  z.object({ report: z.literal('stock'), ...exportFilters }),
  z
    .object({
      report: z.literal('stock-movements'),
      from: businessDate,
      to: businessDate,
      movementType: z.enum(MOVEMENT_TYPES).optional()
    })
    .superRefine(checkRange),
  z
    .object({
      report: z.literal('purchases'),
      from: businessDate,
      to: businessDate,
      supplierId: id.optional()
    })
    .superRefine(checkRange),
  z
    .object({ report: z.literal('expenses'), from: businessDate, to: businessDate })
    .superRefine(checkRange)
])

export const purchasesReportSchema = z
  .object({ from: businessDate, to: businessDate, supplierId: id.optional(), ...page })
  .superRefine(checkRange)
