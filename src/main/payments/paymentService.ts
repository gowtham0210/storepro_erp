import type {
  CheckoutPaymentInput,
  PaymentMethodCreateInput,
  PaymentMethodInfo,
  PaymentMethodUpdateInput
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import {
  calculatePayments,
  PaymentError,
  type CalculatedPayment,
  type PaymentEntryInput
} from '@shared/payments'
import { changesBetween, type AuditLog } from '../audit/auditLog'
import { assertCan, type Actor } from '../auth/access'
import { conflict, invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { PaymentRepository } from './paymentRepository'

export interface PaymentServiceDeps {
  db: Database
  payments: PaymentRepository
  audit: AuditLog
}

/**
 * Payment method configuration and payment validation (M12).
 */
export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  listMethods(): PaymentMethodInfo[] {
    return this.deps.payments.listMethods()
  }

  createMethod(actor: Actor, input: PaymentMethodCreateInput): PaymentMethodInfo {
    assertCan(actor, 'settings.edit')
    const { db, payments, audit } = this.deps
    const id = db.transaction(() => {
      const byCode = payments.findMethodByCode(input.methodCode)
      if (byCode) {
        throw conflict(
          'methodCode',
          `There is already a payment method with code “${byCode.methodCode}”`
        )
      }
      const byName = payments.findMethodByName(input.name)
      if (byName) {
        throw conflict('name', `There is already a payment method called “${byName.name}”`)
      }
      const paymentMethodId = payments.createMethod(input)
      audit.change({
        action: 'payment_method.created',
        actor,
        entity: { type: 'payment_method', id: paymentMethodId },
        details: {
          name: input.name,
          code: input.methodCode,
          kind: input.kind
        }
      })
      return paymentMethodId
    })
    return this.requireMethod(id)
  }

  updateMethod(actor: Actor, input: PaymentMethodUpdateInput): PaymentMethodInfo {
    assertCan(actor, 'settings.edit')
    const { db, payments, audit } = this.deps
    db.transaction(() => {
      const before = this.requireMethod(input.paymentMethodId)
      const byName = payments.findMethodByName(input.name)
      if (byName && byName.paymentMethodId !== input.paymentMethodId) {
        throw conflict('name', `There is already a payment method called “${byName.name}”`)
      }
      if (before.inUse && input.kind !== before.kind) {
        throw new AppError(
          'CONFLICT',
          `“${before.name}” has been used on transactions, so its payment type cannot be changed.`
        )
      }
      const sortOrder = input.sortOrder ?? before.sortOrder
      const changes = changesBetween(
        { name: before.name, kind: before.kind, sortOrder: before.sortOrder },
        { name: input.name, kind: input.kind, sortOrder }
      )
      if (!changes) return
      payments.updateMethod(input.paymentMethodId, {
        name: input.name,
        kind: input.kind,
        sortOrder
      })
      audit.change({
        action: 'payment_method.updated',
        actor,
        entity: { type: 'payment_method', id: input.paymentMethodId },
        details: { name: input.name, changes }
      })
    })
    return this.requireMethod(input.paymentMethodId)
  }

  setMethodActive(
    actor: Actor,
    { paymentMethodId, active }: { paymentMethodId: number; active: boolean }
  ): PaymentMethodInfo {
    assertCan(actor, 'settings.edit')
    const { db, payments, audit } = this.deps
    db.transaction(() => {
      const before = this.requireMethod(paymentMethodId)
      if (before.active === active) return
      if (!active && payments.listMethods({ activeOnly: true }).length <= 1) {
        throw new AppError('CONFLICT', 'At least one payment method must stay active.')
      }
      payments.setMethodActive(paymentMethodId, active)
      audit.change({
        action: active ? 'payment_method.restored' : 'payment_method.archived',
        actor,
        entity: { type: 'payment_method', id: paymentMethodId },
        details: { name: before.name }
      })
    })
    return this.requireMethod(paymentMethodId)
  }

  /**
   * Resolve payment methods, verify they are active, and run the pure payment
   * and change rules (`calculatePayments`) for `payableMinor` (M12-01 to M12-03).
   */
  validateSalePayments(
    payableMinor: number,
    inputs: readonly CheckoutPaymentInput[]
  ): CalculatedPayment[] {
    const entries: PaymentEntryInput[] = inputs.map((item, index) => {
      const method = this.deps.payments.findMethod(item.paymentMethodId)
      if (!method) {
        throw invalid(`payments.${index}.paymentMethodId`, 'That payment method does not exist')
      }
      if (!method.active) {
        throw invalid(
          `payments.${index}.paymentMethodId`,
          `Payment method “${method.name}” is archived`
        )
      }
      return {
        paymentMethodId: method.paymentMethodId,
        kind: method.kind,
        amountMinor: item.amountMinor,
        tenderedMinor: item.tenderedMinor,
        reference: item.reference
      }
    })

    try {
      return calculatePayments(payableMinor, entries).payments
    } catch (error) {
      if (error instanceof PaymentError) {
        const path = error.line === null ? 'payments' : `payments.${error.line}.amountMinor`
        throw invalid(path, error.message)
      }
      throw error
    }
  }

  private requireMethod(paymentMethodId: number): PaymentMethodInfo {
    const found = this.deps.payments.findMethod(paymentMethodId)
    if (!found) throw new AppError('NOT_FOUND', 'That payment method no longer exists.')
    return found
  }
}
