/**
 * Validation for the store profile (M03), shared by the setup wizard, the
 * Settings screen and the main-process handlers.
 */
import { z } from 'zod'
import { countryByCode, gstinProblem, indianStateByCode } from '../regions'
import { canonicalTimeZone, isValidTimeZone } from '../storeTime'
import { optionalEmail, optionalText, phone, requiredText } from '../validation'

export const INVOICE_PREFIX_MAX = 8

export const storeDetails = {
  name: requiredText('the store name', 100),
  addressLine1: requiredText('the street address', 120),
  addressLine2: optionalText('the second address line', 120),
  city: requiredText('the city or town', 60),
  countryCode: z.string().refine((code) => countryByCode(code) !== undefined, 'Choose a country'),
  regionCode: optionalText('the state or region', 60),
  postalCode: optionalText('the postal code', 12),
  phone: phone('the store phone number'),
  email: optionalEmail().nullable()
}

export const storeRegional = {
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency'),
  timeZone: z.string().refine(isValidTimeZone, 'Choose a time zone').transform(canonicalTimeZone),
  businessTypeCode: z.string().min(1, 'Choose a business type')
}

export const storeTax = {
  taxRegistrationNumber: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value.toUpperCase()))
    .nullable(),
  pricesIncludeTax: z.boolean()
}

export const storeReceipt = {
  receiptHeader: optionalText('the receipt header', 300),
  receiptFooter: optionalText('the receipt footer', 300),
  invoicePrefix: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z
        .string()
        .min(1, 'Enter a prefix for invoice numbers')
        .max(INVOICE_PREFIX_MAX, `Use at most ${INVOICE_PREFIX_MAX} characters`)
        .regex(/^[A-Z0-9/-]+$/, 'Use letters, numbers, / and - only')
    )
}

export const storePolicy = {
  allowNegativeStock: z.boolean()
}

type Profile = {
  countryCode: string
  regionCode: string | null
  postalCode: string | null
  taxRegistrationNumber: string | null
}

/** Rules that depend on the country: Indian stores need a state and PIN code, and a valid GSTIN. */
export function checkRegionalRules(value: Profile, ctx: z.RefinementCtx): void {
  if (value.countryCode !== 'IN') return
  if (!value.regionCode || !indianStateByCode(value.regionCode)) {
    ctx.addIssue({ code: 'custom', path: ['regionCode'], message: 'Choose the state' })
  }
  if (!value.postalCode || !/^[1-9]\d{5}$/.test(value.postalCode)) {
    ctx.addIssue({
      code: 'custom',
      path: ['postalCode'],
      message: 'Enter the 6-digit PIN code'
    })
  }
  if (value.taxRegistrationNumber !== null) {
    const problem = gstinProblem(value.taxRegistrationNumber, value.regionCode)
    if (problem) ctx.addIssue({ code: 'custom', path: ['taxRegistrationNumber'], message: problem })
  }
}

export const storeProfileSchema = z
  .object({
    ...storeDetails,
    ...storeRegional,
    ...storeTax,
    ...storeReceipt,
    ...storePolicy
  })
  .superRefine((value, ctx) => {
    checkRegionalRules(value, ctx)
    if (value.countryCode !== 'IN' && value.taxRegistrationNumber !== null) {
      if (value.taxRegistrationNumber.length > 30) {
        ctx.addIssue({
          code: 'custom',
          path: ['taxRegistrationNumber'],
          message: 'Tax numbers have at most 30 characters'
        })
      }
    }
  })

/** Field names as people read them: form labels, and changes in the audit log. */
export const STORE_FIELD_LABELS: Record<string, string> = {
  name: 'store name',
  addressLine1: 'street address',
  addressLine2: 'second address line',
  city: 'city',
  regionCode: 'state',
  postalCode: 'PIN code',
  countryCode: 'country',
  phone: 'phone number',
  email: 'email',
  taxRegistrationNumber: 'GSTIN',
  currencyCode: 'currency',
  timeZone: 'time zone',
  businessTypeCode: 'business type',
  pricesIncludeTax: 'prices include tax',
  allowNegativeStock: 'sell when stock runs out',
  receiptHeader: 'receipt header',
  receiptFooter: 'receipt footer',
  invoicePrefix: 'invoice prefix'
}
