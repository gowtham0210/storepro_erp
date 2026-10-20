/**
 * Validation for expense categories and expenses (M18), shared by the expense
 * screen and the main-process handlers. Rules that need the database (the
 * category and payment method are active, the expense is not voided) are
 * checked again by ExpenseService inside its transaction.
 */
import { z } from 'zod'
import { isBusinessDate } from '../storeTime'
import { optionalText, requiredText } from '../validation'

const id = z.number().int().positive()
const MAX_EXPENSE_MINOR = 1_000_000_000_000

export const EXPENSE_STATUS_FILTERS = ['active', 'voided', 'all'] as const

export const expenseCategoryName = requiredText('a category name', 60)

/** A calendar date as people enter it: YYYY-MM-DD, and a real day. */
export const businessDate = z
  .string()
  .trim()
  .refine((value) => isBusinessDate(value), 'Enter a real date')

export const expenseInputSchema = z.object({
  expenseCategoryId: id,
  expenseDate: businessDate,
  amountMinor: z
    .number()
    .int('Amount must be in whole minor units')
    .min(1, 'Enter an amount above zero')
    .max(MAX_EXPENSE_MINOR, 'Amount is too large'),
  paymentMethodId: id,
  description: optionalText('a note', 200)
})

export const expenseUpdateSchema = expenseInputSchema.extend({ expenseId: id })

export const expenseVoidSchema = z.object({ expenseId: id, voided: z.boolean() })

export const expenseCategoryRenameSchema = z.object({
  expenseCategoryId: id,
  name: expenseCategoryName
})

export const expenseCategoryActiveSchema = z.object({
  expenseCategoryId: id,
  active: z.boolean()
})

export const expenseListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: id.optional(),
  paymentMethodId: id.optional(),
  /** Inclusive business dates, in the store's time zone. */
  from: businessDate.optional(),
  to: businessDate.optional(),
  status: z.enum(EXPENSE_STATUS_FILTERS).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})
