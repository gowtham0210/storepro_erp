import { describe, expect, it } from 'vitest'
import { assertQuantity, formatQuantity, fromWholeUnits, parseQuantity } from './quantity'

const kg = { allowsFraction: true }
const pcs = { allowsFraction: false }

describe('quantities', () => {
  it('parses into thousandths', () => {
    expect(parseQuantity('1.25', kg)).toBe(1250)
    expect(parseQuantity('0.005', kg)).toBe(5)
    expect(parseQuantity(' 3 ', pcs)).toBe(3000)
    expect(fromWholeUnits(12)).toBe(12000)
  })

  it('enforces the unit rules', () => {
    expect(() => parseQuantity('1.5', pcs)).toThrow('whole numbers')
    expect(() => parseQuantity('0', kg)).toThrow('greater than zero')
    expect(() => parseQuantity('0.0004', kg)).toThrow('3 decimal places')
    expect(() => parseQuantity('-1', kg)).toThrow('Not a valid quantity')
    expect(() => assertQuantity(2_000_000_000, kg)).toThrow()
  })

  it('formats without trailing zeros', () => {
    expect(formatQuantity(1250)).toBe('1.25')
    expect(formatQuantity(3000)).toBe('3')
    expect(formatQuantity(5)).toBe('0.005')
    expect(formatQuantity(-500)).toBe('-0.5')
  })
})
