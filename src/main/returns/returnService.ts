import type {
  ReturnableSale,
  ReturnDetail,
  ReturnInput,
  ReturnListFilter,
  ReturnListPage,
  ReturnReceiptInput,
  ReturnReceiptPreview,
  ReturnReceiptPrintInput,
  PrintJobResult
} from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import { DEFAULT_CURRENCY, formatMoney } from '@shared/money'
import { formatQuantity, QUANTITY_SCALE } from '@shared/quantity'
import { renderReceiptHtml } from '@shared/receipt'
import {
  quoteReturn,
  RETURN_DISPOSITION_LABELS,
  ReturnError,
  type ReturnLineRequest
} from '@shared/returns'
import { buildReturnReceiptDocument } from '@shared/returnReceipt'
import type { AuditLog } from '../audit/auditLog'
import { assertCan, forbidden, type Actor } from '../auth/access'
import { conflict, invalid } from '../catalog/catalogService'
import type { Database } from '../db/database'
import type { PaymentRepository } from '../payments/paymentRepository'
import type { PrintingService } from '../printing/printingService'
import type { StoreRepository } from '../store/storeRepository'
import type { ReturnRepository } from './returnRepository'

export interface ReturnServiceDeps {
  db: Database
  returns: ReturnRepository
  payments: PaymentRepository
  store: StoreRepository
  audit: AuditLog
  printing: PrintingService
}

/**
 * Customer returns and refunds (M16).
 *
 * A return is made against one invoice, for some or all of its lines, and is
 * one atomic record: the return, its lines (each with what happens to the
 * goods), the tax credited, and the refund payments. The same quantity can't
 * come back twice (checked here and by a database trigger), a voided invoice
 * can't be returned, and the original sale is never changed.
 *
 * Stock follows the disposition: goods marked `restock` go back into stock
 * through the ledger; `quarantine` and `write_off` do not. Taking a return
 * needs `return.create`, which cashiers don't hold: they ask a manager to
 * approve it at the counter.
 */
export class ReturnService {
  constructor(private readonly deps: ReturnServiceDeps) {}

  /** M16-01: find an invoice to return against, with what can still come back. */
  findSale(actor: Actor, { invoiceNumber }: { invoiceNumber: string }): ReturnableSale | null {
    assertCan(actor, 'sale.view')
    const saleId = this.deps.returns.findSaleId(invoiceNumber)
    return saleId === null ? null : this.deps.returns.getReturnableSale(saleId)
  }

  list(actor: Actor, filter: ReturnListFilter = {}): ReturnListPage {
    assertCan(actor, 'sale.view')
    return this.deps.returns.list(filter)
  }

  get(actor: Actor, { saleReturnId }: { saleReturnId: number }): ReturnDetail {
    assertCan(actor, 'sale.view')
    return this.require(saleReturnId)
  }

  /** M16-02 to M16-04, M16-06: record the return, its refunds and its audit entry together. */
  create(actor: Actor, input: ReturnInput): ReturnDetail {
    assertCan(actor, 'return.create')
    const { db, returns, payments, audit } = this.deps
    const saleReturnId = db.transaction(() => {
      const sale = returns.getReturnableSale(input.saleId)
      if (!sale) throw new AppError('NOT_FOUND', 'That invoice no longer exists.')
      if (sale.isVoided) {
        throw conflict(
          'saleId',
          `Invoice ${sale.invoiceNumber} was voided, so nothing can be returned against it.`
        )
      }

      // One line per item and disposition: the same choice made twice is added together.
      const merged = new Map<string, ReturnLineRequest>()
      for (const line of input.lines) {
        const key = `${line.saleItemId}:${line.disposition}`
        const existing = merged.get(key)
        merged.set(key, {
          ...line,
          quantityMilli: (existing?.quantityMilli ?? 0) + line.quantityMilli
        })
      }
      const requested = [...merged.values()]

      const facts = returns.loadFacts(input.saleId)
      requested.forEach((line, index) => {
        const item = facts.find((f) => f.saleItemId === line.saleItemId)
        if (item && !item.line.allowsFraction && line.quantityMilli % QUANTITY_SCALE !== 0) {
          throw invalid(
            `lines.${index}.quantityMilli`,
            `${item.line.description} is sold in whole numbers`
          )
        }
      })

      let quote
      try {
        quote = quoteReturn(facts, requested, sale.pricesIncludeTax)
      } catch (error) {
        if (error instanceof ReturnError) {
          throw invalid(
            error.line === null ? 'lines' : `lines.${error.line}.quantityMilli`,
            error.message
          )
        }
        throw error
      }

      const refunds = input.refunds.map((refund, index) => {
        const method = payments.findMethod(refund.paymentMethodId)
        if (!method) {
          throw invalid(`refunds.${index}.paymentMethodId`, 'That payment method does not exist')
        }
        if (!method.active) {
          throw invalid(
            `refunds.${index}.paymentMethodId`,
            `Payment method “${method.name}” is archived`
          )
        }
        return {
          paymentMethodId: refund.paymentMethodId,
          amountMinor: refund.amountMinor,
          reference: refund.reference ?? null,
          methodName: method.name
        }
      })
      const refundedMinor = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)
      if (refundedMinor !== quote.refundDueMinor) {
        const money = (minor: number): string => formatMoney(minor, this.currency())
        throw invalid(
          'refunds',
          quote.refundDueMinor === 0
            ? 'Nothing is due back on this return, so no refund can be recorded.'
            : `The refunds add up to ${money(refundedMinor)}, but ${money(quote.refundDueMinor)} is due back to the customer.`
        )
      }

      const created = returns.create({
        saleId: input.saleId,
        userId: actor.userId,
        reason: input.reason,
        lines: quote.lines,
        refunds
      })
      const saved = this.require(created)
      const money = (minor: number): string => formatMoney(minor, this.currency())
      audit.change({
        action: 'return.created',
        actor,
        entity: { type: 'sale_return', id: created },
        details: {
          returnNumber: saved.returnNumber,
          invoiceNumber: saved.invoiceNumber,
          ...(saved.customerName ? { customer: saved.customerName } : {}),
          items: saved.lines.map((line) => ({
            item: line.description,
            quantity: `${formatQuantity(line.quantityMilli)} ${line.unitCode}`,
            goods: RETURN_DISPOSITION_LABELS[line.disposition],
            credit: money(line.creditMinor)
          })),
          refundDue: money(saved.refundDueMinor),
          refunds: saved.refunds.map((refund) => ({
            method: refund.methodName,
            amount: money(refund.amountMinor),
            ...(refund.reference ? { reference: refund.reference } : {})
          })),
          ...(saved.reason ? { reason: saved.reason } : {})
        }
      })
      return created
    })
    return this.require(saleReturnId)
  }

  // ---- Receipts (M16-05) ---------------------------------------------------

  previewReceipt(actor: Actor, input: ReturnReceiptInput): ReturnReceiptPreview {
    assertCan(actor, 'sale.view')
    const { ret, doc } = this.buildReceipt(actor, input.saleReturnId, Boolean(input.isReprint))
    return {
      saleReturnId: ret.saleReturnId,
      returnNumber: ret.returnNumber,
      paperWidthMm: doc.paperWidthMm,
      columns: doc.columns,
      isReprint: doc.isReprint,
      lines: doc.lines,
      html: renderReceiptHtml(doc)
    }
  }

  /**
   * Print the return receipt. Printing never changes the return, and a failed
   * print leaves it saved. A reprint needs `sale.reprint` (a manager can
   * approve it) and is audited, like an invoice reprint.
   */
  async printReceipt(actor: Actor, input: ReturnReceiptPrintInput): Promise<PrintJobResult> {
    const isReprint = Boolean(input.isReprint)
    if (isReprint) {
      if (!actor.permissions.has('sale.reprint')) throw forbidden('sale.reprint', true)
    } else {
      assertCan(actor, 'sale.view')
    }
    const { ret, doc, config } = this.buildReceipt(actor, input.saleReturnId, isReprint)
    const refundedInCash = ret.refunds.some((refund) => refund.kind === 'cash')
    const result = await this.deps.printing.printDocument(doc, {
      openCashDrawer: !isReprint && config.openCashDrawer && refundedInCash
    })
    if (isReprint) {
      this.deps.db.transaction(() => {
        this.deps.audit.change({
          action: 'return.reprinted',
          actor,
          entity: { type: 'sale_return', id: ret.saleReturnId },
          details: { returnNumber: ret.returnNumber, invoiceNumber: ret.invoiceNumber }
        })
      })
    }
    return result
  }

  // ---- Internals -----------------------------------------------------------

  private buildReceipt(actor: Actor, saleReturnId: number, isReprint: boolean) {
    const ret = this.require(saleReturnId)
    const store = this.deps.store.get()
    if (!store) throw new AppError('SETUP_REQUIRED', 'Set up the store before printing receipts')
    const config = this.deps.printing.getPrinterConfig(actor)
    const doc = buildReturnReceiptDocument(store, ret, {
      paperWidthMm: config.paperWidthMm,
      isReprint
    })
    return { ret, doc, config }
  }

  private currency() {
    return this.deps.store.get()?.currency ?? DEFAULT_CURRENCY
  }

  private require(saleReturnId: number): ReturnDetail {
    const found = this.deps.returns.get(saleReturnId)
    if (!found) throw new AppError('NOT_FOUND', 'That return no longer exists.')
    return found
  }
}
