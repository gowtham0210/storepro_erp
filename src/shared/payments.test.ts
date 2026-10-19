import { describe, expect, it } from 'vitest'
import {
  calculatePayments,
  PaymentError,
  planCashTender,
  UPI_RECORDED_NOTICE
} from './payments'

describe('planCashTender (M12-02)', () => {
  it('calculates exact cash and change when more cash is handed over', () => {
    expect(planCashTender(34_000)).toEqual({
      amountMinor: 34_000,
      tenderedMinor: 34_000,
      changeMinor: 0
    })
    expect(planCashTender(34_000, 50_000)).toEqual({
      amountMinor: 34_000,
      tenderedMinor: 50_000,
      changeMinor: 16_000
    })
  })

  it('rejects tendered cash below the amount due', () => {
    expect(() => planCashTender(34_000, 30_000)).toThrow(
      new PaymentError('Cash tendered must be at least the amount due', null)
    )
  })
})

describe('calculatePayments (M12-01 to M12-03)', () => {
  it('handles cash payment with tendered amount and change', () => {
    const result = calculatePayments(24_500, [
      { paymentMethodId: 1, kind: 'cash', amountMinor: 24_500, tenderedMinor: 50_000 }
    ])
    expect(result).toEqual({
      payments: [
        {
          paymentMethodId: 1,
          kind: 'cash',
          amountMinor: 24_500,
          tenderedMinor: 50_000,
          changeMinor: 25_500,
          reference: null,
          verificationNotice: null
        }
      ],
      paidMinor: 24_500,
      tenderedMinor: 50_000,
      changeMinor: 25_500
    })
  })

  it('records UPI payment with reference and labels it as recorded, not verified', () => {
    const result = calculatePayments(15_000, [
      {
        paymentMethodId: 2,
        kind: 'upi',
        amountMinor: 15_000,
        reference: '  412389001122  '
      }
    ])
    expect(result.payments[0]).toEqual({
      paymentMethodId: 2,
      kind: 'upi',
      amountMinor: 15_000,
      tenderedMinor: null,
      changeMinor: 0,
      reference: '412389001122',
      verificationNotice: UPI_RECORDED_NOTICE
    })
  })

  it('supports split payments across cash and UPI', () => {
    const result = calculatePayments(50_000, [
      { paymentMethodId: 2, kind: 'upi', amountMinor: 30_000, reference: 'UPI-123' },
      { paymentMethodId: 1, kind: 'cash', amountMinor: 20_000, tenderedMinor: 25_000 }
    ])
    expect(result.paidMinor).toBe(50_000)
    expect(result.tenderedMinor).toBe(55_000)
    expect(result.changeMinor).toBe(5_000)
  })

  it('allows zero-total bills only when no payment rows are given', () => {
    expect(calculatePayments(0, [])).toEqual({
      payments: [],
      paidMinor: 0,
      tenderedMinor: 0,
      changeMinor: 0
    })
    expect(() =>
      calculatePayments(0, [{ paymentMethodId: 1, kind: 'cash', amountMinor: 100 }])
    ).toThrow(/No payment is needed/)
  })

  it('rejects underpayment, overpayment, and change on non-cash methods', () => {
    expect(() => calculatePayments(10_000, [])).toThrow(/Add at least one payment/)
    expect(() =>
      calculatePayments(10_000, [{ paymentMethodId: 1, kind: 'cash', amountMinor: 9_000 }])
    ).toThrow(/less than the amount payable/)
    expect(() =>
      calculatePayments(10_000, [{ paymentMethodId: 1, kind: 'cash', amountMinor: 11_000 }])
    ).toThrow(/exceed the amount payable/)
    expect(() =>
      calculatePayments(10_000, [
        { paymentMethodId: 2, kind: 'upi', amountMinor: 10_000, tenderedMinor: 12_000 }
      ])
    ).toThrow(/Only cash payments can give change/)
  })
})
