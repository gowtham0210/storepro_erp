import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { money, optionalEmail, optionalText, phone, quantity, requiredText } from './validation'

const message = (result: { success: boolean; error?: z.ZodError }) =>
  result.error?.issues[0]?.message

describe('shared validation', () => {
  it('trims and requires text with a helpful message', () => {
    expect(requiredText('the store name').parse('  Ravi Stores ')).toBe('Ravi Stores')
    expect(message(requiredText('the store name').safeParse('   '))).toBe('Enter the store name')
    expect(optionalText('notes').parse('  ')).toBeNull()
  })

  it('accepts typed money text and IPC numbers, producing minor units', () => {
    const price = money('the selling price')
    expect(price.parse('45.50')).toBe(4550)
    expect(price.parse(4550)).toBe(4550)
    expect(message(price.safeParse('45.505'))).toBe(
      'Enter the selling price as an amount, e.g. 12.50'
    )
    expect(message(price.safeParse(''))).toBe('Enter the selling price')
    expect(message(price.safeParse('-1'))).toBe("Selling price can't be less than 0.00")
    expect(price.safeParse(45.5).success).toBe(false)
  })

  it('validates quantities against the unit', () => {
    expect(quantity('the quantity', { allowsFraction: true }).parse('1.25')).toBe(1250)
    expect(message(quantity('the quantity', { allowsFraction: false }).safeParse('1.5'))).toBe(
      'This unit can only be sold in whole numbers'
    )
    expect(quantity('the quantity', { allowsFraction: false }).parse(3000)).toBe(3000)
  })

  it('checks phone numbers and optional emails', () => {
    expect(phone().parse(' +91 98400 12345 ')).toBe('+91 98400 12345')
    expect(message(phone().safeParse('12ab'))).toBe('Use digits, spaces, + and - only')
    expect(message(phone().safeParse('123'))).toBe('Phone numbers have 7 to 15 digits')
    expect(optionalEmail().parse('')).toBeNull()
    expect(optionalEmail().safeParse('not-an-email').success).toBe(false)
  })
})
