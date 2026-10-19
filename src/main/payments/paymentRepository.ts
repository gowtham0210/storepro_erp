import type {
  PaymentMethodCreateInput,
  PaymentMethodInfo,
  ReturnRefundDetail,
  SalePaymentDetail
} from '@shared/ipc/contract'
import { UPI_RECORDED_NOTICE, type CalculatedPayment, type PaymentKind } from '@shared/payments'
import { NotFoundError, Repository } from '../db/repository'

interface MethodRow {
  payment_method_id: number
  method_code: string
  name: string
  kind: PaymentKind
  sort_order: number
  archived_at: number | null
  in_use: number
}

interface SalePaymentRow {
  sale_payment_id: number
  payment_method_id: number
  method_code: string
  method_name: string
  kind: PaymentKind
  amount_minor: number
  tendered_minor: number | null
  reference: string | null
}

interface ReturnRefundRow {
  return_refund_id: number
  sale_return_id: number
  return_number: string
  sale_id: number
  returned_at: number
  payment_method_id: number
  method_code: string
  method_name: string
  kind: PaymentKind
  amount_minor: number
  reference: string | null
}

const IN_USE = `(
  EXISTS (SELECT 1 FROM sale_payments x WHERE x.payment_method_id = pm.payment_method_id) OR
  EXISTS (SELECT 1 FROM return_refunds x WHERE x.payment_method_id = pm.payment_method_id) OR
  EXISTS (SELECT 1 FROM expenses x WHERE x.payment_method_id = pm.payment_method_id)
)`

function toMethod(row: MethodRow): PaymentMethodInfo {
  return {
    paymentMethodId: row.payment_method_id,
    methodCode: row.method_code,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sort_order,
    active: row.archived_at === null,
    inUse: row.in_use === 1
  }
}

function toSalePayment(row: SalePaymentRow): SalePaymentDetail {
  const tenderedMinor = row.kind === 'cash' ? (row.tendered_minor ?? row.amount_minor) : null
  const changeMinor =
    row.kind === 'cash' && tenderedMinor !== null ? tenderedMinor - row.amount_minor : 0
  return {
    salePaymentId: row.sale_payment_id,
    paymentMethodId: row.payment_method_id,
    methodCode: row.method_code,
    methodName: row.method_name,
    kind: row.kind,
    amountMinor: row.amount_minor,
    tenderedMinor,
    changeMinor,
    reference: row.reference,
    verificationNotice: row.kind === 'upi' ? UPI_RECORDED_NOTICE : null
  }
}

function toReturnRefund(row: ReturnRefundRow): ReturnRefundDetail {
  return {
    returnRefundId: row.return_refund_id,
    saleReturnId: row.sale_return_id,
    returnNumber: row.return_number,
    saleId: row.sale_id,
    returnedAt: row.returned_at,
    paymentMethodId: row.payment_method_id,
    methodCode: row.method_code,
    methodName: row.method_name,
    kind: row.kind,
    amountMinor: row.amount_minor,
    reference: row.reference
  }
}

/**
 * Payment methods, sale payment records and linked return refund records (M12).
 */
export class PaymentRepository extends Repository {
  listMethods(options: { activeOnly?: boolean } = {}): PaymentMethodInfo[] {
    return this.db
      .all<MethodRow>(
        `SELECT pm.*, ${IN_USE} AS in_use
         FROM payment_methods pm
         ${options.activeOnly ? 'WHERE pm.archived_at IS NULL' : ''}
         ORDER BY pm.archived_at IS NOT NULL, pm.sort_order, pm.name COLLATE NOCASE`
      )
      .map(toMethod)
  }

  findMethod(paymentMethodId: number): PaymentMethodInfo | null {
    const row = this.db.get<MethodRow>(
      `SELECT pm.*, ${IN_USE} AS in_use FROM payment_methods pm WHERE pm.payment_method_id = ?`,
      [paymentMethodId]
    )
    return row ? toMethod(row) : null
  }

  findMethodByCode(methodCode: string): PaymentMethodInfo | null {
    const row = this.db.get<MethodRow>(
      `SELECT pm.*, ${IN_USE} AS in_use FROM payment_methods pm WHERE pm.method_code = ?`,
      [methodCode]
    )
    return row ? toMethod(row) : null
  }

  findMethodByName(name: string): PaymentMethodInfo | null {
    const row = this.db.get<MethodRow>(
      `SELECT pm.*, ${IN_USE} AS in_use FROM payment_methods pm WHERE pm.name = ? COLLATE NOCASE`,
      [name]
    )
    return row ? toMethod(row) : null
  }

  createMethod(input: PaymentMethodCreateInput): number {
    const nextSort =
      input.sortOrder ??
      (this.db.get<{ max_sort: number }>(
        'SELECT coalesce(max(sort_order), 0) + 1 AS max_sort FROM payment_methods'
      )?.max_sort ?? 1)
    return this.insert('payment_methods', {
      method_code: input.methodCode,
      name: input.name,
      kind: input.kind,
      sort_order: nextSort
    })
  }

  updateMethod(
    paymentMethodId: number,
    input: { name: string; kind: PaymentKind; sortOrder: number }
  ): void {
    const result = this.db.run(
      `UPDATE payment_methods
       SET name = ?, kind = ?, sort_order = ?
       WHERE payment_method_id = ?`,
      [input.name, input.kind, input.sortOrder, paymentMethodId]
    )
    if (result.changes === 0) throw new NotFoundError('payment_methods', paymentMethodId)
  }

  setMethodActive(paymentMethodId: number, active: boolean): void {
    const result = this.db.run(
      `UPDATE payment_methods
       SET archived_at = CASE WHEN ? = 1 THEN NULL ELSE coalesce(archived_at, ?) END
       WHERE payment_method_id = ?`,
      [active ? 1 : 0, this.now(), paymentMethodId]
    )
    if (result.changes === 0) throw new NotFoundError('payment_methods', paymentMethodId)
  }

  /** Record the validated payment lines for a sale inside the checkout transaction (M12-01 to M12-03). */
  recordSalePayments(saleId: number, payments: readonly CalculatedPayment[]): void {
    for (const payment of payments) {
      this.insert('sale_payments', {
        sale_id: saleId,
        payment_method_id: payment.paymentMethodId,
        amount_minor: payment.amountMinor,
        tendered_minor: payment.tenderedMinor,
        reference: payment.reference
      })
    }
  }

  listSalePayments(saleId: number): SalePaymentDetail[] {
    return this.db
      .all<SalePaymentRow>(
        `SELECT sp.sale_payment_id, sp.payment_method_id, pm.method_code, pm.name AS method_name,
                pm.kind, sp.amount_minor, sp.tendered_minor, sp.reference
         FROM sale_payments sp
         JOIN payment_methods pm ON pm.payment_method_id = sp.payment_method_id
         WHERE sp.sale_id = ?
         ORDER BY sp.sale_payment_id`,
        [saleId]
      )
      .map(toSalePayment)
  }

  /** Record linked refund payments against a sale return (M12-04). */
  recordReturnRefunds(
    saleReturnId: number,
    refunds: readonly { paymentMethodId: number; amountMinor: number; reference: string | null }[]
  ): void {
    for (const refund of refunds) {
      this.insert('return_refunds', {
        sale_return_id: saleReturnId,
        payment_method_id: refund.paymentMethodId,
        amount_minor: refund.amountMinor,
        reference: refund.reference
      })
    }
  }

  listReturnRefunds(saleReturnId: number): ReturnRefundDetail[] {
    return this.db
      .all<ReturnRefundRow>(
        `SELECT rf.return_refund_id, rf.sale_return_id, sr.return_number, sr.sale_id, sr.returned_at,
                rf.payment_method_id, pm.method_code, pm.name AS method_name, pm.kind,
                rf.amount_minor, rf.reference
         FROM return_refunds rf
         JOIN sale_returns sr ON sr.sale_return_id = rf.sale_return_id
         JOIN payment_methods pm ON pm.payment_method_id = rf.payment_method_id
         WHERE rf.sale_return_id = ?
         ORDER BY rf.return_refund_id`,
        [saleReturnId]
      )
      .map(toReturnRefund)
  }

  /** All refund payment records linked to a completed sale through its returns (M12-04). */
  listRefundsForSale(saleId: number): ReturnRefundDetail[] {
    return this.db
      .all<ReturnRefundRow>(
        `SELECT rf.return_refund_id, rf.sale_return_id, sr.return_number, sr.sale_id, sr.returned_at,
                rf.payment_method_id, pm.method_code, pm.name AS method_name, pm.kind,
                rf.amount_minor, rf.reference
         FROM return_refunds rf
         JOIN sale_returns sr ON sr.sale_return_id = rf.sale_return_id
         JOIN payment_methods pm ON pm.payment_method_id = rf.payment_method_id
         WHERE sr.sale_id = ?
         ORDER BY rf.return_refund_id`,
        [saleId]
      )
      .map(toReturnRefund)
  }
}
