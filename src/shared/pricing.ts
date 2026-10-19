/**
 * The pricing engine (M10): line amounts, discounts, taxes, rounding and the
 * amount payable, for a bill or a quote. Pure functions of their input, with
 * no I/O, so the renderer can show totals as the cashier works and checkout
 * (M11) recomputes the same numbers in the main process before saving.
 *
 * The numbers match the database views exactly (v_sale_item_amounts,
 * v_sale_totals): a test saves calculated bills and reads them back.
 *
 *   gross    = quantity × unit price, rounded half away from zero
 *   discount = line discount + the line's share of any bill discount
 *   net      = gross − discount
 *   tax      = sum of the line's tax components
 *   taxable  = net − tax when prices include tax, otherwise net
 *   total    = net when prices include tax, otherwise net + tax
 *   payable  = sum of totals + round-off
 *
 * GST rules are PROVISIONAL until a practitioner confirms them (M10-07); see
 * docs/pricing-and-tax.md.
 *
 * Runtime-dependency free: used by both processes.
 */
import { allocate, applyRate, divideRounded, multiplyByQuantity, taxIncludedIn } from './money'

/** How a store charges tax, from where it is and whether it is registered. */
export type TaxRegime =
  /** India, GST-registered: GST split equally into CGST and SGST (intra-state retail), plus cess. */
  | 'gst'
  /** Elsewhere, registered: one sales tax (VAT), plus cess if any. */
  | 'single'
  /** Not registered: no tax is charged. */
  | 'none'

export type TaxComponentCode = 'CGST' | 'SGST' | 'IGST' | 'CESS' | 'TAX'

export function taxRegimeOf(store: {
  countryCode: string
  taxRegistrationNumber: string | null
}): TaxRegime {
  if (store.taxRegistrationNumber === null) return 'none'
  return store.countryCode === 'IN' ? 'gst' : 'single'
}

/** A tax class's rates. */
export interface TaxRate {
  rateBp: number
  cessRateBp: number
}

export type Discount = { kind: 'amount'; minor: number } | { kind: 'percent'; bp: number }

export interface BillLineInput {
  quantityMilli: number
  unitPriceMinor: number
  discount?: Discount | null | undefined
  tax: TaxRate
}

export interface BillInput {
  lines: readonly BillLineInput[]
  billDiscount?: Discount | null | undefined
}

export interface PricingRules {
  pricesIncludeTax: boolean
  regime: TaxRegime
  /** Round the payable amount to a multiple of this (minor units); 1 = no rounding. */
  roundingMinor: number
}

/** Steps the payable amount may be rounded to, in minor units (1 = none). */
export const ROUNDING_STEPS = [1, 5, 10, 50, 100, 500, 1000] as const

export interface TaxAmount {
  code: TaxComponentCode
  rateBp: number
  amountMinor: number
}

export interface LineCalculation {
  grossMinor: number
  lineDiscountMinor: number
  billDiscountMinor: number
  /** Line discount plus the bill-discount share: what `sale_items.discount_minor` stores. */
  discountMinor: number
  netMinor: number
  taxableMinor: number
  taxMinor: number
  taxes: TaxAmount[]
  totalMinor: number
}

export interface TaxSummaryRow extends TaxAmount {
  taxableMinor: number
}

export interface BillCalculation {
  lines: LineCalculation[]
  grossMinor: number
  discountMinor: number
  taxableMinor: number
  taxMinor: number
  /** Tax per component and rate, as GST invoices summarise it. */
  taxSummary: TaxSummaryRow[]
  /** Before rounding. */
  subtotalMinor: number
  roundOffMinor: number
  payableMinor: number
}

/** A bill the engine can't price: says which line (or the bill) and why, for the person entering it. */
export class PricingError extends RangeError {
  constructor(
    message: string,
    /** Index of the offending line; null for the bill as a whole. */
    readonly line: number | null
  ) {
    super(message)
    this.name = 'PricingError'
  }
}

const MAX_RATE_BP = 10_000

function assertWhole(value: number, what: string, line: number | null, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new PricingError(`${what} must be a whole number of at least ${min}`, line)
  }
}

/** The tax components charged at a class's rates under a regime. Zero rates charge nothing. */
export function taxComponents(
  regime: TaxRegime,
  rate: TaxRate
): { code: TaxComponentCode; rateBp: number }[] {
  if (regime === 'none') return []
  const parts: { code: TaxComponentCode; rateBp: number }[] = []
  if (rate.rateBp > 0) {
    if (regime === 'gst') {
      if (rate.rateBp % 2 !== 0) {
        throw new PricingError('A GST rate must split equally into CGST and SGST', null)
      }
      parts.push(
        { code: 'CGST', rateBp: rate.rateBp / 2 },
        { code: 'SGST', rateBp: rate.rateBp / 2 }
      )
    } else {
      parts.push({ code: 'TAX', rateBp: rate.rateBp })
    }
  }
  if (rate.cessRateBp > 0) parts.push({ code: 'CESS', rateBp: rate.cessRateBp })
  return parts
}

/** The amount a discount takes off `baseMinor`, checked against it. */
export function discountAmount(
  discount: Discount | null | undefined,
  baseMinor: number,
  line: number | null
): number {
  if (!discount) return 0
  if (discount.kind === 'percent') {
    if (!Number.isSafeInteger(discount.bp) || discount.bp < 0 || discount.bp > 10_000) {
      throw new PricingError('A discount must be between 0% and 100%', line)
    }
    return applyRate(baseMinor, discount.bp)
  }
  assertWhole(discount.minor, 'A discount', line)
  if (discount.minor > baseMinor) {
    throw new PricingError(
      line === null
        ? "The discount can't be more than the bill"
        : "The discount can't be more than the line",
      line
    )
  }
  return discount.minor
}

/** Round to the nearest multiple of `step`, halves away from zero. */
export function roundToStep(amountMinor: number, step: number): number {
  if (!Number.isSafeInteger(step) || step < 1)
    throw new RangeError('rounding step must be a positive integer')
  if (step === 1) return amountMinor
  return Number(divideRounded(BigInt(amountMinor), BigInt(step))) * step
}

/** Tax on one line's net amount. Components of equal rate (CGST, SGST) always come out equal. */
function taxLine(
  netMinor: number,
  components: readonly { code: TaxComponentCode; rateBp: number }[],
  pricesIncludeTax: boolean
): { taxableMinor: number; taxes: TaxAmount[]; taxMinor: number } {
  if (components.length === 0) return { taxableMinor: netMinor, taxes: [], taxMinor: 0 }
  // Inclusive prices: estimate the taxable value, tax it per component, and
  // let the taxable value absorb the rounding so net = taxable + tax exactly.
  const base = pricesIncludeTax
    ? netMinor -
      taxIncludedIn(
        netMinor,
        components.reduce((sum, c) => sum + c.rateBp, 0)
      )
    : netMinor
  const taxes = components.map((c) => ({ ...c, amountMinor: applyRate(base, c.rateBp) }))
  const taxMinor = taxes.reduce((sum, t) => sum + t.amountMinor, 0)
  return { taxableMinor: pricesIncludeTax ? netMinor - taxMinor : netMinor, taxes, taxMinor }
}

/** Price a bill (M10-02 to M10-04). Throws PricingError for impossible input. */
export function calculateBill(bill: BillInput, rules: PricingRules): BillCalculation {
  if (!(ROUNDING_STEPS as readonly number[]).includes(rules.roundingMinor)) {
    throw new RangeError(`Unsupported rounding step ${rules.roundingMinor}`)
  }
  const prepared = bill.lines.map((line, index) => {
    assertWhole(line.quantityMilli, 'The quantity', index, 1)
    assertWhole(line.unitPriceMinor, 'The price', index)
    for (const rate of [line.tax.rateBp, line.tax.cessRateBp]) {
      if (!Number.isSafeInteger(rate) || rate < 0 || rate > MAX_RATE_BP) {
        throw new PricingError('A tax rate must be between 0% and 100%', index)
      }
    }
    const grossMinor = multiplyByQuantity(line.unitPriceMinor, line.quantityMilli)
    const lineDiscountMinor = discountAmount(line.discount, grossMinor, index)
    let components
    try {
      components = taxComponents(rules.regime, line.tax)
    } catch (error) {
      if (error instanceof PricingError) throw new PricingError(error.message, index)
      throw error
    }
    return {
      grossMinor,
      lineDiscountMinor,
      afterLineMinor: grossMinor - lineDiscountMinor,
      components
    }
  })

  // M10-03: a bill discount is shared over the lines in proportion to what
  // is left of each after its own discount; the shares add up exactly.
  const afterLines = prepared.reduce((sum, line) => sum + line.afterLineMinor, 0)
  const billDiscountMinor = discountAmount(bill.billDiscount, afterLines, null)
  const shares =
    billDiscountMinor === 0 || prepared.length === 0
      ? prepared.map(() => 0)
      : allocate(
          billDiscountMinor,
          prepared.map((line) => line.afterLineMinor)
        )

  const lines = prepared.map((line, index): LineCalculation => {
    const billShare = shares[index] ?? 0
    const netMinor = line.afterLineMinor - billShare
    const { taxableMinor, taxes, taxMinor } = taxLine(
      netMinor,
      line.components,
      rules.pricesIncludeTax
    )
    return {
      grossMinor: line.grossMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      billDiscountMinor: billShare,
      discountMinor: line.lineDiscountMinor + billShare,
      netMinor,
      taxableMinor,
      taxMinor,
      taxes,
      totalMinor: rules.pricesIncludeTax ? netMinor : netMinor + taxMinor
    }
  })

  const sum = (pick: (line: LineCalculation) => number): number =>
    lines.reduce((total, line) => total + pick(line), 0)
  const subtotalMinor = sum((l) => l.totalMinor)
  const payableMinor = roundToStep(subtotalMinor, rules.roundingMinor)

  const summary = new Map<string, TaxSummaryRow>()
  for (const line of lines) {
    for (const tax of line.taxes) {
      const key = `${tax.code}:${tax.rateBp}`
      const row = summary.get(key) ?? { ...tax, amountMinor: 0, taxableMinor: 0 }
      row.amountMinor += tax.amountMinor
      // CESS is charged on the same taxable value as GST; each row shows it once.
      row.taxableMinor += line.taxableMinor
      summary.set(key, row)
    }
  }

  return {
    lines,
    grossMinor: sum((l) => l.grossMinor),
    discountMinor: sum((l) => l.discountMinor),
    taxableMinor: sum((l) => l.taxableMinor),
    taxMinor: sum((l) => l.taxMinor),
    taxSummary: [...summary.values()],
    subtotalMinor,
    roundOffMinor: payableMinor - subtotalMinor,
    payableMinor
  }
}

/**
 * Whether a bill's discounts go beyond the store limit (M10-05): all
 * discounts together, as a share of the gross amount. Above it, the
 * cashier needs `discount.override` or a manager's approval.
 */
export function discountExceedsLimit(
  bill: Pick<BillCalculation, 'grossMinor' | 'discountMinor'>,
  maxDiscountBp: number
): boolean {
  return BigInt(bill.discountMinor) * 10_000n > BigInt(maxDiscountBp) * BigInt(bill.grossMinor)
}
