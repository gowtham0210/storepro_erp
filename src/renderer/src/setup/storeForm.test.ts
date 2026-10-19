import { describe, expect, it } from 'vitest'
import { STORE } from '../test/fakeBackend'
import {
  defaultStoreForm,
  invoiceNumberPreview,
  storeFormFrom,
  taxSchema,
  toProfileInput
} from './storeForm'

describe('the store form model', () => {
  it('round-trips a saved profile', () => {
    const values = storeFormFrom(STORE)
    expect(values).toMatchObject({ gstRegistered: 'yes', pricesIncludeTax: 'yes', email: '' })
    const result = toProfileInput(values)
    expect(result.ok && result.input.taxRegistrationNumber).toBe(STORE.taxRegistrationNumber)
    expect(
      storeFormFrom({ ...STORE, taxRegistrationNumber: null, allowNegativeStock: true })
    ).toMatchObject({
      gstRegistered: 'no',
      allowNegativeStock: 'yes'
    })
  })

  it('starts a new store in India, with prices including tax and the tax question unanswered', () => {
    expect(defaultStoreForm()).toMatchObject({
      countryCode: 'IN',
      currencyCode: 'INR',
      businessTypeCode: 'grocery',
      gstRegistered: '',
      pricesIncludeTax: 'yes',
      invoicePrefix: 'INV'
    })
  })

  it('drops the tax number when the store is not registered', () => {
    const result = toProfileInput({ ...storeFormFrom(STORE), gstRegistered: 'no' })
    expect(result.ok && result.input.taxRegistrationNumber).toBeNull()
  })

  it('reports problems that span sections, by field', () => {
    // The state changed after the GSTIN was entered.
    const result = toProfileInput({ ...storeFormFrom(STORE), regionCode: 'TN' })
    expect(result).toEqual({
      ok: false,
      errors: { taxRegistrationNumber: 'A GSTIN registered in Tamil Nadu starts with 33' }
    })
  })

  it('asks for a tax number in words that fit the country', () => {
    const problem = (where: { countryCode: string; regionCode: string }, number: string) =>
      taxSchema(where).safeParse({
        gstRegistered: 'yes',
        taxRegistrationNumber: number,
        pricesIncludeTax: 'yes'
      }).error?.issues[0]?.message
    expect(problem({ countryCode: 'IN', regionCode: 'MH' }, '')).toBe('Enter the GSTIN')
    expect(problem({ countryCode: 'AE', regionCode: '' }, '')).toBe(
      'Enter the tax registration number'
    )
    expect(problem({ countryCode: 'AE', regionCode: '' }, 'X'.repeat(31))).toBe(
      'Tax numbers have at most 30 characters'
    )
    expect(problem({ countryCode: 'AE', regionCode: '' }, '100123456700003')).toBeUndefined()
    expect(
      taxSchema({ countryCode: 'IN', regionCode: 'MH' }).safeParse({
        gstRegistered: '',
        taxRegistrationNumber: '',
        pricesIncludeTax: 'yes'
      }).error?.issues[0]?.message
    ).toBe('Choose yes or no')
  })

  it('previews the first invoice number', () => {
    expect(invoiceNumberPreview(' ls ')).toBe('LS000001')
    expect(invoiceNumberPreview('')).toBe('INV000001')
  })
})
