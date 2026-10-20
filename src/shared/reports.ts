/**
 * What the report figures mean (M19-02, FR-096).
 *
 * Gross sales, discounts, tax, refunds, net sales and collections are different
 * things, and each is reported on its own line; none is folded into another
 * "total". This file is the one place that says what each means, so the
 * screens, the CSV exports and `docs/reports.md` all use the same words, and
 * the queries are written to match.
 *
 * Rules that apply to every figure:
 *
 *  - **Finalised transactions only.** A sale counts once it is completed; held
 *    bills never do. A **voided** sale is left out of every figure and shown on
 *    its own line (`voided`). Reports show the current state, so a sale voided
 *    later disappears from the day it was billed on.
 *  - **Reversals are applied on their own day.** A refund counts on the day of
 *    the return, whenever the sale was made, so a past day's figures only change
 *    through voids.
 *  - **The store's day.** A day runs midnight to midnight in the store's time
 *    zone (`businesses.time_zone`), including 23 and 25 hour days at a clock
 *    change. Dates in a report are those store dates, both ends included.
 *  - **Exact money.** Every figure is an integer in minor units, summed from
 *    stored amounts; nothing is estimated or rounded except the average bill.
 *  - **The invoice's own price basis.** A sale's amounts are those saved on the
 *    invoice. If the store changed between prices that include tax and prices
 *    that exclude it, sales on either side keep their own basis.
 *
 * Runtime-dependency free: used by both processes.
 */
import { divideRounded } from './money'

export const REPORT_METRICS = {
  bills: {
    label: 'Bills',
    definition: 'Completed sales that were not voided, counted on the day they were billed.'
  },
  grossSales: {
    label: 'Gross sales',
    definition:
      'Quantity × price for every item sold, before any discount. Tax is inside it when the store’s prices include tax.'
  },
  discounts: {
    label: 'Discounts',
    definition: 'Line discounts plus each line’s share of any bill discount.'
  },
  tax: {
    label: 'Tax',
    definition:
      'GST or sales tax charged on those bills. It is already inside the billed total, whichever way the store prices.'
  },
  roundOff: {
    label: 'Round-off',
    definition: 'The adjustment that rounds each bill to the store’s rounding step.'
  },
  billed: {
    label: 'Billed total',
    definition:
      'What customers were charged: gross sales minus discounts, plus tax when prices exclude it, plus round-off.'
  },
  refunds: {
    label: 'Refunds',
    definition:
      'What was paid back on returns taken in the period, goods and their tax, counted on the day of the return.'
  },
  refundedTax: {
    label: 'Tax refunded',
    definition: 'The part of the refunds that is tax.'
  },
  netSales: {
    label: 'Net sales',
    definition: 'Billed total minus refunds.'
  },
  collections: {
    label: 'Collected',
    definition: 'Money received on those bills, by payment method.'
  },
  refundPayouts: {
    label: 'Paid back',
    definition: 'Refund money paid out on returns in the period, by payment method.'
  },
  netCollections: {
    label: 'Net collected',
    definition: 'Collected minus paid back, by payment method.'
  },
  voided: {
    label: 'Voided',
    definition: 'Bills cancelled after billing. They are left out of every figure above.'
  },
  averageBill: {
    label: 'Average bill',
    definition: 'Billed total divided by the number of bills, rounded to the minor unit.'
  }
} as const

export type ReportMetric = keyof typeof REPORT_METRICS

/** Billed total ÷ bills, rounded half up; 0 when there were no bills. */
export function averageBill(billedMinor: number, billCount: number): number {
  if (billCount <= 0) return 0
  return Number(divideRounded(BigInt(billedMinor), BigInt(billCount)))
}

/** The most days one report can span, so a report stays quick and a table stays readable. */
export const MAX_REPORT_DAYS = 731
