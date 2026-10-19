import { describe, expect, it } from 'vitest'
import {
  calculateBill,
  discountExceedsLimit,
  PricingError,
  roundToStep,
  taxComponents,
  taxRegimeOf,
  type BillInput,
  type PricingRules
} from './pricing'

const GST_INCLUSIVE: PricingRules = { pricesIncludeTax: true, regime: 'gst', roundingMinor: 1 }
const GST_EXCLUSIVE: PricingRules = { pricesIncludeTax: false, regime: 'gst', roundingMinor: 1 }
const GST5 = { rateBp: 500, cessRateBp: 0 }
const GST18 = { rateBp: 1800, cessRateBp: 0 }
const EXEMPT = { rateBp: 0, cessRateBp: 0 }

function line(
  quantityMilli: number,
  unitPriceMinor: number,
  tax = GST5,
  discount?: BillInput['billDiscount']
) {
  return { quantityMilli, unitPriceMinor, tax, discount }
}

describe('tax regime and components', () => {
  it('follows the store: GST in India when registered, one tax elsewhere, none unregistered', () => {
    expect(taxRegimeOf({ countryCode: 'IN', taxRegistrationNumber: '27AAPFU0939F1ZV' })).toBe('gst')
    expect(taxRegimeOf({ countryCode: 'AE', taxRegistrationNumber: '100000000000003' })).toBe(
      'single'
    )
    expect(taxRegimeOf({ countryCode: 'IN', taxRegistrationNumber: null })).toBe('none')
  })

  it('splits GST equally into CGST and SGST, adds cess, and skips zero rates', () => {
    expect(taxComponents('gst', { rateBp: 1800, cessRateBp: 1200 })).toEqual([
      { code: 'CGST', rateBp: 900 },
      { code: 'SGST', rateBp: 900 },
      { code: 'CESS', rateBp: 1200 }
    ])
    expect(taxComponents('gst', EXEMPT)).toEqual([])
    expect(taxComponents('single', GST5)).toEqual([{ code: 'TAX', rateBp: 500 }])
    expect(taxComponents('none', GST18)).toEqual([])
    expect(() => taxComponents('gst', { rateBp: 25, cessRateBp: 0 })).toThrow(PricingError)
  })
})

describe('line calculation (M10-02)', () => {
  it('takes GST out of tax-inclusive prices, keeping CGST and SGST equal', () => {
    // 1.25 kg rice at ₹60.00/kg = ₹75.00, ₹5.00 off, 5% GST included.
    const bill = calculateBill(
      { lines: [line(1250, 6000, GST5, { kind: 'amount', minor: 500 })] },
      GST_INCLUSIVE
    )
    expect(bill.lines[0]).toEqual({
      grossMinor: 7500,
      lineDiscountMinor: 500,
      billDiscountMinor: 0,
      discountMinor: 500,
      netMinor: 7000,
      taxableMinor: 6666,
      taxMinor: 334,
      taxes: [
        { code: 'CGST', rateBp: 250, amountMinor: 167 },
        { code: 'SGST', rateBp: 250, amountMinor: 167 }
      ],
      totalMinor: 7000
    })
    expect(bill.payableMinor).toBe(7000)
  })

  it('adds tax on top of tax-exclusive prices', () => {
    const bill = calculateBill({ lines: [line(3000, 1999, GST18)] }, GST_EXCLUSIVE)
    expect(bill.lines[0]).toMatchObject({
      grossMinor: 5997,
      taxableMinor: 5997,
      taxes: [
        { code: 'CGST', rateBp: 900, amountMinor: 540 },
        { code: 'SGST', rateBp: 900, amountMinor: 540 }
      ],
      totalMinor: 7077
    })
  })

  it('rounds fractional quantities to the paisa, half away from zero', () => {
    // 0.333 kg at ₹1.50 = 49.95 paise → 50.
    expect(
      calculateBill({ lines: [line(333, 150, EXEMPT)] }, GST_INCLUSIVE).lines[0]?.grossMinor
    ).toBe(50)
    // 0.001 kg at ₹4.99 = 0.499 paise → 0.
    expect(
      calculateBill({ lines: [line(1, 499, EXEMPT)] }, GST_INCLUSIVE).lines[0]?.grossMinor
    ).toBe(0)
  })

  it('charges no tax for an unregistered store, whatever the class', () => {
    const bill = calculateBill(
      { lines: [line(1000, 11800, GST18)] },
      { ...GST_INCLUSIVE, regime: 'none' }
    )
    expect(bill).toMatchObject({
      taxMinor: 0,
      taxableMinor: 11800,
      payableMinor: 11800,
      taxSummary: []
    })
  })

  it('applies percentage line discounts', () => {
    const bill = calculateBill(
      { lines: [line(2000, 4999, EXEMPT, { kind: 'percent', bp: 1000 })] },
      GST_INCLUSIVE
    )
    expect(bill.lines[0]).toMatchObject({
      grossMinor: 9998,
      lineDiscountMinor: 1000,
      netMinor: 8998
    })
  })

  it('rejects impossible lines, saying which', () => {
    const tooMuch = () =>
      calculateBill(
        {
          lines: [line(1000, 100, EXEMPT), line(1000, 100, EXEMPT, { kind: 'amount', minor: 101 })]
        },
        GST_INCLUSIVE
      )
    expect(tooMuch).toThrow(PricingError)
    try {
      tooMuch()
    } catch (error) {
      expect(error).toMatchObject({ line: 1, message: "The discount can't be more than the line" })
    }
    expect(() => calculateBill({ lines: [line(0, 100)] }, GST_INCLUSIVE)).toThrow(/quantity/)
    expect(() => calculateBill({ lines: [line(1000, 10.5)] }, GST_INCLUSIVE)).toThrow(/price/)
    expect(() =>
      calculateBill(
        { lines: [line(1000, 100, EXEMPT, { kind: 'percent', bp: 10_001 })] },
        GST_INCLUSIVE
      )
    ).toThrow(/between 0% and 100%/)
  })
})

describe('bill discount (M10-03)', () => {
  it('shares a bill discount over the lines so the shares add up exactly', () => {
    const bill = calculateBill(
      {
        lines: [line(1000, 1000, GST5), line(1000, 2000, GST18), line(1000, 3000, EXEMPT)],
        billDiscount: { kind: 'amount', minor: 100 }
      },
      GST_INCLUSIVE
    )
    expect(bill.lines.map((l) => l.billDiscountMinor)).toEqual([17, 33, 50])
    expect(bill.discountMinor).toBe(100)
    expect(bill.payableMinor).toBe(5900)
  })

  it('shares in proportion to what is left after line discounts', () => {
    const bill = calculateBill(
      {
        lines: [
          line(1000, 1000, EXEMPT, { kind: 'amount', minor: 1000 }),
          line(1000, 1000, EXEMPT)
        ],
        billDiscount: { kind: 'percent', bp: 1000 }
      },
      GST_INCLUSIVE
    )
    expect(bill.lines.map((l) => l.billDiscountMinor)).toEqual([0, 100])
  })

  it("can't take more than the bill", () => {
    expect(() =>
      calculateBill(
        { lines: [line(1000, 500)], billDiscount: { kind: 'amount', minor: 501 } },
        GST_INCLUSIVE
      )
    ).toThrow("The discount can't be more than the bill")
  })
})

describe('rounding and payable (M10-04)', () => {
  it('rounds to the nearest step, halves away from zero', () => {
    expect(roundToStep(24735, 100)).toBe(24700)
    expect(roundToStep(24750, 100)).toBe(24800)
    expect(roundToStep(-150, 100)).toBe(-200)
    expect(roundToStep(24737, 5)).toBe(24735)
    expect(roundToStep(24737, 1)).toBe(24737)
  })

  it('records the round-off between the subtotal and what is payable', () => {
    const bill = calculateBill(
      { lines: [line(1000, 24735, GST5)] },
      { ...GST_INCLUSIVE, roundingMinor: 100 }
    )
    expect(bill).toMatchObject({ subtotalMinor: 24735, roundOffMinor: -35, payableMinor: 24700 })
  })

  it('accepts only the supported steps', () => {
    expect(() => calculateBill({ lines: [] }, { ...GST_INCLUSIVE, roundingMinor: 3 })).toThrow()
  })

  it('prices an empty bill at zero', () => {
    expect(calculateBill({ lines: [] }, GST_INCLUSIVE)).toMatchObject({
      payableMinor: 0,
      lines: []
    })
  })
})

describe('tax summary', () => {
  it('totals tax per component and rate, with mixed rates and cess', () => {
    const bill = calculateBill(
      {
        lines: [
          line(1000, 10500, GST5),
          line(2000, 10500, GST5),
          line(1000, 15000, { rateBp: 2800, cessRateBp: 1200 })
        ]
      },
      GST_INCLUSIVE
    )
    expect(bill.taxSummary).toEqual([
      { code: 'CGST', rateBp: 250, amountMinor: 750, taxableMinor: 30000 },
      { code: 'SGST', rateBp: 250, amountMinor: 750, taxableMinor: 30000 },
      { code: 'CGST', rateBp: 1400, amountMinor: 1500, taxableMinor: 10714 },
      { code: 'SGST', rateBp: 1400, amountMinor: 1500, taxableMinor: 10714 },
      { code: 'CESS', rateBp: 1200, amountMinor: 1286, taxableMinor: 10714 }
    ])
    expect(bill.taxMinor).toBe(5786)
    expect(bill.taxableMinor + bill.taxMinor).toBe(bill.payableMinor)
  })
})

describe('invariants over many random bills', () => {
  it('always balances: taxable + tax = total, shares add up, CGST = SGST', () => {
    let seed = 7
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % max
    }
    const rates = [0, 500, 1200, 1800, 2800, 4000]
    for (let i = 0; i < 500; i++) {
      const lines = Array.from({ length: 1 + random(6) }, () => {
        const unitPriceMinor = random(500_000)
        const quantityMilli = 1 + random(25_000)
        return {
          quantityMilli,
          unitPriceMinor,
          tax: { rateBp: rates[random(rates.length)] ?? 0, cessRateBp: random(4) === 0 ? 1200 : 0 },
          discount: random(3) === 0 ? ({ kind: 'percent', bp: random(5000) } as const) : null
        }
      })
      const pricesIncludeTax = random(2) === 0
      const bill = calculateBill(
        { lines, billDiscount: random(3) === 0 ? { kind: 'percent', bp: random(2000) } : null },
        { pricesIncludeTax, regime: 'gst', roundingMinor: [1, 100][random(2)] ?? 1 }
      )
      for (const l of bill.lines) {
        expect(l.netMinor).toBe(l.grossMinor - l.discountMinor)
        expect(l.netMinor).toBeGreaterThanOrEqual(0)
        expect(l.taxableMinor + l.taxMinor).toBe(pricesIncludeTax ? l.netMinor : l.totalMinor)
        const cgst = l.taxes.find((t) => t.code === 'CGST')?.amountMinor
        expect(cgst).toBe(l.taxes.find((t) => t.code === 'SGST')?.amountMinor)
      }
      expect(bill.payableMinor).toBe(bill.subtotalMinor + bill.roundOffMinor)
      expect(Math.abs(bill.roundOffMinor)).toBeLessThanOrEqual(50)
    }
  })
})

describe('discount limit (M10-05)', () => {
  it('compares all discounts with the gross amount, exactly', () => {
    expect(discountExceedsLimit({ grossMinor: 10_000, discountMinor: 1000 }, 1000)).toBe(false)
    expect(discountExceedsLimit({ grossMinor: 10_000, discountMinor: 1001 }, 1000)).toBe(true)
    expect(discountExceedsLimit({ grossMinor: 0, discountMinor: 0 }, 0)).toBe(false)
  })
})
