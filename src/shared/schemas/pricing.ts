/**
 * Validation for tax rates and the pricing policy (M10), shared by Settings
 * and the main-process handlers.
 */
import { z } from 'zod'
import { ROUNDING_STEPS } from '../pricing'
import { requiredText } from '../validation'

/** A percentage as typed ("18", "2.5") or as basis points over IPC (1800). */
export function rate(label: string, { max = 10_000 }: { max?: number } = {}) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 0 && value <= max) return value
      ctx.addIssue({ code: 'custom', message: `${label} must be between 0% and ${max / 100}%` })
      return z.NEVER
    }
    const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(value.trim())
    if (!match) {
      ctx.addIssue({
        code: 'custom',
        message:
          value.trim() === ''
            ? `Enter ${label.toLowerCase()}`
            : `Enter ${label.toLowerCase()} as a percentage, e.g. 18 or 2.5`
      })
      return z.NEVER
    }
    const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
    if (bp > max) {
      ctx.addIssue({ code: 'custom', message: `${label} can't be more than ${max / 100}%` })
      return z.NEVER
    }
    return bp
  })
}

export const taxClassInputSchema = z.object({
  name: requiredText('a name for the tax rate', 40),
  rateBp: rate('The tax rate'),
  cessRateBp: rate('The cess')
})

export const taxClassUpdateSchema = taxClassInputSchema.extend({
  taxClassId: z.number().int().positive()
})

export const pricingPolicySchema = z.object({
  roundingMinor: z.coerce
    .number()
    .refine(
      (value) => (ROUNDING_STEPS as readonly number[]).includes(value),
      'Choose how to round bills'
    ),
  maxDiscountBp: rate('The discount limit')
})

/** Field names as people read them: audit log changes. */
export const PRICING_FIELD_LABELS: Record<string, string> = {
  rounding: 'bill rounding',
  discountLimit: 'discount limit',
  name: 'name',
  rate: 'rate',
  cess: 'cess'
}
