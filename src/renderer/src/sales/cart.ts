import type {
  CheckoutInput,
  HeldBillDetail,
  HoldBillInput,
  ItemLookup,
  TaxClassSummary
} from '@shared/ipc/contract'
import {
  calculateBill,
  type BillCalculation,
  type BillInput,
  type Discount,
  type PricingRules
} from '@shared/pricing'
import { QUANTITY_SCALE } from '@shared/quantity'

export interface CartLine {
  variantId: number
  item: ItemLookup
  quantityMilli: number
  unitPriceMinor: number
  discount: Discount | null
}

export interface CartState {
  /** Idempotency key for the active bill; regenerated only when starting a new bill (M11-08). */
  checkoutKey: string
  lines: CartLine[]
  billDiscount: Discount | null
  customerId: number | null
  heldBillId: number | null
}

function nextCheckoutKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyCart(): CartState {
  return {
    checkoutKey: nextCheckoutKey(),
    lines: [],
    billDiscount: null,
    customerId: null,
    heldBillId: null
  }
}

export function addItemToCart(
  cart: CartState,
  item: ItemLookup,
  addQuantityMilli = QUANTITY_SCALE
): CartState {
  const existingIndex = cart.lines.findIndex((line) => line.variantId === item.variantId)
  if (existingIndex === -1) {
    return {
      ...cart,
      lines: [
        ...cart.lines,
        {
          variantId: item.variantId,
          item,
          quantityMilli: addQuantityMilli,
          unitPriceMinor: item.sellingPriceMinor,
          discount: null
        }
      ]
    }
  }
  return {
    ...cart,
    lines: cart.lines.map((line, idx) =>
      idx === existingIndex
        ? { ...line, item, quantityMilli: line.quantityMilli + addQuantityMilli }
        : line
    )
  }
}

export function updateLineQuantity(
  cart: CartState,
  variantId: number,
  quantityMilli: number
): CartState {
  if (quantityMilli <= 0) {
    return removeLineFromCart(cart, variantId)
  }
  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.variantId === variantId ? { ...line, quantityMilli } : line
    )
  }
}

export function updateLinePriceAndDiscount(
  cart: CartState,
  variantId: number,
  unitPriceMinor: number,
  discount: Discount | null
): CartState {
  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.variantId === variantId ? { ...line, unitPriceMinor, discount } : line
    )
  }
}

export function removeLineFromCart(cart: CartState, variantId: number): CartState {
  return {
    ...cart,
    lines: cart.lines.filter((line) => line.variantId !== variantId)
  }
}

export function setBillDiscount(cart: CartState, billDiscount: Discount | null): CartState {
  return {
    ...cart,
    billDiscount
  }
}

export function resumeHeldBillToCart(held: HeldBillDetail): CartState {
  return {
    checkoutKey: nextCheckoutKey(),
    customerId: held.customerId,
    heldBillId: held.heldBillId,
    billDiscount: null,
    lines: held.items.map((row) => ({
      variantId: row.item.variantId,
      item: row.item,
      quantityMilli: row.quantityMilli,
      unitPriceMinor: row.unitPriceOverrideMinor ?? row.item.sellingPriceMinor,
      discount:
        row.discountMinor > 0 ? { kind: 'amount', minor: row.discountMinor } : null
    }))
  }
}

export function priceCart(
  cart: CartState,
  rules: PricingRules,
  taxClasses: readonly TaxClassSummary[]
): BillCalculation {
  const taxMap = new Map(taxClasses.map((t) => [t.taxClassId, t]))
  const input: BillInput = {
    lines: cart.lines.map((line) => {
      const tc = taxMap.get(line.item.taxClassId)
      return {
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        discount: line.discount,
        tax: {
          rateBp: tc?.rateBp ?? 0,
          cessRateBp: tc?.cessRateBp ?? 0
        }
      }
    }),
    billDiscount: cart.billDiscount
  }
  return calculateBill(input, rules)
}

export function toHoldBillInput(
  cart: CartState,
  calculated: BillCalculation,
  label: string | null
): HoldBillInput {
  return {
    label: label?.trim() ? label.trim() : null,
    customerId: cart.customerId,
    items: cart.lines.map((line, index) => ({
      variantId: line.variantId,
      quantityMilli: line.quantityMilli,
      unitPriceOverrideMinor:
        line.unitPriceMinor !== line.item.sellingPriceMinor ? line.unitPriceMinor : null,
      discountMinor: calculated.lines[index]?.lineDiscountMinor ?? 0
    }))
  }
}

export function toCheckoutInput(
  cart: CartState,
  payments: CheckoutInput['payments'],
  overrideId?: string
): CheckoutInput {
  return {
    checkoutKey: cart.checkoutKey,
    customerId: cart.customerId,
    lines: cart.lines.map((line) => ({
      variantId: line.variantId,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      discount: line.discount
    })),
    billDiscount: cart.billDiscount,
    payments,
    heldBillId: cart.heldBillId,
    ...(overrideId === undefined ? {} : { overrideId })
  }
}
