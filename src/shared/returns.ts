/**
 * What a customer return is worth (M16-02, M16-04).
 *
 * Pure and dependency-free, like the pricing engine: the main process uses it
 * to decide what is credited and refunded, and the return screen uses the
 * same function to show it, so the two cannot disagree.
 *
 * A return credits a share of what the customer actually paid for the line,
 * after the line discount and its share of any bill discount: the line's
 * `net` amount (`gross - discount`), which is tax-inclusive when the store's
 * prices include tax and tax-exclusive otherwise. Tax is credited the same
 * way, component by component. When prices exclude tax the refund is the
 * credit plus its tax; when they include tax it is the credit itself.
 *
 * Shares use *cumulative* rounding: the credit for the Nth unit returned is
 * `round(net × returned-so-far / sold)` minus what was credited before. So
 * however a line is returned (one go, many, split by disposition), the credits
 * add up to exactly what was paid once everything is back, never a paisa off.
 * The sale's bill-level round-off is not refunded.
 */
import { divideRounded } from './money'

export const RETURN_DISPOSITIONS = ['restock', 'quarantine', 'write_off'] as const
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number]

export const RETURN_DISPOSITION_LABELS: Record<ReturnDisposition, string> = {
  restock: 'Back into stock',
  quarantine: 'Set aside (quarantine)',
  write_off: 'Write off (damaged or unsellable)'
}

export interface ReturnTaxShare {
  code: string
  rateBp: number
  amountMinor: number
}

/** What was sold on one invoice line, and how much of it has come back already. */
export interface ReturnableItemFacts {
  saleItemId: number
  soldMilli: number
  /** `gross - discount` for the whole line, on the sale's price basis. */
  netMinor: number
  /** Tax charged on the whole line, per component. */
  taxes: readonly ReturnTaxShare[]
  priorReturnedMilli: number
}

export interface ReturnLineRequest {
  saleItemId: number
  quantityMilli: number
  disposition: ReturnDisposition
}

export interface ReturnLineQuote {
  saleItemId: number
  disposition: ReturnDisposition
  quantityMilli: number
  /** On the sale's price basis (see above). */
  creditMinor: number
  taxes: ReturnTaxShare[]
  taxMinor: number
}

export interface ReturnQuote {
  lines: ReturnLineQuote[]
  creditMinor: number
  taxMinor: number
  /** What goes back to the customer: the credit, plus tax when prices exclude tax. */
  refundDueMinor: number
}

/** A return that can't be made as asked. `line` is the index of the offending line, if any. */
export class ReturnError extends Error {
  constructor(
    message: string,
    readonly line: number | null = null
  ) {
    super(message)
    this.name = 'ReturnError'
  }
}

function share(totalMinor: number, quantityMilli: number, soldMilli: number): number {
  return Number(divideRounded(BigInt(totalMinor) * BigInt(quantityMilli), BigInt(soldMilli)))
}

export function quoteReturn(
  items: readonly ReturnableItemFacts[],
  requested: readonly ReturnLineRequest[],
  pricesIncludeTax: boolean
): ReturnQuote {
  if (requested.length === 0) throw new ReturnError('Choose at least one item to return')
  const byId = new Map(items.map((item) => [item.saleItemId, item]))
  const running = new Map(items.map((item) => [item.saleItemId, item.priorReturnedMilli]))

  const lines = requested.map((request, index): ReturnLineQuote => {
    const item = byId.get(request.saleItemId)
    if (!item) throw new ReturnError('That item is not on this invoice', index)
    if (!Number.isSafeInteger(request.quantityMilli) || request.quantityMilli <= 0) {
      throw new ReturnError('Enter a quantity above zero', index)
    }
    const before = running.get(item.saleItemId) ?? 0
    const after = before + request.quantityMilli
    if (after > item.soldMilli) {
      const left = item.soldMilli - item.priorReturnedMilli
      throw new ReturnError(
        left <= 0
          ? 'All of this item has already been returned'
          : 'More than was sold, or already returned, on this invoice',
        index
      )
    }
    running.set(item.saleItemId, after)

    const creditMinor =
      share(item.netMinor, after, item.soldMilli) - share(item.netMinor, before, item.soldMilli)
    const taxes = item.taxes.map((tax) => ({
      code: tax.code,
      rateBp: tax.rateBp,
      amountMinor:
        share(tax.amountMinor, after, item.soldMilli) -
        share(tax.amountMinor, before, item.soldMilli)
    }))
    return {
      saleItemId: item.saleItemId,
      disposition: request.disposition,
      quantityMilli: request.quantityMilli,
      creditMinor,
      taxes,
      taxMinor: taxes.reduce((sum, tax) => sum + tax.amountMinor, 0)
    }
  })

  const creditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0)
  const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0)
  return {
    lines,
    creditMinor,
    taxMinor,
    refundDueMinor: pricesIncludeTax ? creditMinor : creditMinor + taxMinor
  }
}

/** What each refund method is asked to return, against what is due. */
export function checkRefunds(
  refundDueMinor: number,
  refunds: readonly { amountMinor: number }[]
): { allocatedMinor: number; remainingMinor: number } {
  const allocatedMinor = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)
  return { allocatedMinor, remainingMinor: refundDueMinor - allocatedMinor }
}
