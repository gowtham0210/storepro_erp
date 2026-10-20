/**
 * Validation for customers (M17), shared by the customer screens, the billing
 * counter's quick-add and the main-process handlers.
 */
import { z } from 'zod'
import { optionalEmail, optionalText, requiredText } from '../validation'

const id = z.number().int().positive()

export const CUSTOMER_STATUS_FILTERS = ['active', 'archived', 'all'] as const

/**
 * A phone number as stored: digits with an optional leading +, no spaces,
 * dashes or brackets. So "98400 12345", "98400-12345" and "(98400) 12345" are
 * one number, and a phone can identify one customer.
 */
export function normalizePhone(text: string): string {
  return text.trim().replace(/[\s\-().]/g, '')
}

const optionalCustomerPhone = z.union([
  z.null(),
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : normalizePhone(value)))
    .pipe(
      z
        .string()
        .regex(/^\+?\d{7,15}$/, 'Enter a phone number with 7 to 15 digits')
        .nullable()
    )
])

export const customerInputSchema = z.object({
  name: requiredText('the customer name', 120),
  phone: optionalCustomerPhone,
  email: z.union([z.null(), optionalEmail()]),
  address: optionalText('the address', 300),
  taxRegistrationNumber: optionalText('the GSTIN or tax number', 30)
})

export const customerUpdateSchema = customerInputSchema.extend({ customerId: id })

export const customerActiveSchema = z.object({ customerId: id, active: z.boolean() })

export const customerListFilterSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(CUSTOMER_STATUS_FILTERS).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const customerPurchasesSchema = z.object({
  customerId: id,
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional()
})
