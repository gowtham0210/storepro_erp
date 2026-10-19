/**
 * Payment rules and cash change calculation (M12): cash tendering, change due,
 * split payments, and UPI reference recording ("recorded, not verified").
 *
 * Runtime-dependency free: shared by renderer and main process.
 */

export const PAYMENT_KINDS = ['cash', 'upi', 'card', 'other'] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]

/**
 * Label shown alongside UPI payments (M12-03, FR-035): StorePro records the
 * reference entered by the cashier without contacting a payment gateway.
 */
export const UPI_RECORDED_NOTICE = 'Recorded (not verified)'

export interface PaymentEntryInput {
  paymentMethodId: number
  kind: PaymentKind
  amountMinor: number
  /** Cash handed over by the customer; defaults to `amountMinor` for cash, null for non-cash. */
  tenderedMinor?: number | null | undefined
  /** Payer-side reference (e.g. UPI transaction ID). Recorded, not verified. */
  reference?: string | null | undefined
}

export interface CalculatedPayment {
  paymentMethodId: number
  kind: PaymentKind
  amountMinor: number
  tenderedMinor: number | null
  changeMinor: number
  reference: string | null
  verificationNotice: typeof UPI_RECORDED_NOTICE | null
}

export interface PaymentCalculation {
  payments: CalculatedPayment[]
  paidMinor: number
  tenderedMinor: number
  changeMinor: number
}

export class PaymentError extends RangeError {
  constructor(
    message: string,
    readonly line: number | null
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

function assertWhole(value: number, what: string, line: number | null, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new PaymentError(`${what} must be a whole number of at least ${min}`, line)
  }
}

function cleanReference(reference: string | null | undefined): string | null {
  if (reference === null || reference === undefined) return null
  const trimmed = reference.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Cash tendering and change calculation for a single cash payment (M12-02).
 * `amountMinor` is what applies to the bill; `tenderedMinor` is the cash
 * handed over (`>= amountMinor`), and `changeMinor` is returned to the customer.
 */
export function planCashTender(
  amountDueMinor: number,
  tenderedMinor?: number | null | undefined
): { amountMinor: number; tenderedMinor: number; changeMinor: number } {
  assertWhole(amountDueMinor, 'The amount due', null, 1)
  const tendered = tenderedMinor ?? amountDueMinor
  assertWhole(tendered, 'The cash tendered', null, 0)
  if (tendered < amountDueMinor) {
    throw new PaymentError('Cash tendered must be at least the amount due', null)
  }
  return {
    amountMinor: amountDueMinor,
    tenderedMinor: tendered,
    changeMinor: tendered - amountDueMinor
  }
}

/**
 * Validate and calculate the payments for a bill of `payableMinor` (M12-01 to M12-03).
 *
 *  - `sale_payments.amount_minor` sums to `payableMinor` (matching `v_sale_totals.paid_minor`).
 *  - Cash lines record `tenderedMinor` (`>= amountMinor`) and derive `changeMinor`.
 *  - UPI lines carry `UPI_RECORDED_NOTICE` ("Recorded (not verified)").
 */
export function calculatePayments(
  payableMinor: number,
  entries: readonly PaymentEntryInput[]
): PaymentCalculation {
  assertWhole(payableMinor, 'The payable amount', null, 0)

  if (payableMinor === 0) {
    if (entries.length > 0) {
      throw new PaymentError('No payment is needed when the bill total is zero', null)
    }
    return { payments: [], paidMinor: 0, tenderedMinor: 0, changeMinor: 0 }
  }

  if (entries.length === 0) {
    throw new PaymentError('Add at least one payment', null)
  }

  const payments = entries.map((entry, index): CalculatedPayment => {
    assertWhole(entry.paymentMethodId, 'The payment method', index, 1)
    assertWhole(entry.amountMinor, 'The payment amount', index, 1)
    const reference = cleanReference(entry.reference)

    if (entry.kind === 'cash') {
      const tendered = entry.tenderedMinor ?? entry.amountMinor
      assertWhole(tendered, 'The cash tendered', index, 1)
      if (tendered < entry.amountMinor) {
        throw new PaymentError('Cash tendered must be at least the cash amount', index)
      }
      return {
        paymentMethodId: entry.paymentMethodId,
        kind: entry.kind,
        amountMinor: entry.amountMinor,
        tenderedMinor: tendered,
        changeMinor: tendered - entry.amountMinor,
        reference,
        verificationNotice: null
      }
    }

    if (
      entry.tenderedMinor !== null &&
      entry.tenderedMinor !== undefined &&
      entry.tenderedMinor !== entry.amountMinor
    ) {
      throw new PaymentError('Only cash payments can give change', index)
    }

    return {
      paymentMethodId: entry.paymentMethodId,
      kind: entry.kind,
      amountMinor: entry.amountMinor,
      tenderedMinor: null,
      changeMinor: 0,
      reference,
      verificationNotice: entry.kind === 'upi' ? UPI_RECORDED_NOTICE : null
    }
  })

  const paidMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0)
  if (paidMinor < payableMinor) {
    throw new PaymentError('Payments are less than the amount payable', null)
  }
  if (paidMinor > payableMinor) {
    throw new PaymentError('Payments exceed the amount payable', null)
  }

  const tenderedMinor = payments.reduce((sum, p) => sum + (p.tenderedMinor ?? p.amountMinor), 0)
  const changeMinor = payments.reduce((sum, p) => sum + p.changeMinor, 0)

  return {
    payments,
    paidMinor,
    tenderedMinor,
    changeMinor
  }
}
