import { describe, expect, it } from 'vitest'
import { TEST_STORE } from '../test/stores'
import { storeProfileSchema } from './store'

function problems(input: unknown): Record<string, string> {
  const result = storeProfileSchema.safeParse(input)
  if (result.success) return {}
  // The first problem per field, as the forms show it.
  const found: Record<string, string> = {}
  for (const issue of result.error.issues) found[issue.path.join('.')] ??= issue.message
  return found
}

describe('storeProfileSchema', () => {
  it('accepts a complete store, tidying what was typed', () => {
    const result = storeProfileSchema.parse({
      ...TEST_STORE,
      name: '  Sharma General Stores ',
      email: '',
      taxRegistrationNumber: ' 27aapfu0939f1zv ',
      invoicePrefix: 'inv/',
      timeZone: 'Asia/Calcutta',
      receiptHeader: ''
    })
    expect(result).toMatchObject({
      name: 'Sharma General Stores',
      email: null,
      taxRegistrationNumber: '27AAPFU0939F1ZV',
      invoicePrefix: 'INV/',
      timeZone: 'Asia/Kolkata',
      receiptHeader: null
    })
  })

  it('names every missing required field', () => {
    expect(
      problems({
        ...TEST_STORE,
        name: '',
        addressLine1: ' ',
        city: '',
        phone: '',
        regionCode: null,
        postalCode: null,
        invoicePrefix: ''
      })
    ).toEqual({
      name: 'Enter the store name',
      addressLine1: 'Enter the street address',
      city: 'Enter the city or town',
      phone: 'Enter the store phone number',
      regionCode: 'Choose the state',
      postalCode: 'Enter the 6-digit PIN code',
      invoicePrefix: 'Enter a prefix for invoice numbers'
    })
  })

  it('checks Indian rules: PIN code, GSTIN and its state', () => {
    expect(problems({ ...TEST_STORE, postalCode: '012345' })).toEqual({
      postalCode: 'Enter the 6-digit PIN code'
    })
    expect(problems({ ...TEST_STORE, regionCode: 'KA' })).toEqual({
      taxRegistrationNumber: 'A GSTIN registered in Karnataka starts with 29'
    })
    expect(problems({ ...TEST_STORE, taxRegistrationNumber: null })).toEqual({})
  })

  it('relaxes the Indian rules elsewhere', () => {
    expect(
      problems({
        ...TEST_STORE,
        countryCode: 'AE',
        currencyCode: 'AED',
        timeZone: 'Asia/Dubai',
        regionCode: 'Dubai',
        postalCode: null,
        taxRegistrationNumber: '100123456700003'
      })
    ).toEqual({})
    expect(
      problems({ ...TEST_STORE, countryCode: 'AE', taxRegistrationNumber: 'X'.repeat(31) })
    ).toMatchObject({
      taxRegistrationNumber: 'Tax numbers have at most 30 characters'
    })
  })

  it('refuses unknown countries, zones and malformed prefixes', () => {
    expect(problems({ ...TEST_STORE, countryCode: 'ZZ' })).toMatchObject({
      countryCode: 'Choose a country'
    })
    expect(problems({ ...TEST_STORE, timeZone: 'Asia/Atlantis' })).toEqual({
      timeZone: 'Choose a time zone'
    })
    expect(problems({ ...TEST_STORE, invoicePrefix: 'INVOICE-26' })).toEqual({
      invoicePrefix: 'Use at most 8 characters'
    })
    expect(problems({ ...TEST_STORE, invoicePrefix: 'IN#' })).toEqual({
      invoicePrefix: 'Use letters, numbers, / and - only'
    })
  })
})
