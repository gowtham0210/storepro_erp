import { describe, expect, it } from 'vitest'
import { COUNTRIES, gstinProblem, INDIAN_STATES, indianStateByCode } from './regions'

describe('regions', () => {
  it('lists every state and union territory once, with unique GST codes', () => {
    expect(INDIAN_STATES).toHaveLength(36)
    expect(new Set(INDIAN_STATES.map((s) => s.code)).size).toBe(36)
    expect(new Set(INDIAN_STATES.map((s) => s.gstCode)).size).toBe(36)
    expect(indianStateByCode('TN')).toMatchObject({ name: 'Tamil Nadu', gstCode: '33' })
    expect(COUNTRIES[0]).toMatchObject({ code: 'IN', currencyCode: 'INR' })
  })
})

describe('gstinProblem', () => {
  it("accepts a valid GSTIN from the store's state", () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull()
    expect(gstinProblem('27AAPFU0939F1ZV', 'MH')).toBeNull()
  })

  it('catches typing mistakes with the check character', () => {
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/typing mistake/)
    expect(gstinProblem('27AAPFU0938F1ZV')).toMatch(/typing mistake/)
  })

  it('explains what is wrong', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toBe('A GSTIN has 15 characters')
    expect(gstinProblem('27aapfu0939f1zv')).toMatch(/looks like/)
    expect(gstinProblem('27AAPFU0939F1ZV', 'TN')).toBe(
      'A GSTIN registered in Tamil Nadu starts with 33'
    )
  })
})
