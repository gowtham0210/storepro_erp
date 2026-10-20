import { describe, expect, it } from 'vitest'
import type { HeldBillDetail, ItemLookup, TaxClassSummary } from '@shared/ipc/contract'
import {
  addItemToCart,
  createEmptyCart,
  priceCart,
  resumeHeldBillToCart,
  setBillDiscount,
  toHoldBillInput,
  updateLinePriceAndDiscount
} from './cart'

const GST: TaxClassSummary[] = [
  { taxClassId: 2, name: 'GST 5%', rateBp: 500, cessRateBp: 0, active: true, productCount: 0 },
  { taxClassId: 3, name: 'GST 18%', rateBp: 1800, cessRateBp: 0, active: true, productCount: 0 }
]

const item = (variantId: number, price: number, taxClassId: number): ItemLookup => ({
  variantId,
  productId: variantId,
  name: `Item ${variantId}`,
  sku: `SKU-${variantId}`,
  unitCode: 'pcs',
  allowsFraction: false,
  sellingPriceMinor: price,
  mrpMinor: null,
  taxClassId,
  tracksInventory: true,
  onHandMilli: 100_000
})

const RULES_INCLUSIVE = { pricesIncludeTax: true, regime: 'gst', roundingMinor: 1 } as const
const RULES_EXCLUSIVE = { pricesIncludeTax: false, regime: 'gst', roundingMinor: 1 } as const

/** Hold the bill as the screen does, then resume it, as if after a trip to the server. */
function holdAndResume(
  cart: ReturnType<typeof createEmptyCart>,
  rules: typeof RULES_INCLUSIVE | typeof RULES_EXCLUSIVE
) {
  const calculated = priceCart(cart, rules, GST)
  const held = toHoldBillInput(cart, calculated, 'Counter 2')
  const detail: HeldBillDetail = {
    heldBillId: 1,
    label: held.label,
    customerId: null,
    customerName: null,
    heldByName: 'Ravi Kumar',
    heldAt: 0,
    items: held.items.map((row) => {
      const found = cart.lines.find((l) => l.variantId === row.variantId)!
      return { ...row, item: found.item } as unknown as HeldBillDetail['items'][number]
    })
  }
  return resumeHeldBillToCart(detail)
}

describe('a held bill keeps every discount (found by the keyboard-only billing test, M30-06)', () => {
  for (const [name, rules] of [
    ['prices that include tax', RULES_INCLUSIVE],
    ['prices that exclude tax', RULES_EXCLUSIVE]
  ] as const) {
    it(`comes back with the same total after a bill discount, with ${name}`, () => {
      let cart = createEmptyCart()
      cart = addItemToCart(cart, item(10, 15_000, 2), 3000)
      cart = addItemToCart(cart, item(11, 25_000, 3), 1000)
      cart = setBillDiscount(cart, { kind: 'percent', bp: 500 })
      const before = priceCart(cart, rules, GST)
      expect(before.discountMinor).toBeGreaterThan(0)

      const after = priceCart(holdAndResume(cart, rules), rules, GST)
      expect(after.discountMinor).toBe(before.discountMinor)
      expect(after.payableMinor).toBe(before.payableMinor)
      expect(after.taxMinor).toBe(before.taxMinor)
    })

    it(`keeps a line discount and a bill discount together, with ${name}`, () => {
      let cart = createEmptyCart()
      cart = addItemToCart(cart, item(10, 15_000, 2), 2000)
      cart = addItemToCart(cart, item(11, 25_000, 3), 1000)
      cart = updateLinePriceAndDiscount(cart, 10, 15_000, { kind: 'amount', minor: 1000 })
      cart = setBillDiscount(cart, { kind: 'amount', minor: 3001 }) // does not divide evenly
      const before = priceCart(cart, rules, GST)

      const after = priceCart(holdAndResume(cart, rules), rules, GST)
      expect(after.discountMinor).toBe(before.discountMinor)
      expect(after.payableMinor).toBe(before.payableMinor)
      expect(after.lines.map((l) => l.discountMinor)).toEqual(
        before.lines.map((l) => l.discountMinor)
      )
    })
  }

  it('is unchanged when there is no bill discount', () => {
    let cart = createEmptyCart()
    cart = addItemToCart(cart, item(10, 15_000, 2), 2000)
    cart = updateLinePriceAndDiscount(cart, 10, 15_000, { kind: 'percent', bp: 1000 })
    const before = priceCart(cart, RULES_INCLUSIVE, GST)
    const after = priceCart(holdAndResume(cart, RULES_INCLUSIVE), RULES_INCLUSIVE, GST)
    expect(after.payableMinor).toBe(before.payableMinor)
  })
})
