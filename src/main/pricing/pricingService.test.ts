import { describe, expect, it } from 'vitest'
import { calculateBill, type BillInput, type PricingRules } from '@shared/pricing'
import { TEST_STORE } from '@shared/test/stores'
import { insertProduct, insertSale, insertTaxClass, insertUser } from '../db/dev/builders'
import { useMigratedDb } from '../db/test/testDb'
import { rejection, setUpStore } from '../test/store'

describe('pricing settings (M10-04, M10-05)', () => {
  const getDb = useMigratedDb()

  it('starts unrounded with a 10% discount limit, and follows the store for tax', async () => {
    const bed = await setUpStore(getDb())
    expect(bed.pricingService.getSettings()).toEqual({
      roundingMinor: 1,
      maxDiscountBp: 1000,
      regime: 'gst',
      pricesIncludeTax: true
    })
    bed.storeService.update(bed.actor(), { ...TEST_STORE, taxRegistrationNumber: null })
    expect(bed.pricingService.getSettings().regime).toBe('none')
  })

  it('changes the policy, audited in words people read', async () => {
    const bed = await setUpStore(getDb())
    bed.pricingService.updatePolicy(bed.actor(), { roundingMinor: 100, maxDiscountBp: 500 })
    expect(bed.pricingService.rules()).toEqual({
      pricesIncludeTax: true,
      regime: 'gst',
      roundingMinor: 100
    })
    const entry = bed.audit().at(-1)
    expect(entry?.action).toBe('pricing.updated')
    expect(JSON.parse(entry?.details ?? '{}')).toEqual({
      changes: {
        rounding: { from: 'not rounded', to: 'nearest ₹1.00' },
        discountLimit: { from: '10%', to: '5%' }
      }
    })
  })

  it('is changed by administrators only', async () => {
    const bed = await setUpStore(getDb())
    await bed.signInAs('manager')
    expect(
      await rejection(() =>
        bed.pricingService.updatePolicy(bed.actor(), { roundingMinor: 100, maxDiscountBp: 500 })
      )
    ).toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('tax classes (M10-01)', () => {
  const getDb = useMigratedDb()

  it('adds, changes and archives tax rates, keeping at least one', async () => {
    const bed = await setUpStore(getDb())
    const tobacco = bed.pricingService.createTaxClass(bed.actor(), {
      name: 'GST 28% + cess',
      rateBp: 2800,
      cessRateBp: 3600
    })
    expect(tobacco).toMatchObject({ rateBp: 2800, cessRateBp: 3600, active: true })
    bed.pricingService.updateTaxClass(bed.actor(), {
      taxClassId: tobacco.taxClassId,
      name: 'Tobacco',
      rateBp: 2800,
      cessRateBp: 3000
    })
    // The seeded classes include "GST 40%".
    expect(
      await rejection(() =>
        bed.pricingService.updateTaxClass(bed.actor(), {
          taxClassId: tobacco.taxClassId,
          name: 'GST 40%',
          rateBp: 4000,
          cessRateBp: 0
        })
      )
    ).toMatchObject({ code: 'CONFLICT', details: [{ path: 'name' }] })
    expect(
      await rejection(() =>
        bed.pricingService.createTaxClass(bed.actor(), {
          name: 'Odd',
          rateBp: 25,
          cessRateBp: 0
        })
      )
    ).toMatchObject({ details: [{ path: 'rateBp' }] })

    for (const taxClass of bed.taxClasses.list().slice(1)) {
      bed.pricingService.setTaxClassActive(bed.actor(), {
        taxClassId: taxClass.taxClassId,
        active: false
      })
    }
    const last = bed.taxClasses.list().find((t) => t.active)
    expect(
      await rejection(() =>
        bed.pricingService.setTaxClassActive(bed.actor(), {
          taxClassId: last?.taxClassId ?? 0,
          active: false
        })
      )
    ).toMatchObject({ code: 'CONFLICT' })
    expect(bed.audit().map((a) => a.action)).toContain('tax_class.updated')
  })
})

describe('discount and price permissions (M10-05)', () => {
  const getDb = useMigratedDb()

  const gross = { grossMinor: 10_000 }

  it('lets a cashier discount within the limit, and asks for approval above it', async () => {
    const bed = await setUpStore(getDb())
    await bed.signInAs('cashier')
    const cashier = bed.actor()
    const line = { unitPriceMinor: 10_000, catalogPriceMinor: 10_000 }
    expect(() =>
      bed.pricingService.authorizeBill(cashier, [line], { ...gross, discountMinor: 1000 })
    ).not.toThrow()
    expect(
      await rejection(() =>
        bed.pricingService.authorizeBill(cashier, [line], { ...gross, discountMinor: 1001 })
      )
    ).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'discount.override', overridable: true }
    })
    expect(
      await rejection(() =>
        bed.pricingService.authorizeBill(
          cashier,
          [{ unitPriceMinor: 9000, catalogPriceMinor: 10_000 }],
          { ...gross, discountMinor: 0 }
        )
      )
    ).toMatchObject({ details: { permission: 'price.override', overridable: true } })
  })

  it('lets a manager go beyond the limit and change prices', async () => {
    const bed = await setUpStore(getDb())
    await bed.signInAs('manager')
    expect(() =>
      bed.pricingService.authorizeBill(
        bed.actor(),
        [{ unitPriceMinor: 5000, catalogPriceMinor: 10_000 }],
        { ...gross, discountMinor: 5000 }
      )
    ).not.toThrow()
  })
})

describe('engine and database agree (M10-06)', () => {
  const getDb = useMigratedDb()

  it('saves calculated bills whose totals the views read back exactly', () => {
    const db = getDb()
    const cashier = insertUser(db, 'cashier1')
    const classes = [
      { id: insertTaxClass(db, 'GST 5%', 500), rate: { rateBp: 500, cessRateBp: 0 } },
      { id: insertTaxClass(db, 'GST 18%', 1800), rate: { rateBp: 1800, cessRateBp: 0 } }
    ]
    const variants = classes.map(
      (taxClass, index) =>
        insertProduct(db, {
          name: `Item ${index}`,
          taxClassId: taxClass.id,
          variants: [{ sku: `ITEM-${index}`, unitCode: 'kg', priceMinor: 100 }]
        }).variantIds[0] ?? 0
    )
    let seed = 11
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % max
    }
    for (let n = 0; n < 60; n++) {
      const pricesIncludeTax = n % 2 === 0
      const rules: PricingRules = {
        pricesIncludeTax,
        regime: 'gst',
        roundingMinor: n % 3 === 0 ? 100 : 1
      }
      const picks = Array.from({ length: 1 + random(4) }, () => random(2))
      const input: BillInput = {
        lines: picks.map((pick) => ({
          quantityMilli: 1 + random(5000),
          unitPriceMinor: random(100_000),
          tax: classes[pick]?.rate ?? { rateBp: 0, cessRateBp: 0 },
          discount: random(2) === 0 ? { kind: 'percent', bp: random(3000) } : null
        })),
        billDiscount: random(2) === 0 ? { kind: 'percent', bp: random(1000) } : null
      }
      const bill = calculateBill(input, rules)
      const { saleId } = insertSale(db, {
        invoiceNumber: `INV${n}`,
        cashierId: cashier,
        pricesIncludeTax,
        roundOffMinor: bill.roundOffMinor,
        lines: bill.lines.map((line, index) => ({
          variantId: variants[picks[index] ?? 0] ?? 0,
          quantityMilli: input.lines[index]?.quantityMilli ?? 0,
          unitPriceMinor: input.lines[index]?.unitPriceMinor ?? 0,
          discountMinor: line.discountMinor,
          taxes: line.taxes.map((t) => ({
            code: t.code,
            rateBp: t.rateBp,
            amountMinor: t.amountMinor
          }))
        })),
        payments:
          bill.payableMinor > 0 ? [{ methodCode: 'cash', amountMinor: bill.payableMinor }] : []
      })
      expect(
        db.get(
          `SELECT gross_minor, discount_minor, taxable_minor, tax_minor, grand_total_minor
           FROM v_sale_totals WHERE sale_id = ?`,
          [saleId]
        )
      ).toEqual({
        gross_minor: bill.grossMinor,
        discount_minor: bill.discountMinor,
        taxable_minor: bill.taxableMinor,
        tax_minor: bill.taxMinor,
        grand_total_minor: bill.payableMinor
      })
    }
  })
})
