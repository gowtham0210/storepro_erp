import { describe, expect, it } from 'vitest'
import {
  allocate,
  applyRate,
  divideRounded,
  formatMoney,
  multiplyByQuantity,
  parseMoney,
  taxIncludedIn,
  toDecimalString
} from './money'

describe('parseMoney', () => {
  it('parses user input into minor units', () => {
    expect(parseMoney('1,250.5', 2)).toBe(125050)
    expect(parseMoney('₹ 99', 2)).toBe(9900)
    expect(parseMoney('0.07', 2)).toBe(7)
    expect(parseMoney('-10', 2)).toBe(-1000)
    expect(parseMoney('12', 0)).toBe(12)
    expect(parseMoney('-0', 2)).toBe(0)
  })

  it('rejects malformed input and extra precision instead of rounding', () => {
    expect(() => parseMoney('12.345', 2)).toThrow('decimal places')
    expect(() => parseMoney('abc', 2)).toThrow('Not a valid amount')
    expect(() => parseMoney('1e3', 2)).toThrow('Not a valid amount')
    expect(() => parseMoney('', 2)).toThrow()
    expect(() => parseMoney('99999999999999999999', 2)).toThrow('too large')
  })
})

describe('formatting', () => {
  it('renders exact decimal strings', () => {
    expect(toDecimalString(123450, 2)).toBe('1234.50')
    expect(toDecimalString(5, 2)).toBe('0.05')
    expect(toDecimalString(-5, 2)).toBe('-0.05')
    expect(toDecimalString(42, 0)).toBe('42')
  })

  it('formats for display with Indian grouping', () => {
    expect(formatMoney(12345678, { currencyCode: 'INR', minorUnits: 2 })).toBe('₹1,23,456.78')
  })
})

describe('arithmetic', () => {
  it('rounds half away from zero', () => {
    expect(divideRounded(5n, 10n)).toBe(1n)
    expect(divideRounded(4n, 10n)).toBe(0n)
    expect(divideRounded(-5n, 10n)).toBe(-1n)
    expect(divideRounded(15n, -10n)).toBe(-2n)
  })

  it('prices fractional quantities', () => {
    expect(multiplyByQuantity(6000, 1250)).toBe(7500) // 1.25 kg x ₹60
    expect(multiplyByQuantity(4750, 333)).toBe(1582) // 0.333 x ₹47.50 = ₹15.8175
    expect(multiplyByQuantity(999_999_999, 1_000_000_000)).toBe(999_999_999_000_000)
  })

  it('applies and extracts tax rates', () => {
    expect(applyRate(10000, 1800)).toBe(1800)
    expect(applyRate(333, 250)).toBe(8) // 8.325 -> 8
    expect(taxIncludedIn(11800, 1800)).toBe(1800)
    expect(taxIncludedIn(7000, 500)).toBe(333)
  })

  it('allocates without losing or creating a single paisa', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(allocate(-1000, [1, 1, 1])).toEqual([-334, -333, -333])
    expect(allocate(500, [7500, 4500])).toEqual([313, 187])
    expect(allocate(0, [3, 4])).toEqual([0, 0])
    for (const total of [1, 99, 12345, 999_999]) {
      const parts = allocate(total, [3, 7, 11, 13])
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
    expect(() => allocate(100, [0, 0])).toThrow()
    expect(() => allocate(100, [])).toThrow()
  })

  it('rejects non-integer amounts', () => {
    expect(() => multiplyByQuantity(10.5, 1000)).toThrow()
    expect(() => applyRate(Number.NaN, 100)).toThrow()
  })
})
