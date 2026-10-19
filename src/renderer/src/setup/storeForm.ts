import { z } from 'zod'
import type { StoreProfile, StoreProfileInput } from '@shared/ipc/contract'
import { countryByCode, gstinProblem } from '@shared/regions'
import {
  checkRegionalRules,
  storeDetails,
  storeProfileSchema,
  storeReceipt,
  storeRegional
} from '@shared/schemas/store'
import { canonicalTimeZone, isValidTimeZone } from '@shared/storeTime'

/**
 * The store profile as the setup wizard and Settings edit it: every field a
 * string, as form controls hold them, with yes/no choices for the switches.
 * Each section has its own schema, built from the shared rules the main
 * process applies again.
 */
export interface StoreFormValues {
  name: string
  addressLine1: string
  addressLine2: string
  city: string
  countryCode: string
  regionCode: string
  postalCode: string
  phone: string
  email: string
  currencyCode: string
  timeZone: string
  businessTypeCode: string
  /** '' until the person answers. */
  gstRegistered: '' | 'yes' | 'no'
  taxRegistrationNumber: string
  pricesIncludeTax: 'yes' | 'no'
  invoicePrefix: string
  receiptHeader: string
  receiptFooter: string
  allowNegativeStock: 'yes' | 'no'
}

const yesNo = z.enum(['yes', 'no'])

export const detailsSchema = z
  .object({
    name: storeDetails.name,
    addressLine1: storeDetails.addressLine1,
    addressLine2: storeDetails.addressLine2,
    city: storeDetails.city,
    countryCode: storeDetails.countryCode,
    regionCode: storeDetails.regionCode,
    postalCode: storeDetails.postalCode,
    phone: storeDetails.phone,
    email: storeDetails.email
  })
  .superRefine((value, ctx) => checkRegionalRules({ ...value, taxRegistrationNumber: null }, ctx))

export const regionalSchema = z.object(storeRegional)

/** The tax section depends on where the store is: GSTINs are checked against the state. */
export function taxSchema(where: { countryCode: string; regionCode: string }) {
  return z
    .object({
      gstRegistered: z.enum(['yes', 'no'], { message: 'Choose yes or no' }),
      taxRegistrationNumber: z.string(),
      pricesIncludeTax: yesNo
    })
    .superRefine((value, ctx) => {
      if (value.gstRegistered !== 'yes') return
      const number = value.taxRegistrationNumber.trim().toUpperCase()
      const india = where.countryCode === 'IN'
      const problem =
        number === ''
          ? india
            ? 'Enter the GSTIN'
            : 'Enter the tax registration number'
          : india
            ? gstinProblem(number, where.regionCode)
            : number.length > 30
              ? 'Tax numbers have at most 30 characters'
              : null
      if (problem)
        ctx.addIssue({ code: 'custom', path: ['taxRegistrationNumber'], message: problem })
    })
}

export const receiptSchema = z.object(storeReceipt)

export const stockSchema = z.object({ allowNegativeStock: yesNo })

/** The time zone this computer is set to, if StorePro can use it. */
function systemTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone && isValidTimeZone(zone) ? canonicalTimeZone(zone) : null
}

export function defaultStoreForm(): StoreFormValues {
  const india = countryByCode('IN')
  return {
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    countryCode: 'IN',
    regionCode: '',
    postalCode: '',
    phone: '',
    email: '',
    currencyCode: india?.currencyCode ?? 'INR',
    timeZone: systemTimeZone() ?? india?.defaultTimeZone ?? 'Asia/Kolkata',
    businessTypeCode: 'grocery',
    gstRegistered: '',
    taxRegistrationNumber: '',
    // MRP-style prices that already include GST are the norm in Indian retail.
    pricesIncludeTax: 'yes',
    invoicePrefix: 'INV',
    receiptHeader: '',
    receiptFooter: '',
    allowNegativeStock: 'no'
  }
}

export function storeFormFrom(profile: StoreProfile): StoreFormValues {
  return {
    name: profile.name,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city,
    countryCode: profile.countryCode,
    regionCode: profile.regionCode ?? '',
    postalCode: profile.postalCode ?? '',
    phone: profile.phone,
    email: profile.email ?? '',
    currencyCode: profile.currencyCode,
    timeZone: profile.timeZone,
    businessTypeCode: profile.businessTypeCode,
    gstRegistered: profile.taxRegistrationNumber === null ? 'no' : 'yes',
    taxRegistrationNumber: profile.taxRegistrationNumber ?? '',
    pricesIncludeTax: profile.pricesIncludeTax ? 'yes' : 'no',
    invoicePrefix: profile.invoicePrefix,
    receiptHeader: profile.receiptHeader ?? '',
    receiptFooter: profile.receiptFooter ?? '',
    allowNegativeStock: profile.allowNegativeStock ? 'yes' : 'no'
  }
}

/**
 * The profile to send, checked with the same schema the main process uses.
 * Rules that span sections (a GSTIN and the state) are checked again here, in
 * case an earlier section was changed afterwards.
 */
export function toProfileInput(
  values: StoreFormValues
): { ok: true; input: StoreProfileInput } | { ok: false; errors: Record<string, string> } {
  const result = storeProfileSchema.safeParse({
    ...values,
    taxRegistrationNumber: values.gstRegistered === 'yes' ? values.taxRegistrationNumber : '',
    pricesIncludeTax: values.pricesIncludeTax === 'yes',
    allowNegativeStock: values.allowNegativeStock === 'yes'
  })
  if (result.success) return { ok: true, input: result.data }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) errors[issue.path.join('.')] ??= issue.message
  return { ok: false, errors }
}

/** The first invoice number with this prefix, as it will be printed (six digits, M11). */
export function invoiceNumberPreview(prefix: string): string {
  return `${prefix.trim().toUpperCase() || 'INV'}000001`
}
